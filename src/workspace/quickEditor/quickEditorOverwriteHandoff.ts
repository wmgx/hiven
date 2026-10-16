import type { QuickEditorOverwriteOptions } from './quickEditorTypes'

const PROBE = 'hiven://quick-editor-overwrite-probe'
const READY = 'hiven://quick-editor-overwrite-ready'
const REQUEST = 'hiven://quick-editor-overwrite'
const REPLY = 'hiven://quick-editor-overwrite-reply'
const TIMEOUT_MS = 8_000
export type OverwriteReceipt = { paneId: string; historyCount: number }
type Request = { id: string; owner: string; expires: number; text: string; options: QuickEditorOverwriteOptions }
type Reply = { id: string; owner: string; ready?: boolean; result?: OverwriteReceipt; failed?: boolean }
export type QuickEditorOverwriteLifecycle = {
  signal?: AbortSignal
  isCurrent?: () => boolean
  /** Called at the last cancellable boundary, immediately before target delivery. */
  onCommit?: () => void
}

/** Only the detached editor registers this receiver. No source-selected pane or history. */
export async function listenForQuickEditorOverwrites(commit: (text: string, options: QuickEditorOverwriteOptions) => OverwriteReceipt): Promise<() => void> {
  const { listen, emit } = await import('@tauri-apps/api/event')
  const owner = crypto.randomUUID()
  let alive = true
  const receipts = new Map<string, { reply: Reply; expires: number }>()
  const stopRequest = await listen<Request>(REQUEST, ({ payload }) => {
    if (!alive || !payload || payload.owner !== owner || typeof payload.id !== 'string'
      || payload.id.length > 100 || !Number.isFinite(payload.expires) || payload.expires <= Date.now()
      || payload.expires > Date.now() + TIMEOUT_MS || typeof payload.text !== 'string'
      || !payload.options || (payload.options.language !== undefined && typeof payload.options.language !== 'string')
      || (payload.options.source !== undefined && typeof payload.options.source !== 'string')) return
    for (const [id, receipt] of receipts) if (receipt.expires <= Date.now()) receipts.delete(id)
    let receipt = receipts.get(payload.id)
    if (!receipt) {
      let reply: Reply = { id: payload.id, owner, failed: true }
      // Bound receipts for the entire request lifetime: never evict a live receipt
      // and accidentally perform the same overwrite twice.
      if (receipts.size < 64) {
        try { reply = { id: payload.id, owner, result: commit(payload.text, payload.options) } } catch { /* Original draft stays intact on failed persistence. */ }
        receipt = { reply, expires: payload.expires }
        receipts.set(payload.id, receipt)
      } else receipt = { reply, expires: payload.expires }
    }
    void emit(REPLY, receipt.reply).catch(() => undefined)
  })
  let stopProbe: (() => void) | undefined
  try {
    stopProbe = await listen<{ id: string }>(PROBE, ({ payload }) => {
      if (alive && typeof payload?.id === 'string' && payload.id.length <= 100) {
        void emit(REPLY, { id: payload.id, owner, ready: true } satisfies Reply).catch(() => undefined)
      }
    })
    await emit(READY, { owner })
  } catch (error) { alive = false; stopRequest(); stopProbe?.(); throw error }
  return () => { alive = false; stopRequest(); stopProbe?.(); receipts.clear() }
}

/** Install response listeners before showing a new window; its ready signal retries only the probe. */
export async function requestQuickEditorOverwrite(text: string, options: QuickEditorOverwriteOptions, show: () => Promise<void>, lifecycle?: QuickEditorOverwriteLifecycle): Promise<OverwriteReceipt> {
  const { listen, emitTo } = await import('@tauri-apps/api/event')
  const id = crypto.randomUUID()
  const expires = Date.now() + TIMEOUT_MS
  return new Promise<OverwriteReceipt>((resolve, reject) => {
    let finished = false
    let committed = false
    let owner: string | undefined
    const stops: (() => void)[] = []
    let abort = () => {}
    const current = () => !finished && (committed || (!lifecycle?.signal?.aborted && lifecycle?.isCurrent?.() !== false))
    const finish = (result?: OverwriteReceipt) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      lifecycle?.signal?.removeEventListener('abort', abort)
      for (const stop of stops) stop()
      if (result) resolve(result)
      else reject(new Error('QuickEditorOverwriteFailed'))
    }
    const timer = setTimeout(() => finish(), TIMEOUT_MS)
    abort = () => { if (!committed) finish() }
    lifecycle?.signal?.addEventListener('abort', abort, { once: true })
    const probe = () => { if (current() && !owner) void emitTo('quick-editor', PROBE, { id }).catch(() => finish()) }
    const keep = (stop: () => void) => { if (finished) stop(); else stops.push(stop) }
    void (async () => {
      if (!current()) return finish()
      keep(await listen<Reply>(REPLY, ({ payload }) => {
        if (!current() || !payload || payload.id !== id || Date.now() >= expires) return
        if (payload.ready && !owner && typeof payload.owner === 'string') {
          owner = payload.owner
          if (!current()) return finish()
          committed = true
          lifecycle?.onCommit?.()
          void emitTo('quick-editor', REQUEST, { id, owner, expires, text, options } satisfies Request).catch(() => finish())
        } else if (owner && payload.owner === owner && !payload.ready) {
          finish(payload.result)
        }
      }))
      if (finished) return
      keep(await listen(READY, probe))
      if (!current()) return finish()
      await show()
      if (!current()) return finish()
      probe()
    })().catch(() => finish())
  })
}
