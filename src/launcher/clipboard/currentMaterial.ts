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
  // Preserve the literal-text safety boundary through repeated handoffs. The
  // incoming result may be independent (for example merged history), so this
  // does not establish that it came from the previous file.
  const textOrigin = current.block?.meta?.textOrigin
  const nextBlock = block.source === 'tool-result' && textOrigin === 'file-content' && !block.meta?.textOrigin
    ? { ...block, meta: { ...block.meta, textOrigin } }
    : block
  return {
    block: nextBlock,
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

/** Only text payloads may enter the editor; media paths and masked secrets are not text material. */
export function canEditMaterialText(block: LauncherObjectBlock | null): boolean {
  return Boolean(block && typeof block.payloadText === 'string' &&
    !block.payloadText.includes('\0') && !block.secretMasked && block.kind !== 'secret' && block.kind !== 'secret-like' &&
    block.kind !== 'image' && block.kind !== 'files' && !block.payloadImage && !block.payloadFiles)
}

/** Textarea uses LF; keep unchanged text exact and preserve uniform CRLF drafts. */
export function reconcileMaterialTextInput(previous: string, next: string): string {
  if (previous === next) return previous
  const normalized = previous.replace(/\r\n|\r/g, '\n')
  if (normalized === next) return previous
  const lineEndings = previous.match(/\r\n|\r|\n/g)
  return lineEndings?.every((ending) => ending === '\r\n')
    ? next.replace(/\n/g, '\r\n')
    : next
}
