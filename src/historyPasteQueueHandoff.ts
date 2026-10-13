/** App composition only: bundled History -> one session-only hidden-launcher queue. */
import type { HistoryPasteQueueBridge, HistoryPasteQueueStatus } from './workspace/pluginTypes'
import { createClipboardPasteQueue, validateQueueSnapshots } from './plugins/clipboard-history/queue/clipboardPasteQueue'
import { acquireSurfaceShortcutInterceptor } from './hotkeys/pluginSurfaceShortcuts'
import { registerHotkeyReloadParticipant } from './hotkeys/pageReload'
import { pluginRegistry } from './workspace/pluginRegistry'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from './workspace/pluginPermissions'
import { usePluginSurfaceShortcutStore } from './workspace/pluginSurfaceShortcuts'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'

const TARGET = { source: 'builtin' as const, pluginId: 'clipboard-history', surfaceId: 'main' }
const REQUEST = 'hiven://history-queue-request'
const REPLY = 'hiven://history-queue-reply'
const STATUS = 'hiven://history-queue-status'
const REQUIRED = ['clipboard.write', 'accessibility.paste', 'globalShortcut.register'] as const
type QueueAvailability = 'can-attempt' | 'unsupported' | 'unknown'
async function readQueueAvailability(): Promise<QueueAvailability> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      import('@tauri-apps/api/core').then(({ invoke }) => invoke<string>('get_history_queue_availability')).then((value): QueueAvailability => value === 'can-attempt' || value === 'unsupported' ? value : 'unknown'),
      new Promise<QueueAvailability>((resolve) => { timer = setTimeout(() => resolve('unknown'), 8_000) }),
    ])
  } finally { if (timer) clearTimeout(timer) }
}
const emptyStatus = (): HistoryPasteQueueStatus => ({ sessionId: '', version: 0, phase: 'idle', busy: false, total: 0, completed: 0, remaining: 0, currentId: null })
type Snapshot = Readonly<{ id: string; text: string }>
type Request = { id: string; action: 'start' | 'cancel' | 'status'; items: Snapshot[]; sessionId?: string }
type Reply = { id: string; ok: boolean; status: HistoryPasteQueueStatus; errorCode?: string }
export type HistoryPasteQueueNotice = 'ready' | 'delivered' | 'failed' | 'cancelled'

function allowed(): boolean {
  const entry = pluginRegistry.getAllPluginDefinitions().find((entry) => entry.pluginId === TARGET.pluginId && entry.source === 'production')
  if (!entry || !isCurrentBundledDefinition(TARGET.pluginId, 'builtin', entry.definition)) return false
  // The History setting only pauses capture; existing-history actions remain explicit.
  const requested = pluginRegistry.getPluginPermissions(TARGET.pluginId, 'builtin')
  return REQUIRED.every((permission) => requested.includes(permission))
    && missingPluginPermissions(getPluginPermissionSnapshot('builtin', TARGET.pluginId, requested), [...REQUIRED]).length === 0
}

