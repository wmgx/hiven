import { useAppStore } from '../store'
import { usePluginSettingsStore } from './pluginSettingsStore'
import type { PluginPasteResult } from './pluginTypes'
import { trackBehavior } from './telemetry'

/** Private host lifetime. This is deliberately not part of the plugin SDK. */
export type PasteRecoveryOwner = {
  isCurrent: () => boolean
  subscribeInvalidation: (listener: () => void) => () => void
  complete?: () => void
}

export type PasteRecoveryOwnerSource = {
  capture: () => PasteRecoveryOwner | undefined
}

export function combinePasteRecoveryOwners(...owners: (PasteRecoveryOwner | undefined)[]): PasteRecoveryOwner {
  const present = owners.filter((owner): owner is PasteRecoveryOwner => !!owner)
  return {
    isCurrent: () => present.every((owner) => owner.isCurrent()),
    subscribeInvalidation: (listener) => {
      const stops = present.map((owner) => owner.subscribeInvalidation(listener))
      return () => { for (const stop of stops) stop() }
    },
    complete: () => { for (const owner of present) owner.complete?.() },
  }
}

const cancelledResults = new WeakSet<object>()
export function cancelledPasteResult(): PluginPasteResult {
  const result: PluginPasteResult = { ok: false, fallback: 'none', message: '' }
  cancelledResults.add(result)
  return result
}
export function isPasteCancelled(result: PluginPasteResult): boolean {
  return cancelledResults.has(result)
}

/** A renderer owns a generation even when its React tree remains mounted. */
export function createPasteRecoveryScope() {
  let generation = 0
  const listeners = new Set<() => void>()
  return {
    invalidate() {
      generation += 1
      for (const listener of [...listeners]) listener()
    },
    capture(isCurrent: () => boolean, complete?: () => void): PasteRecoveryOwner {
      const captured = generation
      return {
        isCurrent: () => generation === captured && isCurrent(),
        subscribeInvalidation: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        complete,
      }
    },
  }
}

/** Explicit opens advance the store generation, including true → true reopens. */
export function captureLauncherPasteOwner(options?: { isCurrent?: () => boolean; complete?: false }): PasteRecoveryOwner | undefined {
  const original = useAppStore.getState()
  if (!original.globalLauncherOpen) return undefined
  const settingsTarget = usePluginSettingsStore.getState().settingsDialogTarget
  let completedGeneration: number | undefined
  const isCurrent = () => {
    const current = useAppStore.getState()
    if (completedGeneration !== undefined) {
      return current.globalLauncherSessionId === completedGeneration && !current.globalLauncherOpen
    }
    return (options?.isCurrent?.() ?? true) && current.globalLauncherOpen
      && current.globalLauncherSessionId === original.globalLauncherSessionId
      && current.pluginSurfaceToolTarget === original.pluginSurfaceToolTarget
      && current.launcherHostSurfaceTarget === original.launcherHostSurfaceTarget
      && usePluginSettingsStore.getState().settingsDialogTarget === settingsTarget
  }
  return {
    isCurrent,
    subscribeInvalidation: (listener) => {
      const changed = () => { if (!isCurrent()) listener() }
      const stopStore = useAppStore.subscribe(changed)
      const stopSettings = usePluginSettingsStore.subscribe(changed)
      return () => { stopStore(); stopSettings() }
    },
    complete: () => {
      // Controller/surface callers consume their successful output first and
      // then close themselves; closing here would synchronously reset them.
      if (options?.complete === false) return
      if (!isCurrent()) return
      // The caller may finish its own bookkeeping after this authorized close.
      // A later explicit open still invalidates that continuation.
      completedGeneration = useAppStore.getState().globalLauncherSessionId + 1
      useAppStore.getState().setGlobalLauncherOpen(false)
    },
  }
}

type PasteRecoveryCancelReason = 'owner-invalidated' | 'replaced-attempt' | 'unexpected-blur' | 'explicit-leave'

type OwnedAttempt = {
  isCurrent: () => boolean
  cancel: (reason?: PasteRecoveryCancelReason) => void
  hiding: boolean
  expectedBlur: boolean
}
let activeAttempt: OwnedAttempt | undefined
const focusListeners = new Set<() => void>()
const notifyFocus = () => { for (const listener of [...focusListeners]) listener() }

