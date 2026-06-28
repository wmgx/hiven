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
import { getEditorWindowItems } from './editorWindowItems'
import { getHostPaneControlItems, getHostSystemPowerItems } from './hostActions'
import { registerPluginSurfacePanelProvider } from '../pluginSurfacePanelProvider'

export function registerHostLauncherProviders(): void {
  registerPluginSurfacePanelProvider()
  registerDefaultWorkflowProviders()
  setHostLauncherItemsProvider(() => [
    ...getEditorWindowItems(),
    ...getHostPaneControlItems(),
    ...getHostSystemPowerItems(),
    ...getHostAppLauncherStaticItems(),
  ])
  setHostLauncherDynamicItemsProvider(async (ctx) => [
    ...await getWorkflowObjectLauncherItems(ctx),
    ...await getHostAppLauncherDynamicItems(ctx),
  ])
}
