/**
 * hiven - Panel Host V2
 * Renders open panel instances using the new plugin panel system (single-instance model).
 * Supports bottom/right/left placement.
 */

import type { CSSProperties } from 'react'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { pluginRegistry } from '../../workspace/pluginRegistry'
import { applyEffects } from '../../workspace/effectRunner'
import type { FluxEffect, PanelInstanceV2 } from '../../workspace/types'
import type { PanelHostApi } from '../../workspace/pluginTypes'
import { useT, I18nNamespaceProvider } from '../../i18n'

export function PanelHostV2({ placement }: { placement: 'bottom' | 'right' | 'left' }) {
  const panelInstancesV2 = useWorkspaceStore((s) => s.panelInstancesV2)
  const closePanelV2 = useWorkspaceStore((s) => s.closePanelV2)

  const panels = Object.values(panelInstancesV2).filter((p) => p.placement === placement)

  if (panels.length === 0) {
    return null
  }

  return (
    <>
      {panels.map((instance) => (
        <PanelV2Instance
          key={instance.panelId}
          instance={instance}
          placement={placement}
          onClose={() => closePanelV2(instance.panelId)}
        />
      ))}
    </>
  )
}

interface PanelV2InstanceProps {
  instance: PanelInstanceV2
  placement: 'bottom' | 'right' | 'left'
  onClose: () => void
}

function PanelV2Instance({ instance, placement, onClose }: PanelV2InstanceProps) {
  const panelEntry = pluginRegistry.resolvePanel(instance.panelId, instance.isDevPanel)
  const t = useT('workspace')

  const host: PanelHostApi = {
    close: onClose,
    dispatch: (effects) => applyEffects(stampDevEffects(effects, instance.isDevPanel)),
  }

  const customHeight = panelEntry?.contribution.height
  const placementStyle: CSSProperties =
    placement === 'bottom'
      ? { height: customHeight ?? '240px', borderTop: '1px solid var(--color-border-tertiary)' }
      : placement === 'right'
      ? { width: '300px', minWidth: '300px', borderLeft: '1px solid var(--color-border-tertiary)', height: '100%' }
      : { width: '300px', minWidth: '300px', borderRight: '1px solid var(--color-border-tertiary)', height: '100%' }

  if (!panelEntry) {
    return (
      <div
        className="shrink-0 flex items-center justify-center overflow-hidden"
        style={placementStyle}
      >
        <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
          {t('panel.notFound')}: {instance.panelId}
        </span>
      </div>
    )
  }

  const PanelComponent = panelEntry.contribution.component
  const pluginId = panelEntry.meta.pluginId

  return (
    <I18nNamespaceProvider value={pluginId}>
      <div className="shrink-0 overflow-hidden" style={placementStyle}>
        <PanelComponent
          inputs={instance.inputs}
          panelId={instance.panelId}
          host={host}
        />
      </div>
    </I18nNamespaceProvider>
  )
}

function stampDevEffects(effects: FluxEffect[], isDev?: boolean): FluxEffect[] {
  if (!isDev) return effects
  return effects.map((effect) => {
    if (effect.type === 'pane.setRenderer') return { ...effect, _isDev: true }
    if (effect.type === 'panel.openV2') return { ...effect, _isDev: true }
    return effect
  })
}
