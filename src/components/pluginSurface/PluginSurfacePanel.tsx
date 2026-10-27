import { useMemo } from 'react'
import { translate } from '../../i18n'
import { useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import type { PanelPropsV2 } from '../../workspace/pluginTypes'
import { SurfaceChrome } from './SurfaceChrome'
import { PluginSettingsDialog } from '../PluginSettingsDialog'
import { PluginSurfaceRenderer, usePluginSurfaceTitle } from './PluginSurfaceRenderer'

export const PLUGIN_SURFACE_PANEL_ID = 'hiven.plugin-surface-panel'

type PluginSurfacePanelInputs = {
  target?: PluginSurfaceOpenTarget
  text?: string
}

export function PluginSurfacePanel({ inputs, host }: PanelPropsV2<PluginSurfacePanelInputs>) {
  const locale = useAppStore((s) => s.locale)
  const target = useMemo(() => normalizeTarget(inputs?.target, inputs), [inputs])
  const title = usePluginSurfaceTitle(target, locale)

  if (!target) {
    return (
      <div className="plugin-surface-panel-message">
        <div>{translate(locale, 'workspace', 'invalidTarget')}</div>
      </div>
    )
  }

  return (
    <div className="plugin-surface-panel">
      <SurfaceChrome title={title || target.surfaceId} onClose={host.close}>
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
      </SurfaceChrome>
    </div>
  )
}

function normalizeTarget(value: unknown, inputs?: PluginSurfacePanelInputs): PluginSurfaceOpenTarget | null {
  const target = value as Partial<PluginSurfaceOpenTarget> | undefined
  if (!target) return null
  if (target.source !== 'builtin' && target.source !== 'installed' && target.source !== 'dev') return null
  if (!target.pluginId || !target.surfaceId) return null
  return {
    source: target.source,
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
    initialText: inputs?.text ?? (typeof target.initialText === 'string' ? target.initialText : undefined),
  }
}
