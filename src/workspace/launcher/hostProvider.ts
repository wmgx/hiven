import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import { getKillProcessHostItem } from '../desktopControl/killProcessCommand'
import { getHostWindowLauncherDynamicItems } from '../desktopControl/windows'
import { getDesktopBridgeLauncherDynamicItems } from '../desktopTargets/collectBridgeLauncherItems'
import {
  registerDesktopTargetProvider,
} from '../desktopTargets/registry'
import { hostWindowTargetProvider } from '../desktopTargets/windowProvider'
import { registerDefaultWorkflowProviders } from '../../workflow/defaultWorkflowProviders'
import { getTextPipelineLauncherItems } from '../../workflow/pipelineLauncher'
import { registerBuiltinTextPipelines } from '../../workflow/pipeline'
import { getWorkflowObjectLauncherItems } from '../../workflow/workflowLauncherAdapter'
import {
  setHostLauncherDynamicItemsProvider,
  setHostLauncherItemsProvider,
} from './registry'
import { measureLauncherPerf } from './perf'
import { getHostPaneControlItems, getHostSystemPowerItems } from './hostActions'
import { registerPluginSurfacePanelProvider } from '../pluginSurfacePanelProvider'
import { registerWorkflowOutputShelfPanelProvider } from '../workflowOutputShelfPanelProvider'

export function registerHostLauncherProviders(): void {
  registerPluginSurfacePanelProvider()
  registerWorkflowOutputShelfPanelProvider()
  registerDefaultWorkflowProviders()
  registerBuiltinTextPipelines()
  // Host-owned desktop targets (window). Browser tabs are registered by the
  // first-party browser-tabs plugin via desktopTargets.registerProvider.
  registerDesktopTargetProvider(hostWindowTargetProvider)
  setHostLauncherItemsProvider(() => [
    ...getHostPaneControlItems(),
    ...getHostSystemPowerItems(),
    ...getHostAppLauncherStaticItems(),
    ...getTextPipelineLauncherItems(),
    // Kill Process: first-level command → collect-input second level (suggest list).
    getKillProcessHostItem(),
  ])
  setHostLauncherDynamicItemsProvider(async (ctx) => {
    // Process terminate is NOT first-level dynamic. Use getKillProcessHostItem (static).
    // Empty open: apps only (memo top-N) + cached windows if any. No workflow, no waiting.
    // Query present: apps + windows (+ light workflow). Windows never block (lazy cache).
    const q = ctx.query.trim()
    const appItems = await measureLauncherPerf('host-provider:app-items', () => getHostAppLauncherDynamicItems(ctx), (items) => ({
      queryLength: q.length,
      itemCount: items.length,
    }))
    const windowItems = await measureLauncherPerf('host-provider:window-items', () => getHostWindowLauncherDynamicItems(ctx), (items) => ({
      queryLength: q.length,
      itemCount: items.length,
    }))

    if (!q) {
      // Empty open path: skip workflow + bridge tabs (empty-search tabs = 0).
      return [...appItems, ...windowItems]
    }

    const workflowItems = await measureLauncherPerf('host-provider:workflow-items', () => getWorkflowObjectLauncherItems(ctx), (items) => ({
      queryLength: q.length,
      itemCount: items.length,
    })).catch((error) => {
      console.warn('[launcher] workflow dynamic items failed:', error)
      return [] as Awaited<ReturnType<typeof getWorkflowObjectLauncherItems>>
    })

    // D3: Chromium tabs via desktop bridge (plugin-registered; silent if offline).
    const bridgeItems = await measureLauncherPerf(
      'host-provider:bridge-items',
      () => getDesktopBridgeLauncherDynamicItems(ctx),
      (items) => ({ queryLength: q.length, itemCount: items.length }),
    ).catch((error) => {
      console.warn('[launcher] desktop bridge dynamic items failed:', error)
      return [] as Awaited<ReturnType<typeof getDesktopBridgeLauncherDynamicItems>>
    })

    // Window vs tab de-dupe is soft ranking (title near-dup + capability tier),
    // not a host product filter that knows about browser plugins.
    return [
      ...workflowItems,
      ...appItems,
      ...windowItems,
      ...bridgeItems,
    ]
  })
}
