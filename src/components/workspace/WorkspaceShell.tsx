import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { PaneEditor } from './PaneEditor'
import { PresentationHost } from './PresentationHost'
import { X } from 'lucide-react'

export function WorkspaceShell() {
  const layout = useWorkspaceStore((s) => s.layout)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const panes = useWorkspaceStore((s) => s.panes)
  const paneOrder = useWorkspaceStore((s) => s.paneOrder)
  const presentations = useWorkspaceStore((s) => s.presentations)
  const closePane = useWorkspaceStore((s) => s.closePane)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)

  // Check if there's an active presentation that covers the current panes
  const activePresentation = Object.values(presentations).find((session) => {
    if (session.mode === 'split-view' || session.mode === 'replace-pane') {
      // Check if all target panes are in the current layout
      return session.targetPaneIds.every((paneId) => panes[paneId])
    }
    return false
  })

  // If there's an active split-view presentation (like Diff), render PresentationHost
  if (activePresentation && (activePresentation.mode === 'split-view' || activePresentation.mode === 'replace-pane')) {
    return (
      <div className="flex-1 overflow-hidden h-full">
        <PresentationHost session={activePresentation} />
      </div>
    )
  }

  if (layout.type === 'single') {
    const paneId = layout.panes[0]
    return (
      <div className="flex-1 overflow-hidden h-full">
        <PaneEditor paneId={paneId} />
      </div>
    )
  }

  if (layout.type === 'split') {
    const isHorizontal = layout.direction === 'horizontal'
    return (
      <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} flex-1 overflow-hidden h-full`}>
        {layout.panes.map((paneId, idx) => (
          <div
            key={paneId}
            className="flex-1 overflow-hidden relative"
            style={{
              borderRight: isHorizontal && idx < layout.panes.length - 1
                ? '1px solid var(--color-border-tertiary)'
                : undefined,
              borderBottom: !isHorizontal && idx < layout.panes.length - 1
                ? '1px solid var(--color-border-tertiary)'
                : undefined,
            }}
          >
            {/* Active indicator */}
            {activePaneId === paneId && layout.panes.length > 1 && (
              <div
                className="absolute top-0 left-0 right-0 h-[2px] z-10"
                style={{ background: 'var(--color-accent)' }}
              />
            )}
            {/* Pane title tab */}
            {layout.panes.length > 1 && (
              <div
                className="h-[24px] flex items-center px-2 text-[10px] shrink-0 justify-between"
                style={{
                  background: activePaneId === paneId
                    ? 'var(--color-background-primary)'
                    : 'var(--color-background-secondary)',
                  color: activePaneId === paneId
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-tertiary)',
                  borderBottom: '0.5px solid var(--color-border-tertiary)',
                }}
                onClick={() => setActivePaneId(paneId)}
              >
                <span>{panes[paneId]?.title || paneId}</span>
                <span
                  className="ml-2 rounded hover:opacity-100 opacity-50 cursor-pointer flex items-center justify-center"
                  style={{ width: 14, height: 14 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    closePane(paneId)
                  }}
                  title="Close"
                >
                  <X size={10} />
                </span>
              </div>
            )}
            <div className="flex-1 overflow-hidden" style={{ height: layout.panes.length > 1 ? 'calc(100% - 24px)' : '100%' }}>
              <PaneEditor paneId={paneId} />
            </div>
          </div>
        ))}
      </div>
    )
  }

  // Grid layout - future
  return <div>Unsupported layout</div>
}
