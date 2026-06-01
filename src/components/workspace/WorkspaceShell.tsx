import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { useAppStore } from '../../store'
import { PaneEditor } from './PaneEditor'
import { PresentationHost } from './PresentationHost'
import { RendererHost } from './RendererHost'
import { X } from 'lucide-react'
import { t } from '../../i18n'
import type { PaneId, PaneRendererState } from '../../workspace/types'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'

export function WorkspaceShell() {
  const layout = useWorkspaceStore((s) => s.layout)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const panes = useWorkspaceStore((s) => s.panes)
  const presentations = useWorkspaceStore((s) => s.presentations)
  const paneRenderers = useWorkspaceStore((s) => s.paneRenderers)
  const closePane = useWorkspaceStore((s) => s.closePane)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
  const locale = useAppStore((s) => s.locale)
  const registryVersion = usePluginRegistryVersion()
  const workspaceRenderer = findWorkspaceRenderer(activePaneId, paneRenderers, registryVersion)

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

  if (workspaceRenderer) {
    return (
      <WorkspaceRendererSurface
        paneId={workspaceRenderer.paneId}
        rendererState={workspaceRenderer.rendererState}
      />
    )
  }

  if (layout.type === 'single') {
    const paneId = layout.panes[0]
    return (
      <div className="flex flex-col flex-1 overflow-hidden h-full">
        <div className="flex-1 overflow-hidden">
          <PaneEditor paneId={paneId} />
        </div>
      </div>
    )
  }

  if (layout.type === 'split') {
    const isHorizontal = layout.direction === 'horizontal'
    return (
      <div className="flex flex-col flex-1 overflow-hidden h-full">
        <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} flex-1 overflow-hidden`}>
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
                    title={t(locale, 'workspace.close')}
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
      </div>
    )
  }

  // Grid layout - future
  return <div>Unsupported layout</div>
}

function WorkspaceRendererSurface({
  paneId,
  rendererState,
}: {
  paneId: PaneId
  rendererState: PaneRendererState
}) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      <RendererHost paneId={paneId} rendererState={rendererState} />
    </div>
  )
}

function findWorkspaceRenderer(
  activePaneId: PaneId,
  paneRenderers: Record<PaneId, PaneRendererState>,
  _registryVersion: number
): { paneId: PaneId; rendererState: PaneRendererState } | null {
  void _registryVersion
  const entries = Object.entries(paneRenderers) as [PaneId, PaneRendererState][]
  const workspaceEntries = entries.filter(([, renderer]) => {
    const entry = pluginRegistry.resolveRenderer(renderer.rendererId, renderer.isDevRenderer)
    return entry?.contribution.surface === 'workspace'
  })
  const activeEntry = workspaceEntries.find(([paneId, renderer]) => (
    paneId === activePaneId || rendererInputReferencesPane(renderer.rendererInputs, activePaneId)
  ))
  const entry = activeEntry ?? workspaceEntries[0]
  if (!entry) return null
  return { paneId: entry[0], rendererState: entry[1] }
}

function rendererInputReferencesPane(value: unknown, paneId: PaneId): boolean {
  if (!value || typeof value !== 'object') return false
  if ((value as { kind?: unknown }).kind === 'pane' && (value as { paneId?: unknown }).paneId === paneId) return true
  if (Array.isArray(value)) return value.some((item) => rendererInputReferencesPane(item, paneId))
  return Object.values(value as Record<string, unknown>).some((item) => rendererInputReferencesPane(item, paneId))
}
