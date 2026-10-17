/** Session-only snapshots. Never persist this state or use a list preview as text. */
export type ClipboardQueueSnapshot = Readonly<{ id: string; text: string }>
export const CLIPBOARD_QUEUE_MAX_ITEMS = 20
export const CLIPBOARD_QUEUE_MAX_BYTES = 1024 * 1024

export type ClipboardQueueState = Readonly<{
  version: number
  phase: 'idle' | 'ready' | 'failed' | 'completed' | 'cancelled'
  busy: boolean
  total: number
  completed: number
  remaining: number
  current: ClipboardQueueSnapshot | null
}>

export type ClipboardQueueDelivery = Readonly<{
  snapshot: ClipboardQueueSnapshot
  signal: AbortSignal
  /** Host must check before clipboard write and before native target handoff. */
  isCurrent: () => boolean
}>
export type ClipboardQueueOutcome = 'delivered' | 'failed' | 'stale' | 'busy' | 'empty'
export type ClipboardQueueOwner = {
  isCurrent(): boolean
  subscribeInvalidation?(listener: () => void): () => void
}

export function validateQueueSnapshots(items: readonly ClipboardQueueSnapshot[]): readonly ClipboardQueueSnapshot[] {
  if (items.length < 1 || items.length > CLIPBOARD_QUEUE_MAX_ITEMS) throw new Error('QueueCountError')
  const seen = new Set<string>()
  let bytes = 0
  const snapshots = items.map((item) => {
    if (!item || typeof item.id !== 'string' || !item.id || typeof item.text !== 'string' || seen.has(item.id)) {
      throw new Error('QueueSnapshotError')
    }
    seen.add(item.id)
    if (item.text.length > CLIPBOARD_QUEUE_MAX_BYTES) throw new Error('QueueSizeError')
    bytes += new TextEncoder().encode(item.text).byteLength
    if (bytes > CLIPBOARD_QUEUE_MAX_BYTES) throw new Error('QueueSizeError')
    return Object.freeze({ id: item.id, text: item.text })
  })
  return Object.freeze(snapshots)
}

/**
 * One explicit next() call attempts one full plain-text snapshot. No timers or
 * clipboard/history reads. A pending native attempt remains an exclusion fence
 * after cancel/replace until it settles: an uncancellable old transport must not
 * overlap a newer clipboard write. Aborting is cooperative, not a paste undo.
 */
export function createClipboardPasteQueue(options: {
  deliver: (attempt: ClipboardQueueDelivery) => Promise<{ ok: boolean }>
  owner?: ClipboardQueueOwner
}) {
  let snapshots: readonly ClipboardQueueSnapshot[] = []
  let version = 0
  let completed = 0
  let phase: ClipboardQueueState['phase'] = 'idle'
  let flight: AbortController | null = null
  let disposed = false
  const listeners = new Set<() => void>()
  let state: ClipboardQueueState
  const ownerCurrent = () => !disposed && (options.owner?.isCurrent() ?? true)
  const publish = () => {
    state = Object.freeze({ version, phase, busy: flight !== null, total: snapshots.length,
      completed, remaining: snapshots.length - completed, current: snapshots[completed] ?? null })
    for (const listener of listeners) listener()
  }
  const cancel = () => {
    version += 1
    flight?.abort()
    snapshots = []
    completed = 0
    phase = 'cancelled'
    publish()
  }
  publish()
  const unsubscribeOwner = options.owner?.subscribeInvalidation?.(cancel)
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    replace(items: readonly ClipboardQueueSnapshot[]) {
      if (!ownerCurrent()) throw new Error('QueueOwnerError')
      // Validation failures leave the existing queue and its attempt untouched.
      const next = validateQueueSnapshots(items)
      version += 1
      flight?.abort()
      snapshots = next
      completed = 0
      phase = 'ready'
      publish()
    },
    cancel,
    dispose() { if (disposed) return; disposed = true; unsubscribeOwner?.(); cancel(); listeners.clear() },
    async next(): Promise<ClipboardQueueOutcome> {
      if (!ownerCurrent()) { cancel(); return 'stale' }
      if (flight) return 'busy'
      const snapshot = snapshots[completed]
      if (!snapshot) return 'empty'
      const requestedVersion = version
      const controller = new AbortController()
      flight = controller
      const isCurrent = () => ownerCurrent() && !controller.signal.aborted && version === requestedVersion && flight === controller
      publish()
      let success = false
      try {
        // A subscriber can synchronously cancel while observing busy.
        if (isCurrent()) success = (await options.deliver({ snapshot, signal: controller.signal, isCurrent })).ok === true
      } catch {
        // Native errors can contain user text, paths or app details. UI uses an i18n failure key.
      }
      const current = isCurrent()
      flight = null
      if (!current) {
        if (!ownerCurrent() && snapshots.length) cancel()
        else publish()
        return 'stale'
      }
      if (success) {
        completed += 1
        phase = completed === snapshots.length ? 'completed' : 'ready'
        if (phase === 'completed') {
          // Retain only counts after completion; release all text references.
          snapshots = Object.freeze(snapshots.map((item) => Object.freeze({ id: item.id, text: '' })))
        }
      } else phase = 'failed'
      publish()
      return success ? 'delivered' : 'failed'
    },
  }
}
