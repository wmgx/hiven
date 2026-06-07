/**
 * FluxText - Pane Bottom Panels
 * Renders V2 panels with placement 'pane-bottom' scoped to a specific pane.
 */

import type { CSSProperties } from 'react'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { pluginRegistry } from '../../workspace/pluginRegistry'
import { applyEffects } from '../../workspace/effectRunner'
import type { FluxEffect, PanelInstanceV2 } from '../../workspace/types'
import type { PanelHostApi } from '../../workspace/pluginTypes'

export function PaneBottomPanels({ paneId }: { paneId: string }) {
  const panelInstancesV2 = useWorkspaceStore((s) => s.panelInstancesV2)

  const panels = Object.values(panelInstancesV2).filter(
    (p) => p.placement === 'pane-bottom' && (!p.scope || (p.scope.type === 'pane' && p.scope.paneId === paneId))
  )

  if (panels.length === 0) return null

  return (
    <>
      {panels.map((instance) => (
        <PaneBottomPanelInstance key={instance.panelId} instance={instance} />
      ))}
    </>
  )
}

function PaneBottomPanelInstance({ instance }: { instance: PanelInstanceV2 }) {
  const closePanelV2 = useWorkspaceStore((s) => s.closePanelV2)
  const panelEntry = pluginRegistry.resolvePanel(instance.panelId, instance.isDevPanel)

  const host: PanelHostApi = {
    close: () => closePanelV2(instance.panelId),
    dispatch: (effects: FluxEffect[]) => applyEffects(effects),
  }

  if (!panelEntry) return null

  const customHeight = panelEntry.contribution.height
  const style: CSSProperties = {
    height: customHeight ?? '36px',
    borderTop: '0.5px solid var(--color-border-tertiary)',
    flexShrink: 0,
  }

  const PanelComponent = panelEntry.contribution.component

  return (
    <div style={style}>
      <PanelComponent
        inputs={instance.inputs}
        panelId={instance.panelId}
        host={host}
      />
    </div>
  )
}
