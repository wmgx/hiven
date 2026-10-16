const PROBE = 'hiven://quick-editor-pane-write-probe'
const READY = 'hiven://quick-editor-pane-write-ready'
const REQUEST = 'hiven://quick-editor-pane-write-request'
const REPLY = 'hiven://quick-editor-pane-write-reply'
const SETTLED = 'hiven://quick-editor-pane-write-settled'
const TIMEOUT_MS = 4_000

export type QuickEditorPaneWrite = { paneId: string; text: string; expectedRevision: number }
export type QuickEditorPaneWriteReceipt = { updated: boolean; revision?: number }
type Probe = { id: string; paneId: string }
type Request = QuickEditorPaneWrite & { id: string; owner: string; expires: number }
type Reply = { id: string; owner: string; ready?: true; revision?: number; result?: QuickEditorPaneWriteReceipt; failed?: true }
type Settled = { id: string; owner: string }

export type QuickEditorPaneWriteLifecycle = {
  signal?: AbortSignal
  isCurrent?: () => boolean
  /** Called at the last cancellable boundary, immediately before target delivery. */
  onCommit?: () => void
}

/**
 * Register one renderer-local pane writer. A request is bound to this receiver
 * generation before delivery, so a remounted/moved owner cannot accept a stale
 * request. Live receipts make duplicate delivery idempotent for its lifetime.
 */
export async function listenForQuickEditorPaneWrites(
  receiver: {
    getRevision: (paneId: string) => number | undefined
    commit: (input: QuickEditorPaneWrite) => number | undefined
  },
): Promise<() => void> {
  const { listen, emit } = await import('@tauri-apps/api/event')
  const owner = crypto.randomUUID()
  let alive = true
  const receipts = new Map<string, { reply: Reply; expires: number }>()
  const settled = new Map<string, number>()

  const stopRequest = await listen<Request>(REQUEST, ({ payload }) => {
    const now = Date.now()
    if (!alive || !payload || payload.owner !== owner || typeof payload.id !== 'string'
      || payload.id.length > 100 || !Number.isFinite(payload.expires) || payload.expires <= now
      || payload.expires > now + TIMEOUT_MS || typeof payload.paneId !== 'string'
      || payload.paneId.length === 0 || payload.paneId.length > 200 || typeof payload.text !== 'string'
      || !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) return

    for (const [id, receipt] of receipts) if (receipt.expires <= now) receipts.delete(id)
    for (const [id, expires] of settled) if (expires <= now) settled.delete(id)
    if (settled.has(payload.id)) return
    let receipt = receipts.get(payload.id)
    if (!receipt) {
      let reply: Reply = { id: payload.id, owner, failed: true }
      // Do not evict a live receipt: doing so could apply one write twice.
      if (receipts.size < 64) {
        try {
          const revision = receiver.commit({
            paneId: payload.paneId,
            text: payload.text,
            expectedRevision: payload.expectedRevision,
          })
          reply = {
            id: payload.id,
            owner,
            result: Number.isSafeInteger(revision)
              ? { updated: true, revision }
              : { updated: false },
          }
        } catch { /* Failed owners never acknowledge success. */ }
        receipt = { reply, expires: payload.expires }
        receipts.set(payload.id, receipt)
      } else receipt = { reply, expires: payload.expires }
    }
    void emit(REPLY, receipt.reply).catch(() => undefined)
  })

  let stopProbe: (() => void) | undefined
  let stopSettled: (() => void) | undefined
  try {
    stopSettled = await listen<Settled>(SETTLED, ({ payload }) => {
      if (!alive || payload?.owner !== owner || typeof payload.id !== 'string') return
      const receipt = receipts.get(payload.id)
      if (!receipt) return
      receipts.delete(payload.id)
      settled.set(payload.id, receipt.expires)
    })
    stopProbe = await listen<Probe>(PROBE, ({ payload }) => {
      if (alive && typeof payload?.id === 'string' && payload.id.length <= 100
        && typeof payload.paneId === 'string' && payload.paneId.length > 0 && payload.paneId.length <= 200) {
        const revision = receiver.getRevision(payload.paneId)
        void emit(REPLY, {
          id: payload.id,
          owner,
          ready: true,
          ...(Number.isSafeInteger(revision) ? { revision } : {}),
        } satisfies Reply).catch(() => undefined)
      }
    })
    await emit(READY, { owner })
  } catch (error) {
    alive = false
    stopRequest()
    stopSettled?.()
    stopProbe?.()
    throw error
  }

  return () => {
    alive = false
    stopRequest()
    stopSettled?.()
    stopProbe?.()
    receipts.clear()
    settled.clear()
  }
}

/**
 * Deliver exactly once to the receiver generation currently mounted in the
 * requested native window. Cancellation is honored only before delivery.
 */
export async function requestQuickEditorPaneWrite(
  input: QuickEditorPaneWrite,
  targetWindowLabel: string,
  lifecycle?: QuickEditorPaneWriteLifecycle,
): Promise<QuickEditorPaneWriteReceipt> {
  const { listen, emitTo } = await import('@tauri-apps/api/event')
  const id = crypto.randomUUID()
  const expires = Date.now() + TIMEOUT_MS

  return new Promise<QuickEditorPaneWriteReceipt>((resolve, reject) => {
    let finished = false
    let committed = false
    let owner: string | undefined
    const stops: (() => void)[] = []
    let abort = () => {}
    const current = () => !finished && (committed || (!lifecycle?.signal?.aborted && lifecycle?.isCurrent?.() !== false))
    const stopAll = () => {
      clearTimeout(timer)
      lifecycle?.signal?.removeEventListener('abort', abort)
      for (const stop of stops) stop()
    }
    const fail = () => {
      if (finished) return
      finished = true
      stopAll()
      reject(new Error('QuickEditorPaneWriteFailed'))
    }
    const finish = (result: QuickEditorPaneWriteReceipt) => {
      if (finished) return
      finished = true
      stopAll()
      resolve(result)
    }
    const timer = setTimeout(fail, TIMEOUT_MS)
    abort = () => { if (!committed) fail() }
    lifecycle?.signal?.addEventListener('abort', abort, { once: true })
    const probe = () => {
      if (current() && !owner) void emitTo(targetWindowLabel, PROBE, { id, paneId: input.paneId } satisfies Probe).catch(fail)
    }
    const keep = (stop: () => void) => {
      if (finished) stop()
      else stops.push(stop)
    }

    void (async () => {
      if (!current()) return fail()
      keep(await listen<Reply>(REPLY, ({ payload }) => {
        if (!current() || !payload || payload.id !== id || Date.now() >= expires) return
        if (payload.ready && !owner && typeof payload.owner === 'string') {
          owner = payload.owner
          if (!Number.isSafeInteger(payload.revision) || payload.revision !== input.expectedRevision) {
            return finish({ updated: false })
          }
          if (!current()) return fail()
          committed = true
          lifecycle?.onCommit?.()
          void emitTo(targetWindowLabel, REQUEST, {
            id,
            owner,
            expires,
            paneId: input.paneId,
            text: input.text,
            expectedRevision: input.expectedRevision,
          } satisfies Request).catch(fail)
        } else if (owner && payload.owner === owner && !payload.ready) {
          if (!payload.result || typeof payload.result.updated !== 'boolean') return fail()
          void emitTo(targetWindowLabel, SETTLED, { id, owner } satisfies Settled).catch(() => undefined)
          finish(payload.result)
        }
      }))
      if (finished) return
      keep(await listen(READY, probe))
      if (!current()) return fail()
      probe()
    })().catch(fail)
  })
}
