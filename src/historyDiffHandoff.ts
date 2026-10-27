import type { DiffSourcePayload } from './workspace/diffTypes'

export function createDiffPageTarget(payload: { original: DiffSourcePayload; modified: DiffSourcePayload }) {
  const serialize = (side: DiffSourcePayload) => ({
    sourceId: side.sourceId, kind: side.kind, paneId: side.paneId, origin: side.origin,
    title: side.title ?? '', language: side.language, text: side.text ?? '',
  })
  return {
    source: 'builtin' as const, pluginId: 'text-diff', surfaceId: 'main',
    initialText: JSON.stringify({ original: serialize(payload.original), modified: serialize(payload.modified) }),
  }
}
