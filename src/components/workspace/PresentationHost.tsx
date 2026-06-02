/**
 * FluxText - Presentation Host
 * Renders the active presentation session using the registered renderer.
 * Replaces the normal pane editor(s) when a presentation is active.
 */

import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { presentationRegistry } from '../../workspace/presentationRegistry'
import { releaseOccupancy } from '../../workspace/surfaceCoordinator'
import type { PresentationSession } from '../../workspace/types'

interface PresentationHostProps {
  session: PresentationSession
}

export function PresentationHost({ session }: PresentationHostProps) {
  const closePresentation = useWorkspaceStore((s) => s.closePresentation)
  const updatePresentationOptions = useWorkspaceStore((s) => s.updatePresentationOptions)

  const rendererDef = presentationRegistry.get(session.renderer)

  if (!rendererDef) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Unknown renderer: {session.renderer}
        </span>
      </div>
    )
  }

  const handleClose = () => {
    // Release occupancy for this presentation
    const occupancyId = `presentation:${session.id}`
    releaseOccupancy(occupancyId)
    closePresentation(session.id)
  }

  const handleUpdate = (options: Record<string, unknown>) => {
    updatePresentationOptions(session.id, options)
  }

  const RendererComponent = rendererDef.component

  return (
    <div className="flex-1 overflow-hidden h-full">
      <RendererComponent
        session={session}
        onClose={handleClose}
        onUpdate={handleUpdate}
      />
    </div>
  )
}
