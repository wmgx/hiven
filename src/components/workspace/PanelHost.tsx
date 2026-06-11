/**
 * hiven - Panel Host
 * Renders open panel instances in their designated placement areas.
 */

import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { panelRegistry } from '../../workspace/panelRegistry'
import { releaseOccupancy } from '../../workspace/surfaceCoordinator'

export function PanelHost() {
  const panels = useWorkspaceStore((s) => s.panels)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const closePanel = useWorkspaceStore((s) => s.closePanel)

  // Get bottom panels
  const bottomPanels = Object.values(panels).filter(
    (p) => p.placement === 'bottom'
  )

  if (bottomPanels.length === 0) return null

  return (
    <div
      className="shrink-0 overflow-hidden"
      style={{
        height: '200px',
        borderTop: '1px solid var(--color-border-tertiary)',
      }}
    >
      {bottomPanels.map((instance) => {
        const contribution = panelRegistry.get(instance.panelId)
        if (!contribution) return null

        const PanelComponent = contribution.component

        const handleClose = () => {
          const occupancyId = `panel:${instance.id}`
          releaseOccupancy(occupancyId)
          closePanel(instance.id)
        }

        return (
          <div key={instance.id} className="h-full overflow-hidden">
            <PanelComponent
              instanceId={instance.id}
              title={instance.title}
              placement={instance.placement}
              bind={instance.bind}
              props={{}}
              activePaneId={activePaneId}
              onClose={handleClose}
            />
          </div>
        )
      })}
    </div>
  )
}
