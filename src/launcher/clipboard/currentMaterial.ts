import type { LauncherObjectBlock } from './objectBlock'

/** One previous material, owned only by the current launcher hook session. */
export type CurrentMaterial = {
  block: LauncherObjectBlock | null
  previousBlock: LauncherObjectBlock | null
  lastHandoffKey: string | null
}

export function replaceCurrentMaterial(block: LauncherObjectBlock | null): CurrentMaterial {
  return { block, previousBlock: null, lastHandoffKey: null }
}

export function acceptMaterialHandoff(
  current: CurrentMaterial,
  block: LauncherObjectBlock,
  canRestore: boolean,
): CurrentMaterial {
  const key = JSON.stringify([block.source, block.id, block.createdAt])
  // Silent backups and repeated delivery are the same handoff, including after
  // restoration. They must neither replace the original nor offer a redo.
  if (current.lastHandoffKey === key) return current
  return {
    block,
    previousBlock: canRestore && block.source === 'tool-result' ? current.block : null,
    lastHandoffKey: key,
  }
}

export function forgetPreviousMaterial(current: CurrentMaterial): CurrentMaterial {
  return { ...current, previousBlock: null }
}

export function discardCurrentMaterial(current: CurrentMaterial): CurrentMaterial {
  // Keep only the last handoff identity until new material or the session ends.
  // A repeated delivery cannot revive material the user removed or consumed.
  return { block: null, previousBlock: null, lastHandoffKey: current.lastHandoffKey }
}

export function restorePreviousMaterial(current: CurrentMaterial): CurrentMaterial {
  if (!current.previousBlock) return current
  return { ...current, block: current.previousBlock, previousBlock: null }
}
