import { initConfigDir } from '../configInit'
import { registerBundledPluginPackages } from './bundledPluginLoader'
import { registerHostLauncherProviders } from './launcher/hostProvider'
import { loadInstalledPluginsFromStore } from './pluginRuntime'

let pluginRuntimeReadyPromise: Promise<void> | null = null

export function ensurePluginRuntimeReady(): Promise<void> {
  if (!pluginRuntimeReadyPromise) {
    pluginRuntimeReadyPromise = bootstrapPluginRuntime()
  }
  return pluginRuntimeReadyPromise
}

async function bootstrapPluginRuntime(): Promise<void> {
  await initConfigDir()
  registerHostLauncherProviders()
  registerBundledPluginPackages()
  await loadInstalledPluginsFromStore()
}
