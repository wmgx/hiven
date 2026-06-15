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

const REMOTE_BUILTIN_PLUGIN_INDEX_URLS = [
  'https://proxy.github.wmgx.top/raw/wmgx/hiven/main/src/builtin-plugins/index.json',
  'https://cdn.jsdelivr.net/gh/wmgx/hiven@main/src/builtin-plugins/index.json',
  'https://raw.githubusercontent.com/wmgx/hiven/main/src/builtin-plugins/index.json',
]
const REMOTE_BUILTIN_PLUGIN_SOURCE_BASE_URLS = [
  'https://proxy.github.wmgx.top/raw/wmgx/hiven/main/src/plugins',
  'https://cdn.jsdelivr.net/gh/wmgx/hiven@main/src/plugins',
  'https://raw.githubusercontent.com/wmgx/hiven/main/src/plugins',
]
const REMOTE_BUILTIN_PLUGIN_TREE_URLS = [
  'https://api.github.com/repos/wmgx/hiven/git/trees/main?recursive=1',
]
const DOWNLOADABLE_PLUGIN_FILE_PATTERN = /\.(?:ts|tsx|js|jsx|mjs|json|md)$/i

// ─── First-party plugin package discovery ─────────────────────────────────────
// First-party plugin packages live under `src/plugins/<id>/`. They are
// discovered automatically: the manifest provides metadata and every other file
// in the package is released verbatim into `plugins/builtin/<id>/`. Adding a new
// first-party plugin requires no framework code change — just a new directory.

