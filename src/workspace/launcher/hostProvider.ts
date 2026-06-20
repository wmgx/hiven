import {
  getHostAppLauncherDynamicItems,
  getHostAppLauncherStaticItems,
} from '../appLauncher/hostAppLauncher'
import {
  setHostLauncherDynamicItemsProvider,
  setHostLauncherItemsProvider,
} from './registry'
import { getHostPaneControlItems, getHostSystemPowerItems } from './hostActions'

export function registerHostLauncherProviders(): void {
  setHostLauncherItemsProvider(() => [
    ...getHostPaneControlItems(),
    ...getHostSystemPowerItems(),
    ...getHostAppLauncherStaticItems(),
  ])
  setHostLauncherDynamicItemsProvider(getHostAppLauncherDynamicItems)
}
