import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import { registerDefaultWorkflowProviders } from '../../workflow/defaultWorkflowProviders'
import { getWorkflowObjectLauncherItems } from '../../workflow/workflowLauncherAdapter'
import {
  setHostLauncherDynamicItemsProvider,
  setHostLauncherItemsProvider,
} from './registry'
import { measureLauncherPerf } from './perf'
import { getEditorWindowItems } from './editorWindowItems'
import { getHostPaneControlItems, getHostSystemPowerItems } from './hostActions'
import { registerPluginSurfacePanelProvider } from '../pluginSurfacePanelProvider'
import { registerWorkflowOutputShelfPanelProvider } from '../workflowOutputShelfPanelProvider'

export function registerHostLauncherProviders(): void {
  registerPluginSurfacePanelProvider()
  registerWorkflowOutputShelfPanelProvider()
  registerDefaultWorkflowProviders()
  setHostLauncherItemsProvider(() => [
    ...getEditorWindowItems(),
    ...getHostPaneControlItems(),
    ...getHostSystemPowerItems(),
    ...getHostAppLauncherStaticItems(),
  ])
  setHostLauncherDynamicItemsProvider(async (ctx) => {
    const [workflowItems, appItems] = await Promise.all([
      measureLauncherPerf('host-provider:workflow-items', () => getWorkflowObjectLauncherItems(ctx), (items) => ({
        queryLength: ctx.query.trim().length,
        itemCount: items.length,
      })),
      measureLauncherPerf('host-provider:app-items', () => getHostAppLauncherDynamicItems(ctx), (items) => ({
        queryLength: ctx.query.trim().length,
        itemCount: items.length,
      })),
    ])
    return [
      ...workflowItems,
      ...appItems,
    ]
  })
}
