import { useState } from 'react'
import { useAppStore } from '../../store'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { applyEffects } from '../../workspace/effectRunner'
import { X, ChevronDown } from 'lucide-react'
import { useT } from '../../i18n'

export function RenderStatusBar() {
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const pane = useWorkspaceStore((s) => s.panes[s.activePaneId])
  const paneOrder = useWorkspaceStore((s) => s.paneOrder)
  const presentations = useWorkspaceStore((s) => s.presentations)
  const panels = useWorkspaceStore((s) => s.panels)
  const paneRenderers = useWorkspaceStore((s) => s.paneRenderers)
  const panelInstancesV2 = useWorkspaceStore((s) => s.panelInstancesV2)
  const occupancies = useWorkspaceStore((s) => s.occupancies)
  const lastCommandStatus = useAppStore((s) => s.lastCommandStatus)
  const t = useT('workspace')
  const [menuOpen, setMenuOpen] = useState(false)

  const hasPresentations = Object.keys(presentations).length > 0
  const hasPanels = Object.keys(panels).length > 0
  const hasPaneRenderers = Object.keys(paneRenderers).length > 0
  const hasPanelInstancesV2 = Object.keys(panelInstancesV2).length > 0
  const hasOccupancies = Object.keys(occupancies).length > 0
  const activeRenderer = paneRenderers[activePaneId] ?? Object.values(paneRenderers).find((renderer) => rendererInputReferencesPane(renderer.rendererInputs, activePaneId))

  const commandStatusLabel = lastCommandStatus
    ? t(lastCommandStatus.status === 'running'
      ? 'status.commandRunning'
      : lastCommandStatus.status === 'success'
        ? 'status.commandSuccess'
        : 'status.commandError')
    : ''
  const commandStatusColor = lastCommandStatus?.status === 'success'
    ? 'var(--color-success-text)'
    : lastCommandStatus?.status === 'error'
      ? 'var(--color-error-text)'
      : 'var(--color-text-secondary)'

  return (
    <div
      className="statusbar shrink-0 relative"
    >
      {/* Active Pane */}
      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {t('status.active')}: {pane?.title || activePaneId}
      </span>

      {/* Renderer */}
      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {t('status.renderer')}: {activeRenderer?.rendererId ?? t('status.code')}
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
          {t('status.panel')}: {panel.title}
        </span>
      ))}

      {hasPanelInstancesV2 && Object.values(panelInstancesV2).map((panel) => (
        <span key={panel.panelId} className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          {t('status.panel')}: {panel.title ?? panel.panelId}
        </span>
      ))}

      {/* Status menu toggle */}
      {hasOccupancies && (
        <button
          className="ml-auto text-[10px] flex items-center gap-0.5 hover:opacity-70"
          style={{ color: 'var(--color-text-tertiary)' }}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {t('status.status')} <ChevronDown size={10} />
        </button>
      )}

      {lastCommandStatus && (
        <span
          className={`${hasOccupancies ? '' : 'ml-auto'} text-[10px] min-w-0 max-w-[40vw] truncate`}
          style={{ color: commandStatusColor }}
          title={lastCommandStatus.message ? `${lastCommandStatus.title}: ${lastCommandStatus.message}` : lastCommandStatus.title}
        >
          {t('status.lastCommand')}: {lastCommandStatus.title} · {commandStatusLabel}
        </span>
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
            {t('status.rendering')}
          </div>
          <div className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
            {t('status.main')}: {t('status.codeEditor')}
          </div>
          {Object.values(presentations).map((session) => (
            <div key={session.id} className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
              {t('status.presentation')}: {session.renderer}
            </div>
          ))}
          {Object.values(panels).map((panel) => (
            <div key={panel.id} className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
              {t('status.panel')}: {panel.title}
            </div>
          ))}
          {Object.entries(paneRenderers).map(([paneId, renderer]) => (
            <div key={paneId} className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
              {t('status.pane')} {paneId}: {renderer.rendererId}
            </div>
          ))}
          {Object.values(panelInstancesV2).map((panel) => (
            <div key={panel.panelId} className="px-3 py-1 text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
              {t('status.panel')}: {panel.title ?? panel.panelId}
            </div>
          ))}

          <div className="my-1" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }} />
          <div className="px-3 py-1 text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('status.actions')}
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
              {t('status.exit')} {occ.title}
            </button>
          ))}
          <button
            className="w-full text-left px-3 py-1 text-[11px] hover:bg-[var(--color-background-secondary)]"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => setMenuOpen(false)}
          >
            {t('status.closeMenu')}
          </button>
        </div>
      )}
    </div>
  )
}

function rendererInputReferencesPane(value: unknown, paneId: string): boolean {
  if (!value || typeof value !== 'object') return false
  if ((value as { kind?: unknown }).kind === 'pane' && (value as { paneId?: unknown }).paneId === paneId) return true
  if (Array.isArray(value)) return value.some((item) => rendererInputReferencesPane(item, paneId))
  return Object.values(value as Record<string, unknown>).some((item) => rendererInputReferencesPane(item, paneId))
}
