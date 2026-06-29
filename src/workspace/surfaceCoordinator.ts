/**
 * hiven Workspace Extension - Surface Coordinator
 * Manages surface occupancy, conflict detection, and exit policies.
 */

import type {
  SurfaceId,
  SurfaceClaim,
  SurfaceOccupancy,
  ConflictPolicy,
  ExitPolicy,
  PaneId,
} from './types'
import { useWorkspaceStore } from './workspaceStore'
import { runtimeRegistry } from './runtimeRegistry'

function isEditorWindowRuntime(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'editor'
  } catch {
    return false
  }
}

function readEditorOccupancies(): Record<string, SurfaceOccupancy> {
  return isEditorWindowRuntime() ? useWorkspaceStore.getState().occupancies : {}
}

// ─── Conflict Detection ─────────────────────────────────────────────────────

export interface ConflictInfo {
  existingOccupancy: SurfaceOccupancy
  conflictingSurface: SurfaceId
  newClaim: SurfaceClaim
}

/**
 * Check if new surface claims conflict with existing occupancies.
 * Returns list of conflicts that need resolution.
 */
export function detectConflicts(
  newClaims: SurfaceClaim[],
  newOwnerId: string
): ConflictInfo[] {
  const occupancies = readEditorOccupancies()
  const conflicts: ConflictInfo[] = []

  for (const claim of newClaims) {
    if (claim.mode === 'shared') continue // Shared never conflicts

    // Check all existing occupancies for exclusive conflicts
    for (const [, occupancy] of Object.entries(occupancies)) {
      if (occupancy.ownerId === newOwnerId) continue // Same owner, no conflict

      for (const existingSurface of occupancy.surfaces) {
        if (existingSurface.surfaceId === claim.surfaceId) {
          if (existingSurface.mode === 'exclusive' || claim.mode === 'exclusive') {
            conflicts.push({
              existingOccupancy: occupancy,
              conflictingSurface: claim.surfaceId,
              newClaim: claim,
            })
          }
        }
      }
    }
  }

  return conflicts
}

/**
 * Resolve a conflict based on the given policy.
 * Returns true if the new claim can proceed, false if rejected.
 */
export function resolveConflict(
  conflict: ConflictInfo,
  policy: ConflictPolicy
): 'proceed' | 'reject' | 'ask' {
  switch (policy) {
    case 'reject':
      return 'reject'
    case 'replace':
      return 'proceed'
    case 'reuse-if-same-owner':
      // Already handled in detectConflicts (same owner skipped)
      return 'ask'
    case 'stack-if-supported':
      if (conflict.newClaim.mode === 'stacked') return 'proceed'
      return 'ask'
    case 'ask':
    default:
      return 'ask'
  }
}

// ─── Occupancy Management ───────────────────────────────────────────────────

/**
 * Register a new surface occupancy.
 */
export function registerOccupancy(occupancy: SurfaceOccupancy) {
  if (!isEditorWindowRuntime()) return
  const state = useWorkspaceStore.getState()
  const occupancies = { ...state.occupancies, [occupancy.id]: occupancy }
  useWorkspaceStore.setState({ occupancies })
}

/**
 * Release an occupancy and clean up associated resources.
 */
export function releaseOccupancy(occupancyId: string) {
  if (!isEditorWindowRuntime()) return
  const state = useWorkspaceStore.getState()
  const occupancy = state.occupancies[occupancyId]
  if (!occupancy) return

  // Clean up runtime resources for this owner
  runtimeRegistry.disposeOwner(occupancy.ownerId)

  // Remove from store
  const occupancies = { ...state.occupancies }
  delete occupancies[occupancyId]
  useWorkspaceStore.setState({ occupancies })
}

/**
 * Execute exit policy for an occupancy.
 */
export function executeExitPolicy(occupancyId: string): boolean {
  if (!isEditorWindowRuntime()) return true
  const state = useWorkspaceStore.getState()
  const occupancy = state.occupancies[occupancyId]
  if (!occupancy) return true

  const { exitPolicy } = occupancy

  switch (exitPolicy.closeBehavior) {
    case 'dispose-only':
      releaseOccupancy(occupancyId)
      return true

    case 'restore-view':
      // Restore previous renderer from render stack (handled by caller)
      releaseOccupancy(occupancyId)
      return true

    case 'confirm-if-dirty':
      // For now, always allow (UI confirmation will be in component layer)
      releaseOccupancy(occupancyId)
      return true

    case 'custom':
      releaseOccupancy(occupancyId)
      return true

    default:
      releaseOccupancy(occupancyId)
      return true
  }
}

// ─── Surface ID Helpers ─────────────────────────────────────────────────────

export function paneSurfaceId(paneId: PaneId, layer: 'renderer' | 'inline-layer' | 'decorations'): SurfaceId {
  return `pane:${paneId}:${layer}`
}

export function panelSurfaceId(position: 'left' | 'right' | 'bottom' | 'floating'): SurfaceId {
  return `panel:${position}`
}

export const WORKSPACE_MAIN_SURFACE: SurfaceId = 'workspace:main'

// ─── Query Helpers ──────────────────────────────────────────────────────────

/**
 * Get all occupancies for a given surface.
 */
export function getOccupanciesForSurface(surfaceId: SurfaceId): SurfaceOccupancy[] {
  return Object.values(readEditorOccupancies()).filter((occ) =>
    occ.surfaces.some((s) => s.surfaceId === surfaceId)
  )
}

/**
 * Get all occupancies owned by a specific owner.
 */
export function getOccupanciesByOwner(ownerId: string): SurfaceOccupancy[] {
  return Object.values(readEditorOccupancies()).filter((occ) => occ.ownerId === ownerId)
}

/**
 * Check if a surface is currently occupied exclusively.
 */
export function isSurfaceExclusivelyOccupied(surfaceId: SurfaceId): boolean {
  return Object.values(readEditorOccupancies()).some((occ) =>
    occ.surfaces.some((s) => s.surfaceId === surfaceId && s.mode === 'exclusive')
  )
}
