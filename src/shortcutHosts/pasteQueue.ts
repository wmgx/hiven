/** Background-owned in-memory delivery; round policy belongs to the provider. */
import type { PasteQueueStatus, PluginBackgroundPasteQueue } from '../workspace/pluginTypes'
import { createClipboardPasteQueue, validateQueueSnapshots } from '../workspace/pasteQueue/clipboardPasteQueue'
import { registerHotkeyReloadParticipant } from '../hotkeys/pageReload'
import { useAppStore } from '../store'
import { translate } from '../i18n'
import { isLauncherNativeRuntime } from './bundledSurfaces'
import { trackBehavior } from '../workspace/telemetry'

let owner: symbol | undefined
let sessionId = ''
let revision = 0
const listeners = new Set<(status: PasteQueueStatus) => void>()
let syncShortcut = () => {}
const queue = createClipboardPasteQueue({
  owner: { isCurrent: () => !!owner },
  deliver: async ({ snapshot, signal, isCurrent }) => {
    const { invoke } = await import('@tauri-apps/api/core')
    let attemptId: string | undefined
    const cancel = () => { if (attemptId) void invoke('cancel_paste_attempt', { attemptId }).catch(() => {}) }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      if (!isCurrent()) return { ok: false }
      attemptId = await invoke<string>('begin_history_queue_paste')
      if (!isCurrent()) return { ok: false }
      await invoke('paste_history_queue_text', { attemptId, text: snapshot.text })
      trackBehavior('paste_queue.deliver', { status: 'delivered' })
      return { ok: isCurrent() }
    } catch (error) {
      // Native errors are fixed reason codes (QueueTargetError, …); anything else is "other".
      const reason = /^Queue[A-Za-z]+Error$/.test(String(error)) ? String(error) : 'other'
      trackBehavior('paste_queue.deliver', { status: 'failed', reason })
      return { ok: false }
    }
    finally { signal.removeEventListener('abort', cancel); cancel() }
  },
})
const status = (): PasteQueueStatus => {
  const state = queue.getSnapshot()
  return { sessionId, version: revision, phase: state.phase, busy: state.busy, total: state.total, completed: state.completed, remaining: state.remaining, currentId: state.current?.id ?? null }
}
export function getPasteQueueDebugSnapshot() {
  const { phase, busy, total, completed, remaining } = queue.getSnapshot()
  return { phase, busy, total, completed, remaining }
}
function publish() {
  revision += 1
  const current = status()
  for (const listener of listeners) listener(current)
}
queue.subscribe(publish)

export function createBackgroundPasteQueue(signal: AbortSignal, isCurrent: () => boolean): PluginBackgroundPasteQueue | undefined {
  if (!isLauncherNativeRuntime() || window.__HIVEN_WEB_NATIVE_BRIDGE__ || !/Mac/i.test(navigator.platform)) return undefined
  const token = Symbol()
  const ownedListeners = new Set<(status: PasteQueueStatus) => void>()
  const check = () => { if (signal.aborted || !isCurrent() || owner !== token) throw new Error('QueueUnavailableError') }
  const dispose = () => {
    if (owner === token) { queue.cancel(); owner = undefined; syncShortcut() }
    for (const listener of ownedListeners) listeners.delete(listener)
    ownedListeners.clear()
  }
  signal.addEventListener('abort', dispose, { once: true })
  return {
    setRound(id, snapshots) {
      check()
      if (typeof id !== 'string' || !id || id.length > 160) throw new Error('QueueSnapshotError')
      const validated = validateQueueSnapshots(snapshots)
      if (sessionId === id) queue.appendRound(validated)
      else { sessionId = id; queue.replace(validated) }
    },
    clear() { if (owner === token) queue.cancel() },
    subscribe(listener) {
      if (signal.aborted || !isCurrent() || (owner && owner !== token)) throw new Error('QueueUnavailableError')
      owner = token
      ownedListeners.add(listener); listeners.add(listener)
      syncShortcut()
      return () => {
        ownedListeners.delete(listener); listeners.delete(listener)
        if (!ownedListeners.size) dispose()
      }
    },
  }
}

export function installPasteQueueHost(): () => void {
  if (!isLauncherNativeRuntime() || window.__HIVEN_WEB_NATIVE_BRIDGE__ || !/Mac/i.test(navigator.platform)) return () => {}
  let alive = true
  let paused = false
  let registered = ''
  let generation = 0
  let lane = Promise.resolve()
  const identity = () => {
    const shortcut = useAppStore.getState().settings.pasteQueueShortcut
    return shortcut.kind === 'accelerator' ? shortcut.accelerator.replace(/\bCmd\b/g, 'Command') : ''
  }
  const sync = () => {
    const requested = ++generation
    lane = lane.catch(() => {}).then(async () => {
      const { register, unregister, isRegistered } = await import('@tauri-apps/plugin-global-shortcut')
      if (registered) { await unregister(registered); registered = '' }
      if (requested !== generation || !alive || paused) return
      const accelerator = identity()
      const update = (registrationStatus: string, registrationError?: string) => {
        if (requested !== generation) return
        trackBehavior('paste_queue.shortcut', { status: registrationStatus })
        const shortcut = useAppStore.getState().settings.pasteQueueShortcut
        useAppStore.getState().updateSetting('pasteQueueShortcut', { ...shortcut, registrationStatus, registrationError })
      }
      if (!owner || !accelerator) { update('Disabled'); return }
      try {
        if (await isRegistered(accelerator)) throw new Error('occupied')
        if (requested !== generation) return
        await register(accelerator, (event) => {
          if (!alive || paused || requested !== generation || !owner || event.state !== 'Released') return
          trackBehavior('paste_queue.shortcut', { status: 'pressed', phase: queue.getSnapshot().remaining ? 'ready' : 'empty' })
          if (!queue.getSnapshot().remaining) return
          void queue.next()
        })
        registered = accelerator
        if (requested !== generation) { await unregister(accelerator); registered = ''; return }
        update('Registered')
      } catch {
        update('Registration failed', translate(useAppStore.getState().settings.locale, 'hud', 'queue.shortcutFailed'))
      }
    })
    void lane.catch(() => { /* Keep ownership if unregister failed; a later sync can retry. */ })
  }
  syncShortcut = sync
  const stopStore = useAppStore.subscribe((state, previous) => {
    const key = (s: typeof state.settings.pasteQueueShortcut) => s.kind === 'accelerator' ? s.accelerator : s.kind
    if (key(state.settings.pasteQueueShortcut) !== key(previous.settings.pasteQueueShortcut)) { sync(); publish() }
  })
  let stopReload = () => {}
  const resume = () => {
    paused = false
    sync()
    stopReload = registerHotkeyReloadParticipant('paste-queue', {
      stop: () => { paused = true; sync(); return lane }, resume,
    })
  }
  resume()
  return () => { alive = false; stopReload(); stopStore(); sync(); syncShortcut = () => {} }
}
