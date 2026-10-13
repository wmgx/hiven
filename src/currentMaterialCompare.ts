import { createDiffPageTarget } from './historyDiffHandoff'

export const CURRENT_MATERIAL_COMPARE_ACTION = 'compare-previous-material'
export const MATERIAL_COMPARE_MAX_BYTES = 1024 * 1024
export type MaterialTextPair = { previous: string; current: string; isCurrent: () => boolean }
export type MaterialCompareError = 'too-large' | 'unavailable'

/** Host-only in-memory snapshots. No History permission or plugin API is added. */
export function createMaterialComparison() {
  let pending = false
  return async (pair: MaterialTextPair, options: {
    prepare: () => Promise<void>
    available: () => boolean
    titles: { previous: string; current: string }
    open: (target: ReturnType<typeof createDiffPageTarget>) => void
  }): Promise<MaterialCompareError | null> => {
    if (pending || !pair.isCurrent()) return null
    pending = true
    try {
      if (pair.previous.length > MATERIAL_COMPARE_MAX_BYTES || pair.current.length > MATERIAL_COMPARE_MAX_BYTES ||
        new TextEncoder().encode(pair.previous).byteLength + new TextEncoder().encode(pair.current).byteLength > MATERIAL_COMPARE_MAX_BYTES) return 'too-large'
      await options.prepare()
      if (!pair.isCurrent()) return null
      if (!options.available()) return 'unavailable'
      const target = createDiffPageTarget({
        original: { sourceId: 'material:previous', kind: 'empty', title: options.titles.previous, text: pair.previous },
        modified: { sourceId: 'material:current', kind: 'empty', title: options.titles.current, text: pair.current },
      })
      if (pair.isCurrent()) options.open(target)
      return null
    } catch {
      return pair.isCurrent() ? 'unavailable' : null
    } finally { pending = false }
  }
}
