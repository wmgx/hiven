import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import {
  setHostLauncherDynamicItemsProvider,
  setHostLauncherItemsProvider,
} from './registry'
import { getHostPaneControlItems } from './hostActions'

export function registerHostLauncherProviders(): void {
  setHostLauncherItemsProvider(() => [
    ...getHostPaneControlItems(),
    ...getHostAppLauncherStaticItems(),
  ])
  setHostLauncherDynamicItemsProvider(getHostAppLauncherDynamicItems)
}
