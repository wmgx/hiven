import type { DiffSource } from '@hiven/plugin-diff'

/** Each comparison side owns one reader; a newer choice or edit revokes its pending read. */
export function createDiffSourceReader() {
  let revision = 0

  return {
    invalidate() {
      revision += 1
    },
    async select(
      source: DiffSource,
      readClipboardText: () => Promise<string>,
      setSource: (source: DiffSource) => void,
      onReadFailed: () => void,
    ): Promise<void> {
      const requestRevision = ++revision
      try {
        const text = source.kind === 'clipboard' ? await readClipboardText() : source.text ?? ''
        if (requestRevision !== revision) return
        // Source picks import snapshots; they must not acquire editor write-through bindings.
        setSource({ sourceId: source.sourceId, kind: 'empty', title: source.title, text })
      } catch {
        if (requestRevision === revision) onReadFailed()
      }
    },
  }
}