type DiscoveredBuiltinPackage = {
  pluginId: string
  dir: string
  displayName: string
  displayNameI18n?: Record<string, string>
  version: string
  capabilities: string[]
  files: Record<string, string>
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

type RemoteBuiltinTreeItem = {
  path?: unknown
  type?: unknown
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

const PLUGIN_FILE_MODULES = import.meta.glob('./plugins/*/**/*.{ts,tsx,js,jsx,mjs,json,md}', {
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
      displayName?: string
      displayNameI18n?: Record<string, string>
      version?: string
      capabilities?: string[]
    }
    const prefix = `./plugins/${dir}/`
    const files: Record<string, string> = {}
    for (const [filePath, content] of Object.entries(PLUGIN_FILE_MODULES)) {
      if (!filePath.startsWith(prefix)) continue
      files[filePath.slice(prefix.length)] = content
    }
    files['manifest.json'] = rawManifest
    packages.push({
      pluginId: manifest.pluginId,
      dir,
      displayName: manifest.displayName || manifest.pluginId,
      displayNameI18n: manifest.displayNameI18n,
      version: manifest.version || '1.0.0',
      capabilities: manifest.capabilities || ['command'],
      files,
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

async function fetchWithFallback(urls: string[]): Promise<string> {
  let lastError = ''
  for (const url of urls) {
    try {
      return await invoke<string>('fetch_url', { url })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`All plugin package index mirrors failed. Last error: ${lastError}`)
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

function validatePackageRelativePath(value: string, label: string): void {
  const trimmed = value.trim()
  const segments = trimmed.split('/')
  if (
    !trimmed ||
    trimmed.includes('\\') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.startsWith('/') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`${label} must be a package-relative path`)
  }
}

function validatePluginId(pluginId: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(pluginId) || pluginId === '.' || pluginId === '..') {
    throw new Error(`Invalid builtin plugin id: ${pluginId}`)
  }
}

let remoteBuiltinTreePaths: Promise<string[]> | null = null

async function fetchRemoteBuiltinTreePaths(): Promise<string[]> {
  if (remoteBuiltinTreePaths) return remoteBuiltinTreePaths
  remoteBuiltinTreePaths = fetchWithFallback(REMOTE_BUILTIN_PLUGIN_TREE_URLS).then((raw) => {
    const parsed = JSON.parse(raw) as { tree?: RemoteBuiltinTreeItem[]; truncated?: boolean }
    if (!Array.isArray(parsed.tree)) {
      throw new Error('Remote builtin plugin GitHub tree response is invalid')
    }
    if (parsed.truncated) {
      throw new Error('Remote builtin plugin GitHub tree response is truncated')
    }
    return parsed.tree
      .filter((item) => item.type === 'blob' && typeof item.path === 'string')
      .map((item) => item.path as string)
  })
  return remoteBuiltinTreePaths
}

async function discoverRemoteBuiltinPackageFiles(pkg: BuiltinPluginIndexPackage): Promise<string[]> {
  const packageDir = pkg.dir || pkg.pluginId
  validatePackageRelativePath(packageDir, 'Remote builtin plugin directory')

  const prefix = `src/plugins/${packageDir}/`
  const files = (await fetchRemoteBuiltinTreePaths())
    .filter((path) => path.startsWith(prefix) && DOWNLOADABLE_PLUGIN_FILE_PATTERN.test(path))
    .map((path) => path.slice(prefix.length))
    .sort()

  for (const file of files) {
    validatePackageRelativePath(file, 'Remote builtin plugin file')
  }
  if (!files.includes('manifest.json')) {
    throw new Error(`Remote builtin plugin "${pkg.pluginId}" does not include manifest.json in the GitHub tree`)
  }
  return files
}

function remotePackageFileUrls(pkg: BuiltinPluginIndexPackage, path: string): string[] {
  validatePackageRelativePath(path, 'Remote builtin plugin file')

  const packageDir = pkg.dir || pkg.pluginId
  validatePackageRelativePath(packageDir, 'Remote builtin plugin directory')
  const baseUrls = pkg.baseUrl ? [pkg.baseUrl] : REMOTE_BUILTIN_PLUGIN_SOURCE_BASE_URLS
  return baseUrls.map((base) => `${base.replace(/\/$/, '')}/${packageDir}/${path}`)
}

async function validateStagedBuiltinPackage(folderPath: string, expectedPluginId: string): Promise<void> {
  const manifestRaw = await invoke<string>('read_plugin_file', { path: `${folderPath}/manifest.json` })
  const manifest = JSON.parse(manifestRaw) as { pluginId?: string }
  if (manifest.pluginId !== expectedPluginId) {
    throw new Error(`Remote builtin plugin manifest pluginId mismatch: expected ${expectedPluginId}, got ${manifest.pluginId || '<missing>'}`)
  }

  for (const entry of ['index.tsx', 'index.ts', 'index.jsx', 'index.js', 'index.mjs']) {
    try {
      await invoke<string>('read_plugin_file', { path: `${folderPath}/${entry}` })
      return
    } catch {
      // Try the next fixed entry.
    }
  }
  throw new Error(`Remote builtin plugin "${expectedPluginId}" does not include a fixed index.* entry`)
}

async function stageRemoteBuiltinPackage(
  pkg: BuiltinPluginIndexPackage,
  stagingRoot: string,
): Promise<string> {
  validatePluginId(pkg.pluginId)
  const files = await discoverRemoteBuiltinPackageFiles(pkg)

  const packageRoot = `${stagingRoot}/${pkg.pluginId}`
  for (const path of files) {
    const content = await fetchWithFallback(remotePackageFileUrls(pkg, path))
    await ensureTextFile(`${packageRoot}/${path}`, content)
  }
  await validateStagedBuiltinPackage(packageRoot, pkg.pluginId)
  return packageRoot
}

async function releaseBuiltinPluginManifests(_configDir: string, pluginBuiltinDir: string) {
  const embeddedIndex = buildEmbeddedBuiltinIndex()

  // 读取本地已释放的 index，判断是否需要重新释放内置包。
  const currentIndex = await invoke<string>('read_plugin_file', { path: `${pluginBuiltinDir}/index.json` })
    .then((raw) => normalizeBuiltinPluginIndex(JSON.parse(raw)))
    .catch(() => ({ version: 0, packages: [] } satisfies BuiltinPluginIndex))
  const currentPackages = new Set(currentIndex.packages.map((pkg) => pkg.pluginId))
  const currentPackageVersions = new Map(currentIndex.packages.map((pkg) => [pkg.pluginId, pkg.version ?? '']))
  const packagesChanged =
    currentPackages.size !== embeddedIndex.packages.length ||
    embeddedIndex.packages.some((pkg) => !currentPackages.has(pkg.pluginId))
  const packageVersionsChanged = embeddedIndex.packages.some((pkg) => {
    return (pkg.version ?? '') !== (currentPackageVersions.get(pkg.pluginId) ?? '')
  })
  const versionChanged = Number(currentIndex.version ?? 0) < embeddedIndex.version
  const needsRelease = versionChanged || packagesChanged || packageVersionsChanged

  if (needsRelease) {
    // 整目录覆盖：先删除每个内置包的现有目录，清掉历史残留文件
    // （如旧版释放的 index.js / entry.js），再以当前源码包内容重写。
    for (const pkg of BUILTIN_PLUGIN_PACKAGES) {
      await invoke<void>('remove_plugin_dir', {
        rootPath: pluginBuiltinDir,
        pluginId: pkg.pluginId,
      }).catch(() => undefined)
      const pluginDir = `${pluginBuiltinDir}/${pkg.pluginId}`
      for (const [fileName, content] of Object.entries(pkg.files)) {
        await ensureTextFile(`${pluginDir}/${fileName}`, content)
      }
    }
  }

  // 移除不再属于内置集合的历史包目录。
  const expectedPackages = new Set(embeddedIndex.packages.map((pkg) => pkg.pluginId))
  const existingPackages = await invoke<{ pluginId: string }[]>('list_plugin_dirs', { path: pluginBuiltinDir }).catch(() => [])
  for (const plugin of existingPackages) {
    if (!expectedPackages.has(plugin.pluginId)) {
      await invoke<void>('remove_plugin_dir', {
        rootPath: pluginBuiltinDir,
        pluginId: plugin.pluginId,
      }).catch(() => undefined)
    }
  }

  const indexPath = `${pluginBuiltinDir}/index.json`
  if (needsRelease) {
    await ensureTextFile(indexPath, JSON.stringify(embeddedIndex, null, 2))
  }
}

/**
 * 初始化配置目录，按目录约定释放内置插件包。
 * 返回配置根目录路径。
 */
export async function initConfigDir(): Promise<string | null> {
  if (!isTauri()) return null

  try {
    const configDir = await invoke<string>('init_config_dir')
    const pluginBuiltinDir = `${configDir}/plugins/builtin`
    const pluginInstalledDir = `${configDir}/plugins/installed`
    const pluginDevDir = `${configDir}/plugins/dev`

    await ensureTextFile(`${pluginBuiltinDir}/.keep`, '')
    await ensureTextFile(`${pluginInstalledDir}/.keep`, '')
    await ensureTextFile(`${pluginDevDir}/.keep`, '')
    await releaseBuiltinPluginManifests(configDir, pluginBuiltinDir)

    return configDir
  } catch (error) {
    console.error('[hiven] Failed to init config dir:', error)
    return null
  }
}

/**
 * 检查内置插件包更新。
 *
 * 当前 first-party 能力仍由硬编码 builtinActions 和本地 first-party plugins 保底；
 * 这里保守退化为包检查占位，避免继续维护旧裸脚本更新通道。
 */
export async function checkBuiltinPluginsUpdate(): Promise<{
  updated: boolean
  version?: number
  error?: string
}> {
  if (!isTauri()) return { updated: false, version: 0 }

  try {
    const configDir = await initConfigDir()
    if (!configDir) return { updated: false, version: 0 }

    const pluginBuiltinDir = `${configDir}/plugins/builtin`
    const localIndexPath = `${configDir}/plugins/builtin/index.json`
    const localIndexRaw = await invoke<string>('read_plugin_file', { path: localIndexPath }).catch(() => '{"version":0,"packages":[]}')
    const localIndex = normalizeBuiltinPluginIndex(JSON.parse(localIndexRaw))
    const remoteIndexRaw = await fetchWithFallback(REMOTE_BUILTIN_PLUGIN_INDEX_URLS)
    const remoteIndex = normalizeBuiltinPluginIndex(JSON.parse(remoteIndexRaw))

    const localVersion = Number(localIndex.version ?? 0)
    const remoteVersion = Number(remoteIndex.version ?? 0)
    if (remoteVersion > localVersion) {
      const stagingRoot = `${pluginBuiltinDir}/.builtin-update-${Date.now()}`
      const stagedPackages: BuiltinPluginIndexPackage[] = []
      try {
        for (const pkg of remoteIndex.packages) {
          await stageRemoteBuiltinPackage(pkg, stagingRoot)
          stagedPackages.push(pkg)
        }

        for (const pkg of stagedPackages) {
          await invoke<void>('replace_plugin_dir', {
            sourcePath: `${stagingRoot}/${pkg.pluginId}`,
            rootPath: pluginBuiltinDir,
            pluginId: pkg.pluginId,
          })
        }

        const expectedPackages = new Set(remoteIndex.packages.map((pkg) => pkg.pluginId))
        const existingPackages = await invoke<{ pluginId: string }[]>('list_plugin_dirs', { path: pluginBuiltinDir }).catch(() => [])
        for (const plugin of existingPackages) {
          if (!expectedPackages.has(plugin.pluginId) && !plugin.pluginId.startsWith('.')) {
            await invoke<void>('remove_plugin_dir', {
              rootPath: pluginBuiltinDir,
              pluginId: plugin.pluginId,
            }).catch(() => undefined)
          }
        }
      } finally {
        await invoke<void>('remove_plugin_dir', {
          rootPath: pluginBuiltinDir,
          pluginId: stagingRoot.slice(pluginBuiltinDir.length + 1),
        }).catch(() => undefined)
      }
      await ensureTextFile(localIndexPath, JSON.stringify(remoteIndex, null, 2))
      return { updated: true, version: remoteVersion }
    }

    return { updated: false, version: localVersion }
  } catch (error) {
    return { updated: false, error: error instanceof Error ? error.message : String(error) }
  }
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
