import { PluginSurfacePanel, PLUGIN_SURFACE_PANEL_ID } from '../components/pluginSurface/PluginSurfacePanel'
import { pluginRegistry } from './pluginRegistry'
import type { PanelContributionV2 } from './pluginTypes'

let registered = false

export function registerPluginSurfacePanelProvider(): void {
  if (registered) return
  registered = true

  const panel: PanelContributionV2 = {
    id: PLUGIN_SURFACE_PANEL_ID,
    title: 'Plugin Surface',
    titleI18n: { zh: '插件 Surface' },
    defaultPlacement: 'right',
    component: PluginSurfacePanel as never,
  }

  pluginRegistry.registerProductionPlugin(
    'hiven.plugin-surface-panel',
    [],
    [],
    [panel],
    [],
  )
}
