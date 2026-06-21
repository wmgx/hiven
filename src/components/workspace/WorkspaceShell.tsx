import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { PaneEditor } from './PaneEditor'
import { PresentationHost } from './PresentationHost'
import { RendererHost } from './RendererHost'
import type { PaneId, PaneRendererState } from '../../workspace/types'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'

export function WorkspaceShell() {
  const layout = useWorkspaceStore((s) => s.layout)
  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const panes = useWorkspaceStore((s) => s.panes)
  const presentations = useWorkspaceStore((s) => s.presentations)
  const paneRenderers = useWorkspaceStore((s) => s.paneRenderers)
  const setActivePaneId = useWorkspaceStore((s) => s.setActivePaneId)
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
              onPointerDownCapture={() => setActivePaneId(paneId)}
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
              <div className="flex-1 overflow-hidden h-full">
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