/** Only the native hide/focus handoff belongs to this lease; no timed grace. */
export const pasteRecoveryFocus = {
  isActive: () => activeAttempt?.hiding === true && activeAttempt.isCurrent(),
  subscribe: (listener: () => void) => {
    focusListeners.add(listener)
    return () => { focusListeners.delete(listener) }
  },
}

/** A focus restoration ends the expected blur, even if its native result is pending. */
export function observePasteRecoveryFocus(focused: boolean): boolean {
  if (activeAttempt) trackBehavior('behavior:paste.recovery.focus', {
    focused,
    hiding: activeAttempt.hiding,
    expectedBlur: activeAttempt.expectedBlur,
    current: activeAttempt.isCurrent(),
  })
  if (focused) {
    if (activeAttempt) activeAttempt.expectedBlur = false
    return false
  }
  if (consumePasteRecoveryBlur()) return true
  cancelPendingPasteRecovery('unexpected-blur')
  return false
}

export function consumePasteRecoveryBlur(): boolean {
  if (!activeAttempt?.hiding || !activeAttempt.expectedBlur || !activeAttempt.isCurrent()) return false
  activeAttempt.expectedBlur = false
  return true
}

export function isPasteRecoveryTemporaryHidden(): boolean {
  return activeAttempt?.hiding === true && activeAttempt.isCurrent()
}

/** A real leave revokes native recovery before asynchronous hide/close work. */
export function cancelPendingPasteRecovery(reason: PasteRecoveryCancelReason = 'explicit-leave'): void {
  activeAttempt?.cancel(reason)
}

export function checkPendingPasteRecovery(): void {
  if (activeAttempt && !activeAttempt.isCurrent()) activeAttempt.cancel('owner-invalidated')
}

export function createPasteRecoveryAttempt(owner: PasteRecoveryOwner | undefined, keepOpen: boolean) {
  let cancelled = false
  let finished = false
  let cancellationReason: PasteRecoveryCancelReason | undefined
  const controller = new AbortController()
  let attemptId: string | undefined
  let stopOwner: (() => void) | undefined
  let invoke: typeof import('@tauri-apps/api/core').invoke | undefined
  const cancelNative = () => {
    if (attemptId && invoke) void invoke('cancel_paste_attempt', { attemptId }).catch(() => undefined)
  }
  const release = () => {
    stopOwner?.()
    stopOwner = undefined
    if (activeAttempt === attempt) {
      activeAttempt = undefined
      notifyFocus()
    }
  }
  const attempt = {
    hiding: false,
    expectedBlur: false,
    isCurrent: () => !cancelled && !finished && (!owner || owner.isCurrent()),
    cancel: (reason: PasteRecoveryCancelReason = 'owner-invalidated') => {
      if (cancelled || finished) return
      cancellationReason = reason
      trackBehavior('behavior:paste.recovery.cancel', {
        reason,
        hiding: attempt.hiding,
        expectedBlur: attempt.expectedBlur,
        current: attempt.isCurrent(),
      })
      cancelled = true
      controller.abort()
      cancelNative()
      release()
    },
    async prepare() {
      if (!owner || !attempt.isCurrent()) return
      const core = await import('@tauri-apps/api/core')
      invoke = core.invoke
      if (!attempt.isCurrent()) return
      // Register before any clipboard write. Cancel remains effective even if
      // WebKit delays the later hide invocation until after an explicit reopen.
      const token = await invoke<string>('begin_paste_attempt')
      if (!token) throw new Error('Missing native paste owner')
      attemptId = token
      if (!attempt.isCurrent()) cancelNative()
    },
    startHandoff() {
      if (!attempt.isCurrent()) return false
      if (owner) {
        attempt.hiding = true
        attempt.expectedBlur = true
        notifyFocus()
      }
      return true
    },
    get attemptId() { return attemptId },
    get cancellationReason() { return cancellationReason },
    signal: controller.signal,
    finish(succeeded: boolean) {
      const current = attempt.isCurrent()
      finished = true
      if (!succeeded) cancelNative()
      if (succeeded && current && !keepOpen) owner?.complete?.()
      release()
      return current
    },
  }
  if (owner) {
    activeAttempt?.cancel('replaced-attempt')
    activeAttempt = attempt
    stopOwner = owner.subscribeInvalidation(attempt.cancel)
    if (!owner.isCurrent()) attempt.cancel()
  }
  return attempt
}