let installedStop: (() => void) | null = null
/** Install only in the long-lived native launcher, never a plugin webview. */
export function installHistoryPasteQueueHost(options: { notify?: (status: HistoryPasteQueueStatus, outcome: HistoryPasteQueueNotice) => void } = {}): () => void {
  if (installedStop || new URLSearchParams(window.location.search).get('window') !== 'launcher' || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return () => {}
  let alive = true
  let sessionId = ''
  let sessionDefinition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
  let generation = 0
  let statusRevision = 0
  let publishFlight = Promise.resolve()
  let release: (() => Promise<void>) | null = null
  let releaseFlight = Promise.resolve()
  let startingId = ''
  let startLane = Promise.resolve()
  const cancelled = new Set<string>()
  const stops: (() => void)[] = []
  const queue = createClipboardPasteQueue({
    owner: { isCurrent: () => alive && allowed() },
    deliver: async ({ snapshot, signal, isCurrent }) => {
      const { invoke } = await import('@tauri-apps/api/core')
      if (!isCurrent()) return { ok: false }
      let attemptId: string | undefined
      const cancel = () => { if (attemptId) void invoke('cancel_paste_attempt', { attemptId }).catch(() => undefined) }
      signal.addEventListener('abort', cancel, { once: true })
      try {
        attemptId = await invoke<string>('begin_history_queue_paste')
        if (!isCurrent()) { cancel(); return { ok: false } }
        await invoke('paste_history_queue_text', { attemptId, text: snapshot.text })
        return { ok: isCurrent() }
      } catch { return { ok: false } }
      finally { signal.removeEventListener('abort', cancel); cancel() }
    },
  })
  const status = (): HistoryPasteQueueStatus => {
    const state = queue.getSnapshot()
    return { sessionId, version: statusRevision, phase: state.phase, busy: state.busy, total: state.total, completed: state.completed, remaining: state.remaining, currentId: state.current?.id ?? null }
  }
  const publish = () => {
    if (!alive) return
    statusRevision += 1
    const snapshot = status()
    publishFlight = publishFlight.catch(() => undefined).then(async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('history_queue_publish', { status: snapshot })
    }).catch(() => undefined)
  }
  const releaseShortcut = () => {
    const stop = release
    release = null
    if (stop) releaseFlight = releaseFlight.catch(() => undefined).then(async () => {
      try { await stop() }
      catch (error) { if (!release) release = stop; throw error }
    })
    return releaseFlight
  }
  const cancelQueue = (id?: string) => {
    if (id && id !== sessionId && id !== startingId) { cancelled.add(id); setTimeout(() => cancelled.delete(id), 15_000); return }
    generation += 1
    if (startingId) cancelled.add(startingId)
    queue.cancel()
    options.notify?.(status(), 'cancelled')
    void releaseShortcut().catch(() => undefined)
  }
  const next = async (): Promise<boolean> => {
    if (!alive || !allowed()) { cancelQueue(); return false }
    if (!queue.getSnapshot().remaining) return false
    const outcome = await queue.next()
    if (outcome === 'delivered' || outcome === 'failed') options.notify?.(status(), outcome)
    if (queue.getSnapshot().phase === 'completed') void releaseShortcut().catch(() => undefined)
    return true
  }
  stops.push(queue.subscribe(publish))
  const receive = async (id: string) => {
    const { invoke } = await import('@tauri-apps/api/core')
    const request = await invoke<Request | null>('history_queue_take', { id })
    if (!request || !alive) return
    let ok = true
    let errorCode: string | undefined
    try {
      if (!allowed()) throw new Error('QueueUnavailableError')
      if (request.action === 'cancel') {
        cancelQueue(request.sessionId)
        await releaseFlight
      } else if (request.action === 'start') {
        const previousStart = startLane
        let finishStart!: () => void
        startLane = new Promise<void>((resolve) => { finishStart = resolve })
        try {
        await previousStart
        if (cancelled.has(request.id)) throw new Error('QueueCancelledError')
        if (await readQueueAvailability() !== 'can-attempt') throw new Error('QueuePlatformUnavailableError')
        const snapshots = validateQueueSnapshots(request.items)
        const requestedGeneration = ++generation
        const requestedDefinition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
        startingId = request.id
        try { await releaseFlight } catch { await releaseShortcut() }
        if (!alive || cancelled.has(request.id) || requestedGeneration !== generation) throw new Error('QueueCancelledError')
        if (!release) release = await acquireSurfaceShortcutInterceptor(TARGET, 'Control+Shift+V', next)
        if (!alive || !allowed() || requestedDefinition !== pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production') || cancelled.has(request.id) || requestedGeneration !== generation) {
          await releaseShortcut()
          throw new Error('QueueCancelledError')
        }
        sessionDefinition = requestedDefinition
        sessionId = request.id
        startingId = ''
        queue.replace(snapshots)
        options.notify?.(status(), 'ready')
        } finally { finishStart() }
      }
    } catch (error) {
      ok = false
      const code = error instanceof Error ? error.message : ''
      errorCode = ['QueueShortcutConflictError', 'QueueCancelledError', 'QueueSnapshotError', 'QueuePlatformUnavailableError'].includes(code) ? code : 'QueueUnavailableError'
      if (startingId === request.id) startingId = ''
    }
    await invoke('history_queue_reply', { id: request.id, ok, status: status(), errorCode }).catch(() => undefined)
  }
  void import('@tauri-apps/api/event').then(async ({ listen }) => {
    const stop = await listen<string>(REQUEST, (event) => { void receive(event.payload).catch(() => undefined) })
    if (alive) stops.push(stop); else stop()
  })
  stops.push(pluginRegistry.subscribe(() => {
    if (!allowed() || (sessionId && sessionDefinition !== pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production'))) cancelQueue()
  }))
  stops.push(usePluginPermissionStore.subscribe(() => { if (!allowed()) cancelQueue() }))
  stops.push(usePluginSurfaceShortcutStore.subscribe((state, previous) => {
    // User edits invalidate the temporary ownership instead of silently moving
    // or taking over a different shortcut. Registration status updates do not.
    const signature = (shortcuts: typeof state.shortcuts) => JSON.stringify(Object.entries(shortcuts).map(([key, value]) => [key, value.accelerator, value.enabled]))
    if (signature(state.shortcuts) !== signature(previous.shortcuts) && (sessionId || startingId)) cancelQueue()
  }))
  const stop = () => {
    if (!alive) return
    alive = false
    generation += 1
    queue.dispose()
    options.notify?.(status(), 'cancelled')
    for (const cleanup of stops) cleanup()
    void releaseShortcut().catch(() => undefined)
    installedStop = null
  }
  installedStop = stop
  const unregisterReload = registerHotkeyReloadParticipant('history-paste-queue', {
    stop: async () => { stop(); await releaseFlight },
    resume: () => { installHistoryPasteQueueHost(options) },
  })
  return () => { stop(); unregisterReload() }
}

/** Caller must be the current bundled History surface; native verifies its real window. */
export function createHistoryPasteQueueBridge(options: {
  source: string; pluginId: string; isCurrent: () => boolean
  subscribeInvalidation?: (listener: () => void) => () => void
}): HistoryPasteQueueBridge {
  let latest = emptyStatus()
  const check = () => {
    if (options.source !== 'builtin' || options.pluginId !== 'clipboard-history' || !options.isCurrent()) throw new Error('QueueUnavailableError')
  }
  async function rpc(action: Request['action'], items?: readonly Snapshot[], signal?: AbortSignal, cancelId?: string): Promise<Reply> {
    const { invoke } = await import('@tauri-apps/api/core')
    const { listen } = await import('@tauri-apps/api/event')
    check()
    if (signal?.aborted) throw new Error('QueueCancelledError')
    const id = crypto.randomUUID()
    return new Promise<Reply>((resolve, reject) => {
      let finished = false
      let unlisten = () => {}
      let stopOwner = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (reply?: Reply, error?: Error) => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        unlisten(); stopOwner(); signal?.removeEventListener('abort', abort)
        if (reply) { if (reply.status.version >= latest.version) latest = reply.status; resolve(reply) } else reject(error ?? new Error('QueueCancelledError'))
      }
      const abort = () => {
        // A cancelled start may have crossed the boundary already. Cancel only
        // that exact session, never a queue replacing it in another window.
        if (action === 'start') void invoke('history_queue_request', { id: crypto.randomUUID(), action: 'cancel', sessionId: id }).catch(() => undefined)
        finish(undefined, new Error('QueueCancelledError'))
      }
      void listen<Reply>(REPLY, (event) => { if (event.payload.id === id) finish(event.payload) }).then(async (stop) => {
        unlisten = stop
        if (finished) { stop(); return }
        signal?.addEventListener('abort', abort, { once: true })
        stopOwner = options.subscribeInvalidation?.(abort) ?? (() => {})
        if (!options.isCurrent() || signal?.aborted) { abort(); return }
        timer = setTimeout(abort, 8_000)
        try { await invoke('history_queue_request', { id, action, items, sessionId: cancelId }) }
        catch { finish(undefined, new Error('QueueUnavailableError')) }
      }).catch(() => finish(undefined, new Error('QueueUnavailableError')))
    })
  }
  const getAvailability = async (): Promise<'can-attempt' | 'unsupported' | 'unknown'> => {
    check()
    return new Promise((resolve, reject) => {
      let finished = false
      let stopOwner = () => {}
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (value?: 'can-attempt' | 'unsupported' | 'unknown', error?: Error) => {
        if (finished) return
        finished = true
        if (timer) clearTimeout(timer)
        stopOwner()
        if (error) reject(error); else resolve(value ?? 'unknown')
      }
      stopOwner = options.subscribeInvalidation?.(() => finish(undefined, new Error('QueueCancelledError'))) ?? (() => {})
      if (finished) { stopOwner(); return }
      timer = setTimeout(() => finish('unknown'), 8_000)
      void Promise.resolve().then(async () => {
        if (finished) return
        check()
        const value = await readQueueAvailability()
        check() // A late result cannot authorize a replaced surface owner.
        finish(value === 'can-attempt' || value === 'unsupported' ? value : 'unknown')
      }).catch(() => finish(undefined, new Error('QueueUnavailableError')))
    })
  }
  return {
    getAvailability,
    async start(snapshots, options) {
      check()
      const validated = validateQueueSnapshots(snapshots)
      const reply = await rpc('start', validated, options?.signal)
      if (!reply.ok) throw new Error(reply.errorCode ?? 'QueueUnavailableError')
      return true
    },
    async cancel() {
      check()
      if (!latest.sessionId) await rpc('status')
      if (latest.sessionId) await rpc('cancel', undefined, undefined, latest.sessionId)
    },
    async getStatus() {
      check()
      const reply = await rpc('status')
      if (!reply.ok) throw new Error(reply.errorCode ?? 'QueueUnavailableError')
      return latest
    },
    subscribe(listener) {
      let active = true
      let stop = () => {}
      void import('@tauri-apps/api/event').then(({ listen }) => listen<HistoryPasteQueueStatus>(STATUS, (event) => {
        if (active && options.isCurrent() && event.payload.version >= latest.version) { latest = event.payload; listener(latest) }
      })).then((unlisten) => { if (active) stop = unlisten; else unlisten() }).catch(() => undefined)
      return () => { active = false; stop() }
    },
  }
}
