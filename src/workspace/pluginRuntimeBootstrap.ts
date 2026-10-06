import { initConfigDir } from '../configInit'
import { registerBundledPluginPackages } from './bundledPluginLoader'
import { registerHostLauncherProviders } from './launcher/hostProvider'
import { loadInstalledPluginsFromStore } from './pluginRuntime'
import type { PluginSettingsSource } from './pluginSettingsStore'

let pluginRuntimeReadyPromise: Promise<void> | null = null

export async function ensurePluginRuntimeReady(source: PluginSettingsSource): Promise<void> {
  registerHostLauncherProviders()
  registerBundledPluginPackages()
  // 内置 surface 的定义已就绪；目录释放由主窗口负责，不阻塞首次打开。
  if (source === 'builtin') return
  if (!pluginRuntimeReadyPromise) {
    pluginRuntimeReadyPromise = bootstrapPluginRuntime()
  }
  return pluginRuntimeReadyPromise
}

async function bootstrapPluginRuntime(): Promise<void> {
  await initConfigDir()
  await loadInstalledPluginsFromStore()
}
