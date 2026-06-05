/**
 * 应用配置目录初始化 & 目录插件包管理
 *
 * FluxText framework 现在只管理目录插件包：
 *   ~/.local/fluxtext/plugins/builtin
 *   ~/.local/fluxtext/plugins/installed
 *   ~/.local/fluxtext/plugins/dev
 *
 * 旧 scripts/ 目录只作为兼容释放来源；启动时不再把裸 .js/.ts 文件注册为能力。
 */

const REMOTE_BUILTIN_PLUGIN_INDEX_URLS = [
  'https://proxy.flux.wmgx.top/raw/wmgx/flux_text/main/src/builtin-plugins/index.json',
  'https://cdn.jsdelivr.net/gh/wmgx/flux_text@main/src/builtin-plugins/index.json',
  'https://raw.githubusercontent.com/wmgx/flux_text/main/src/builtin-plugins/index.json',
]

// ─── First-party plugin package discovery ─────────────────────────────────────
// First-party plugin packages live under `src/plugins/<id>/`. They are
// discovered automatically: the manifest provides metadata and every other file
// in the package is released verbatim into `plugins/builtin/<id>/`. Adding a new
// first-party plugin requires no framework code change — just a new directory.

type DiscoveredBuiltinPackage = {
  pluginId: string
  displayName: string
  displayNameI18n?: Record<string, string>
  version: string
  capabilities: string[]
  files: Record<string, string>
}

const PLUGIN_MANIFEST_MODULES = import.meta.glob('./plugins/*/manifest.json', {
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

async function releaseBuiltinPluginManifests(_configDir: string, pluginBuiltinDir: string) {
  for (const pkg of BUILTIN_PLUGIN_PACKAGES) {
    const pluginDir = `${pluginBuiltinDir}/${pkg.pluginId}`
    for (const [fileName, content] of Object.entries(pkg.files)) {
      await ensureTextFile(`${pluginDir}/${fileName}`, content)
    }
  }
  const embeddedIndex = {
    version: 1,
    packages: [...BUILTIN_PLUGIN_PACKAGES.map((pkg) => pkg.pluginId)],
  }
  const expectedPackages = new Set(embeddedIndex.packages)
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
  const currentIndex = await invoke<string>('read_plugin_file', { path: indexPath })
    .then((raw) => JSON.parse(raw) as { version?: number; packages?: string[] })
    .catch(() => ({ version: 0, packages: [] }))
  const currentPackages = new Set(currentIndex.packages ?? [])
  const embeddedPackagesChanged =
    currentPackages.size !== embeddedIndex.packages.length ||
    embeddedIndex.packages.some((pluginId) => !currentPackages.has(pluginId))
  if (Number(currentIndex.version ?? 0) < embeddedIndex.version || embeddedPackagesChanged) {
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
    console.error('[FluxText] Failed to init config dir:', error)
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

    const localIndexPath = `${configDir}/plugins/builtin/index.json`
    const localIndexRaw = await invoke<string>('read_plugin_file', { path: localIndexPath }).catch(() => '{"version":0,"packages":[]}')
    const localIndex = JSON.parse(localIndexRaw) as { version?: number }
    const remoteIndexRaw = await fetchWithFallback(REMOTE_BUILTIN_PLUGIN_INDEX_URLS)
    const remoteIndex = JSON.parse(remoteIndexRaw) as { version?: number }

    const localVersion = Number(localIndex.version ?? 0)
    const remoteVersion = Number(remoteIndex.version ?? 0)
    if (remoteVersion > localVersion) {
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
