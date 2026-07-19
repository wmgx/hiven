import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import { getKillProcessHostItem } from '../desktopControl/killProcessCommand'
import { getHostWindowLauncherDynamicItems } from '../desktopControl/windows'
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
  // First-party desktop target providers (protocol registry; progressive collect ready for D3 tabs).
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
    const [workflowItems, appItems, windowItems] = await Promise.all([
      measureLauncherPerf('host-provider:workflow-items', () => getWorkflowObjectLauncherItems(ctx), (items) => ({
        queryLength: ctx.query.trim().length,
        itemCount: items.length,
      })),
      measureLauncherPerf('host-provider:app-items', () => getHostAppLauncherDynamicItems(ctx), (items) => ({
        queryLength: ctx.query.trim().length,
        itemCount: items.length,
      })),
      measureLauncherPerf('host-provider:window-items', () => getHostWindowLauncherDynamicItems(ctx), (items) => ({
        queryLength: ctx.query.trim().length,
        itemCount: items.length,
      })),
    ])
    return [
      ...workflowItems,
      ...appItems,
      ...windowItems,
    ]
  })
}
