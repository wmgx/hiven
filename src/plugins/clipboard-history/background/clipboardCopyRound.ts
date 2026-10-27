import type { ClipboardChange, PasteQueueStatus } from '@hiven/plugin'

type Snapshot = Readonly<{ id: string; text: string }>
type Queue = {
  setRound(id: string, items: readonly Snapshot[], options?: { full?: boolean }): void
  clear(): void
}

/** Product policy only; the background supplies the clock, classifier and host. */
export function createClipboardCopyRound(queue: Queue, now: () => number, isSecret: (text: string) => boolean) {
  let serial = 0
  let roundId = ''
  let items: Snapshot[] = []
  let lastCopy = 0
  let started = false
  let bytes = 0
  const reset = () => { roundId = ''; items = []; lastCopy = 0; started = false; bytes = 0 }
  return {
    change(change: ClipboardChange) {
      if (change.origin === 'hiven' || change.kind !== 'text' || !change.text.trim() || isSecret(change.text)) return
      const time = now()
      if (!roundId || (!started && time - lastCopy > 10_000)) {
        reset()
        roundId = `${time}-${++serial}`
      }
      lastCopy = time
      const duplicate = items.some((item) => item.text.trim() === change.text.trim())
      const size = new TextEncoder().encode(change.text).byteLength
      // Preserve the existing 1 MiB transport bound without truncating a copy.
      const full = items.length >= 20 || bytes + (duplicate ? 0 : size) > 1024 * 1024
      if (!duplicate && !full) {
        items.push({ id: `${roundId}:${items.length}`, text: change.text })
        bytes += size
      }
      if (items.length) queue.setRound(roundId, items, { full: full || items.length === 20 })
      else queue.clear()
    },
    status(status: PasteQueueStatus) {
      if (status.sessionId !== roundId) return
      if (status.phase === 'completed' || status.phase === 'cancelled') reset()
      else if (status.busy || status.completed > 0 || status.phase === 'failed') started = true
    },
    expire() {
      if (roundId && !started && now() - lastCopy >= 10 * 60_000) { reset(); queue.clear() }
    },
    stop() { reset(); queue.clear() },
  }
}
