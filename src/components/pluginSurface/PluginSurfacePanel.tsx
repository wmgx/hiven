import { useMemo } from 'react'
import { useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import type { PanelPropsV2 } from '../../workspace/pluginTypes'
import { PluginSettingsDialog } from '../PluginSettingsDialog'
import { PluginSurfaceRenderer, usePluginSurfaceTitle } from './PluginSurfaceRenderer'

export const PLUGIN_SURFACE_PANEL_ID = 'hiven.plugin-surface-panel'

type PluginSurfacePanelInputs = {
  target?: PluginSurfaceOpenTarget
  text?: string
}

export function PluginSurfacePanel({ inputs, host }: PanelPropsV2<PluginSurfacePanelInputs>) {
  const locale = useAppStore((s) => s.locale)
  const target = useMemo(() => normalizeTarget(inputs?.target), [inputs])
  const title = usePluginSurfaceTitle(target, locale)

  if (!target) {
    return (
      <div className="plugin-surface-panel-message">
        <div>Plugin surface target missing</div>
      </div>
    )
  }

  return (
    <div className="plugin-surface-panel">
      <div className="plugin-surface-panel-titlebar">
        <div className="plugin-surface-panel-title">{title || target.surfaceId}</div>
        <button className="plugin-surface-panel-close" type="button" onClick={host.close}>x</button>
      </div>
      <div className="plugin-surface-panel-body">
        <PluginSurfaceRenderer
          target={target}
          locale={locale}
          presentation="editor-panel"
          contextSurfaceId={PLUGIN_SURFACE_PANEL_ID}
          onBack={host.close}
          onClose={host.close}
        />
      </div>
      <PluginSettingsDialog />
    </div>
  )
}

function normalizeTarget(value: unknown): PluginSurfaceOpenTarget | null {
  const target = value as Partial<PluginSurfaceOpenTarget> | undefined
  if (!target) return null
  if (target.source !== 'builtin' && target.source !== 'installed' && target.source !== 'dev') return null
  if (!target.pluginId || !target.surfaceId) return null
  return {
    source: target.source,
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
  }
}
