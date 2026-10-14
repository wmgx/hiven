export type TextResultHudUpdate<T> = {
  revision: number
  snapshot: T | null
  fullText?: string
}

export type TextResultHudRenderState<T> = {
  generation: number
  snapshot: (T & { fullText?: string }) | null
}

/** Native revision is process-global, so it orders updates across products and dismissals. */
export function acceptTextResultHudUpdate<T extends object>(
  current: TextResultHudRenderState<T>,
  update: TextResultHudUpdate<T>,
): TextResultHudRenderState<T> {
  if (!Number.isSafeInteger(update.revision) || update.revision <= current.generation) return current
  return {
    generation: update.revision,
    snapshot: update.snapshot ? { ...update.snapshot, fullText: update.fullText } : null,
  }
}
