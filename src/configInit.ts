/**
 * 应用配置目录初始化 & 目录插件包管理
 *
 * hiven framework 现在只管理目录插件包：
 *   ~/.local/hiven/plugins/builtin
 *   ~/.local/hiven/plugins/installed
 *   ~/.local/hiven/plugins/dev
 *
 * 旧 scripts/ 目录只作为兼容释放来源；启动时不再把裸 .js/.ts 文件注册为能力。
 */

// ─── First-party plugin package discovery ─────────────────────────────────────
// First-party plugin packages live under `src/plugins/<id>/`. They are
// discovered automatically: the manifest provides metadata and every other file
// in the package is released verbatim into `plugins/builtin/<id>/`. Adding a new
// first-party plugin requires no framework code change — just a new directory.

type DiscoveredBuiltinPackage = {
  pluginId: string
  dir: string
  version: string
  rawManifest: string
}

type BuiltinPluginIndexPackage = {
  pluginId: string
  dir?: string
  version?: string
  baseUrl?: string
}

type BuiltinPluginIndex = {
  version: number
  packages: BuiltinPluginIndexPackage[]
}

const PLUGIN_MANIFEST_MODULES = import.meta.glob('./plugins/*/manifest.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

const BUILTIN_PLUGIN_INDEX_MODULES = import.meta.glob('./builtin-plugins/index.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

function pluginDirFromModulePath(path: string): string | null {
  const match = path.match(/\.\/plugins\/([^/]+)\//)
  return match ? match[1] : null
}

function discoverBuiltinPluginPackages(): DiscoveredBuiltinPackage[] {
  const packages: DiscoveredBuiltinPackage[] = []
  for (const [manifestPath, rawManifest] of Object.entries(PLUGIN_MANIFEST_MODULES)) {
    const dir = pluginDirFromModulePath(manifestPath)
    if (!dir) continue
    const manifest = JSON.parse(rawManifest) as {
      pluginId: string
      version?: string
    }
    packages.push({
      pluginId: manifest.pluginId,
      dir,
      version: manifest.version || '1.0.0',
      rawManifest,
    })
  }
  return packages
}

const BUILTIN_PLUGIN_PACKAGES = discoverBuiltinPluginPackages()

function isTauri() {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core')
  return api.invoke<T>(command, args)
}

async function ensureTextFile(path: string, content: string) {
  await invoke<void>('save_plugin_file', { path, content })
}

// A failed write must not release the init single-flight while other writes
// are still running: a retry could otherwise remove their destination folders.
async function settleWrites(writes: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(writes)
  const failure = results.find((result) => result.status === 'rejected')
  if (failure?.status === 'rejected') throw failure.reason
}

function buildEmbeddedBuiltinIndex(): BuiltinPluginIndex {
  const rawIndex = Object.values(BUILTIN_PLUGIN_INDEX_MODULES)[0]
  const indexVersion = rawIndex
    ? normalizeBuiltinPluginIndex(JSON.parse(rawIndex)).version
    : 0
  return {
    version: indexVersion,
    packages: BUILTIN_PLUGIN_PACKAGES.map((pkg) => ({
      pluginId: pkg.pluginId,
      dir: pkg.dir,
      version: pkg.version,
    })),
  }
}

function normalizeBuiltinPluginIndex(value: unknown): BuiltinPluginIndex {
  const raw = value as { version?: unknown; packages?: unknown }
  const packages = Array.isArray(raw.packages)
    ? raw.packages.map((entry): BuiltinPluginIndexPackage => {
        if (typeof entry === 'string') return { pluginId: entry, dir: entry }
        const pkg = entry as Partial<BuiltinPluginIndexPackage>
        return {
          pluginId: String(pkg.pluginId || ''),
          dir: typeof pkg.dir === 'string' ? pkg.dir : undefined,
          version: typeof pkg.version === 'string' ? pkg.version : undefined,
          baseUrl: typeof pkg.baseUrl === 'string' ? pkg.baseUrl : undefined,
        }
      })
    : []

  return {
    version: Number(raw.version ?? 0),
    packages: packages.filter((pkg) => pkg.pluginId),
  }
}

function builtinPackageVersionsChanged(currentPackages: BuiltinPluginIndexPackage[], nextPackages: BuiltinPluginIndexPackage[]): boolean {
  const currentById = new Map(currentPackages.map((pkg) => [pkg.pluginId, pkg]))
  if (currentById.size !== nextPackages.length) return true
  return nextPackages.some((pkg) => {
    const current = currentById.get(pkg.pluginId)
    if (!current) return true
    return (current.version ?? '') !== (pkg.version ?? '') || (current.dir ?? current.pluginId) !== (pkg.dir ?? pkg.pluginId)
  })
}

async function releaseBuiltinPluginManifests(_configDir: string, pluginBuiltinDir: string) {
  const embeddedIndex = buildEmbeddedBuiltinIndex()

  // 读取本地已释放的 index，判断是否需要重新释放内置包。
  const currentIndex = await invoke<string>('read_plugin_file', { path: `${pluginBuiltinDir}/index.json` })
    .then((raw) => normalizeBuiltinPluginIndex(JSON.parse(raw)))
    .catch(() => ({ version: 0, packages: [] } satisfies BuiltinPluginIndex))
  const versionChanged = Number(currentIndex.version ?? 0) < embeddedIndex.version
  const needsRelease = versionChanged || builtinPackageVersionsChanged(currentIndex.packages, embeddedIndex.packages)

  if (needsRelease) {
    // Keep package source strings outside the normal startup graph. Prepare
    // every package before deleting anything, so a failed import is harmless.
    const { getBuiltinPluginFiles } = await import('./builtinPluginSources')
    const packages = BUILTIN_PLUGIN_PACKAGES.map((pkg) => ({
      ...pkg,
      files: { ...getBuiltinPluginFiles(pkg.dir), 'manifest.json': pkg.rawManifest },
    }))
    // 整目录覆盖：先删除每个内置包的现有目录，清掉历史残留文件
    // （如旧版释放的 index.js / entry.js），再以当前源码包内容重写。
    // 不同 pluginId 目录互不依赖，可并行处理。
    await settleWrites(packages.map(async (pkg) => {
      await invoke<void>('remove_plugin_dir', {
        rootPath: pluginBuiltinDir,
        pluginId: pkg.pluginId,
      }).catch(() => undefined)
      const pluginDir = `${pluginBuiltinDir}/${pkg.pluginId}`
      await settleWrites(
        Object.entries(pkg.files).map(([fileName, content]) =>
          ensureTextFile(`${pluginDir}/${fileName}`, content)
        )
      )
    }))
  }

  // 移除不再属于内置集合的历史包目录。
  const expectedPackages = new Set(embeddedIndex.packages.map((pkg) => pkg.pluginId))
  const existingPackages = await invoke<{ pluginId: string }[]>('list_plugin_dirs', { path: pluginBuiltinDir }).catch(() => [])
  await Promise.all(
    existingPackages
      .filter((plugin) => !expectedPackages.has(plugin.pluginId))
      .map((plugin) =>
        invoke<void>('remove_plugin_dir', {
          rootPath: pluginBuiltinDir,
          pluginId: plugin.pluginId,
        }).catch(() => undefined)
      )
  )

  const indexPath = `${pluginBuiltinDir}/index.json`
  if (needsRelease) {
    await ensureTextFile(indexPath, JSON.stringify(embeddedIndex, null, 2))
  }
}

/**
 * 初始化配置目录，按目录约定释放内置插件包。
 * 返回配置根目录路径。
 */
async function initPluginPackageDirs(): Promise<string | null> {
  const configDir = await invoke<string>('init_config_dir')
  const pluginBuiltinDir = `${configDir}/plugins/builtin`
  const pluginInstalledDir = `${configDir}/plugins/installed`
  const pluginDevDir = `${configDir}/plugins/dev`

  await settleWrites([
    ensureTextFile(`${pluginBuiltinDir}/.keep`, ''),
    ensureTextFile(`${pluginInstalledDir}/.keep`, ''),
    ensureTextFile(`${pluginDevDir}/.keep`, ''),
  ])

  return configDir
}

// Covers concurrent callers in this module/webview, including StrictMode.
// It is not a lock across separate webviews.
let configInitInFlight: Promise<string | null> | null = null

export async function initConfigDir(): Promise<string | null> {
  if (!isTauri()) return null
  if (!configInitInFlight) {
    configInitInFlight = (async () => {
      try {
        const configDir = await initPluginPackageDirs()
        if (!configDir) return null
        await releaseBuiltinPluginManifests(configDir, `${configDir}/plugins/builtin`)
        return configDir
      } catch (error) {
        console.error('[hiven] Failed to init config dir:', error)
        return null
      }
    })().finally(() => {
      // A failed attempt is retryable, and later calls recheck disk metadata.
      configInitInFlight = null
    })
  }
  return configInitInFlight
}

/**
 * Built-in code is compiled into the app. Downloading its source packages cannot
 * update the running implementation; keep this legacy entry point side-effect
 * free and direct callers to the application updater.
 */
export async function checkBuiltinPluginsUpdate(): Promise<{
  status: 'application-managed'
  updated: false
}> {
  return { status: 'application-managed', updated: false }
}

/**
 * 获取配置目录路径。
 */
export async function getConfigDir(): Promise<string | null> {
  if (!isTauri()) return null
  try {
    return await invoke<string>('get_config_dir')
  } catch {
    return null
  }
}
