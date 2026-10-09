import { emitTo, listen } from '@tauri-apps/api/event'
import { getCurrentWindow, Window } from '@tauri-apps/api/window'
import { showLauncherWindow } from '../../workspace/windowManager/launcherWindow'
import { LAUNCHER_WINDOW_LABEL } from '../../workspace/windowManager/windowLabels'
import type { LauncherObjectBlock } from './objectBlock'

const REQUEST_KEY = 'hiven:launcher-object-handoff'
const REQUEST_EVENT = 'hiven://launcher-object-handoff'
const REPLY_EVENT = 'hiven://launcher-object-handoff-reply'
const TIMEOUT_MS = 5_000

/** A native show command can return before the window is actually displayed. */
export async function showLauncherAfterObjectHandoff(isCurrent: () => boolean): Promise<boolean> {
  try {
    if (!isCurrent()) return false
    await showLauncherWindow()
    const launcher = await Window.getByLabel(LAUNCHER_WINDOW_LABEL)
    if (!launcher) return false
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!isCurrent()) return false
      if (await launcher.isVisible()) return isCurrent()
      await new Promise<void>((resolve) => setTimeout(resolve, 50))
    }
  } catch { /* The source remains available to display the failure. */ }
  return false
}

type Request = {
  id: string
  sender: string
  expiresAt: number
} & ({ block: LauncherObjectBlock; applied?: false } | { applied: true; block?: never })
type Delivery = { id: string; phase: 'prepare' | 'commit' }
type Reply = { id: string; status: 'ready' | 'applied' | 'rejected' }

function readRequest(includeReceiptAfterDeadline = false): Request | null {
  try {
    const value = JSON.parse(localStorage.getItem(REQUEST_KEY) ?? 'null') as Request | null
    return value && typeof value.id === 'string' && typeof value.sender === 'string' &&
      typeof value.expiresAt === 'number' &&
      (value.expiresAt > Date.now() || (includeReceiptAfterDeadline && value.applied === true)) &&
      (value.applied === true || value.block) ? value : null
  } catch {
    return null
  }
}

function clearRequest(id: string): void {
  try {
    // An old timeout or cancellation must never erase a newer surface's draft.
    const value = JSON.parse(localStorage.getItem(REQUEST_KEY) ?? 'null') as Request | null
    if (value?.id === id) localStorage.removeItem(REQUEST_KEY)
  } catch { /* The request still expires; never remove an unknown record. */ }
}

/** Native surface handoff. False preserves the caller's draft; never rejects old void callers. */
export function requestLauncherObjectHandoff(
  block: LauncherObjectBlock,
  options: { signal: AbortSignal; isCurrent: () => boolean },
): Promise<boolean> {
  if (options.signal.aborted || !options.isCurrent()) return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    const request: Request = {
      id: crypto.randomUUID(), sender: getCurrentWindow().label, block,
      expiresAt: Date.now() + TIMEOUT_MS,
    }
    let stopped = false
    let sending = false
    let phase: Delivery['phase'] = 'prepare'
    let unlisten: (() => void) | undefined
    const finish = (accepted: boolean) => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      clearTimeout(timeout)
      options.signal.removeEventListener('abort', abort)
      unlisten?.()
      clearRequest(request.id)
      resolve(accepted)
    }
    const abort = () => finish(false)
    const tick = async () => {
      if (stopped) return
      if (!options.isCurrent() || options.signal.aborted) { finish(false); return }
      const current = readRequest(true)
      if (current?.id !== request.id) { finish(false); return }
      // The receipt also survives a lost native ack without applying a second time.
      if (current.applied) { finish(true); return }
      if (sending) return
      sending = true
      try {
        await emitTo(LAUNCHER_WINDOW_LABEL, REQUEST_EVENT, { id: request.id, phase } satisfies Delivery)
      } catch {
        finish(false)
      } finally {
        sending = false
      }
    }
    const timer = setInterval(() => void tick(), 50)
    const timeout = setTimeout(() => {
      const receipt = readRequest(true)
      finish(!options.signal.aborted && options.isCurrent() && receipt?.id === request.id && receipt.applied === true)
    }, TIMEOUT_MS)
    options.signal.addEventListener('abort', abort, { once: true })
    try {
      localStorage.setItem(REQUEST_KEY, JSON.stringify(request))
    } catch {
      finish(false)
      return
    }
    void (async () => {
      try {
        const stop = await listen<Reply>(REPLY_EVENT, ({ payload }) => {
          if (stopped || payload.id !== request.id) return
          if (!options.isCurrent() || options.signal.aborted) { finish(false); return }
          if (payload.status === 'applied') finish(true)
          else if (payload.status === 'rejected') finish(false)
          else if (payload.status === 'ready') phase = 'commit'
        })
        if (stopped) { stop(); return }
        unlisten = stop
        await tick()
      } catch {
        finish(false)
      }
    })()
  }).catch(() => false)
}

/** Only the launcher window installs this receiver, independently of logical open changes. */
export async function subscribeLauncherObjectHandoff(options: {
  prepare: () => void
  getGeneration: () => number | undefined
  accept: (block: LauncherObjectBlock) => boolean
}): Promise<() => void> {
  let disposed = false
  let prepared: { id: string; generation: number } | null = null
  let opened: string | null = null
  let completed: string | null = null
  const reply = (sender: string, payload: Reply) => {
    void emitTo(sender, REPLY_EVENT, payload).catch(() => undefined)
  }
  const stop = await listen<Delivery>(REQUEST_EVENT, ({ payload }) => {
    if (disposed || !payload || typeof payload.id !== 'string') return
    const request = readRequest()
    // Clearing the source's request revokes queued prepare/commit messages.
    if (request?.id !== payload.id) return
    if (request.applied || completed === request.id) {
      reply(request.sender, { id: request.id, status: 'applied' })
      return
    }
    if (payload.phase === 'prepare') {
      // Mount the logical receiver first. Showing the native window here would
      // blur-hide (and correctly revoke) the source before delivery completes.
      if (opened !== request.id) { opened = request.id; options.prepare() }
      const generation = options.getGeneration()
      if (generation === undefined) return
      if (prepared?.id !== request.id) prepared = { id: request.id, generation }
      reply(request.sender, { id: request.id, status: 'ready' })
      return
    }
    if (payload.phase !== 'commit') return
    const generation = options.getGeneration()
    if (prepared?.id !== request.id || prepared.generation !== generation) {
      reply(request.sender, { id: request.id, status: 'rejected' })
      return
    }
    prepared = null
    if (!options.accept(request.block)) {
      reply(request.sender, { id: request.id, status: 'rejected' })
      return
    }
    completed = request.id
    // accept synchronously publishes material and invalidates older clipboard reads.
    // Persist acknowledgement only for this exact slot; never overwrite a new request.
    try {
      if (readRequest()?.id === request.id) localStorage.setItem(REQUEST_KEY, JSON.stringify({
        id: request.id, sender: request.sender, expiresAt: request.expiresAt, applied: true,
      }))
    } catch { /* Native ack remains available. */ }
    reply(request.sender, { id: request.id, status: 'applied' })
  })
  return () => { disposed = true; prepared = null; stop() }
}
