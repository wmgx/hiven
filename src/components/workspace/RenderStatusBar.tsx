import { useState } from 'react'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { useAppStore } from '../../store'
import { applyEffects } from '../../workspace/effectRunner'
import { X, ChevronDown } from 'lucide-react'

export function RenderStatusBar() {
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const pane = useWorkspaceStore((s) => s.panes[s.activePaneId])
  const paneOrder = useWorkspaceStore((s) => s.paneOrder)
  const presentations = useWorkspaceStore((s) => s.presentations)
  const panels = useWorkspaceStore((s) => s.panels)
  const occupancies = useWorkspaceStore((s) => s.occupancies)
  const [menuOpen, setMenuOpen] = useState(false)

  const hasPresentations = Object.keys(presentations).length > 0
  const hasPanels = Object.keys(panels).length > 0
  const hasOccupancies = Object.keys(occupancies).length > 0

  // Only show when multiple panes or active presentations/panels
  if (paneOrder.length <= 1 && !hasPresentations && !hasPanels) return null

  return (
    <div
      className="h-[22px] flex items-center px-3 gap-3 shrink-0 relative"
      style={{
        borderTop: '0.5px solid var(--color-border-tertiary)',
        background: 'var(--color-background-secondary)',
      }}
    >
      {/* Active Pane */}
      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Active: {pane?.title || activePaneId}
      </span>

      {/* Renderer */}
      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Renderer: Code
      </span>

      {/* Presentations */}
      {hasPresentations && Object.values(presentations).map((session) => (
        <span key={session.id} className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-accent)' }}>
          {session.statusLabel || session.renderer}
          <button
            className="hover:opacity-70"
            onClick={() => {
              applyEffects([{ type: 'presentation.close', sessionId: session.id }])
            }}
          >
            <X size={10} />
          </button>
        </span>
      ))}

      {/* Panels */}
      {hasPanels && Object.values(panels).map((panel) => (
        <span key={panel.id} className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          Panel: {panel.title}
        </span>
      ))}

      {/* Status menu toggle */}
      {hasOccupancies && (
        <button
          className="ml-auto text-[10px] flex items-center gap-0.5 hover:opacity-70"
          style={{ color: 'var(--color-text-tertiary)' }}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          Status <ChevronDown size={10} />
        </button>
      )}

      {/* Status menu dropdown */}
      {menuOpen && (
        <div
          className="absolute bottom-full right-2 mb-1 py-1 rounded-md shadow-lg z-50 min-w-[180px]"
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-secondary)',
          }}
        >
          <div className="px-3 py-1 text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            Rendering
          </div>
          <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
            Main: Code Editor
          </div>
          {Object.values(presentations).map((session) => (
            <div key={session.id} className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
              Presentation: {session.renderer}
            </div>
          ))}
          {Object.values(panels).map((panel) => (
            <div key={panel.id} className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
              Panel: {panel.title}
            </div>
          ))}

          <div className="my-1" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }} />
          <div className="px-3 py-1 text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            Actions
          </div>
          {Object.values(occupancies).map((occ) => (
            <button
              key={occ.id}
              className="w-full text-left px-3 py-1 text-[11px] hover:bg-[var(--color-background-secondary)]"
              style={{ color: 'var(--color-error-text)' }}
              onClick={() => {
                if (occ.ownerKind === 'presentation') {
                  const sessionId = occ.ownerId.replace('presentation:', '')
                  applyEffects([{ type: 'presentation.close', sessionId }])
                } else if (occ.ownerKind === 'panel') {
                  const instanceId = occ.ownerId.replace('panel:', '')
                  applyEffects([{ type: 'panel.close', instanceId }])
                }
                setMenuOpen(false)
              }}
            >
              Exit {occ.title}
            </button>
          ))}
          <button
            className="w-full text-left px-3 py-1 text-[11px] hover:bg-[var(--color-background-secondary)]"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => setMenuOpen(false)}
          >
            Close menu
          </button>
        </div>
      )}
    </div>
  )
}
