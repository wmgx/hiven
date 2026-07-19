import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import { getHostProcessLauncherDynamicItems } from '../desktopControl/processes'
import { getHostWindowLauncherDynamicItems } from '../desktopControl/windows'
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
  setHostLauncherItemsProvider(() => [
    ...getHostPaneControlItems(),
    ...getHostSystemPowerItems(),
    ...getHostAppLauncherStaticItems(),
    ...getTextPipelineLauncherItems(),
  ])
  setHostLauncherDynamicItemsProvider(async (ctx) => {
    const [workflowItems, appItems, windowItems, processItems] = await Promise.all([
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
      measureLauncherPerf('host-provider:process-items', () => getHostProcessLauncherDynamicItems(ctx), (items) => ({
        queryLength: ctx.query.trim().length,
        itemCount: items.length,
      })),
    ])
    return [
      ...workflowItems,
      ...appItems,
      ...windowItems,
      ...processItems,
    ]
  })
}
