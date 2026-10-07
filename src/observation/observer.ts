import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../store'
import { translate } from '../i18n'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { isNativeDesktopRuntime } from '../workspace/webNativeBridge'
import { showToast } from '../workspace/toast'
import { MAX_VIDEO_FRAMES, ObservationVideoEncoder, CompressionFailedError, type ObservationVideo } from './video'

type DesktopCaptureSnapshot = {
  capturedAt: number
  appName: string
  bundleId?: string
  windowTitle?: string
  idleSeconds: number
  skipped?: 'idle' | 'locked' | 'excluded' | 'changed'
  imageBytes?: number[]
  text?: string
}

// Keep the original namespace so existing SQLite records and image blobs stay readable.
export const observationStorage = createPluginPrivateStorage('builtin', 'behavior-observer')

async function capture(options: { image: boolean; excludedApps: string[]; maxIdleSeconds: number }) {
  if (!isNativeDesktopRuntime()) throw new Error('desktop-required')
  return invoke<DesktopCaptureSnapshot>('capture_desktop_snapshot', { options })
}

function reportStopped(kind: 'screenshot' | 'keyboard') {
  const key = kind === 'keyboard' ? 'keyboard.error.stopped' : 'error.stopped'
  showToast(translate(useAppStore.getState().locale, 'observation', key), 'error')
}

const MAX_BYTES = 500 * 1024 * 1024
const TICK_DELAY_MS = 5000
// Fast retries for a burst of trouble; beyond that, fall back to the normal cadence — forever. A lost
// frame or key event isn't corrupt state, so this class of error never gives up outright — only a
// missing permission or an unsupported platform does, and those get a manual retry button instead.
const FAST_RETRY_ATTEMPTS = 5
const FAST_RETRY_DELAY_MS = 500

function excludedAppsFor(extra: string): string[] {
  return [
    'loginwindow', 'ScreenSaverEngine', 'SecurityAgent', '1Password', 'Bitwarden', 'Passwords', 'hiven',
    'com.apple.Passwords', 'com.apple.keychainaccess', 'com.1password.1password', 'com.bitwarden.desktop', 'com.hiven.app',
    ...String(extra ?? '').split('\n').map((s) => s.trim()).filter(Boolean),
  ]
}

/** Calendar workdays from `start` (including the first recording weekday); pauses don't extend it. */
export function observationDeadline(start: number, workdays = 5): number {
  const end = new Date(start)
  let days = 0
  while (days < workdays) {
    if (end.getDay() !== 0 && end.getDay() !== 6) days++
    end.setDate(end.getDate() + 1)
  }
  end.setHours(0, 0, 0, 0)
  return end.getTime()
}

// ---------------------------------------------------------------------------
// Screenshot capture. Fully independent of keyboard capture below: its own
// settings, storage key, retry/backoff and manual-retry nonce. A permission
// error or encoder failure here never touches keyboard recording.
// ---------------------------------------------------------------------------

export type ScreenshotObserverSettings = {
  enabled: boolean
  intervalSeconds: number
  excludedApps: string
  maxStorageMB?: number
  maxDays?: number
  /** Bumping this (e.g. Date.now()) forces a clean restart — the manual "retry" button. */
  retryNonce?: number
}
export const screenshotDefaults: ScreenshotObserverSettings & { maxStorageMB: number; maxDays: number } = {
  enabled: false, intervalSeconds: 30, excludedApps: '', maxStorageMB: 500, maxDays: 5,
}
export const SCREENSHOT_STATE_KEY = 'observation-state'
/** Statuses that stop the loop outright and need the user (permission, platform) or a manual retry. */
export const SCREENSHOT_TERMINAL_STATUSES = ['screen-permission-required', 'desktop-required', 'unsupported-platform', 'ocr-failed', 'compression-unavailable', 'error']

export type Observation = Omit<DesktopCaptureSnapshot, 'imageBytes'> & { id: string; blobId?: string; video?: ObservationVideo }
export type ScreenshotObservationState = {
  startedAt: number
  endsAt: number
  count: number
  bytes: number
  updatedAt: number
  status: string
  recent: Observation[]
  lastErrorDetail?: string
}

export function startScreenshotObservation(settings: ScreenshotObserverSettings) {
  if (settings.enabled !== true || !isNativeDesktopRuntime()) return
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: ScreenshotObservationState
  let lastImageAt = 0
  let lastApp = ''
  let consecutiveFailures = 0
  let encoder = new ObservationVideoEncoder()
  let previousFrames: ObservationVideo['frames'] = []
  const interval = Math.max(15, Math.min(300, Number(settings.intervalSeconds) || 30)) * 1000
  const excludedApps = excludedAppsFor(settings.excludedApps)
  const maxDays = Math.max(1, Math.min(30, Number(settings.maxDays) || screenshotDefaults.maxDays))
  const maxBytes = Math.max(100, Math.min(5000, Number(settings.maxStorageMB) || screenshotDefaults.maxStorageMB)) * 1024 * 1024

  const updateStatus = async (status: string) => {
    if (stopped) return
    state.status = status
    state.updatedAt = Date.now()
    await observationStorage.kv.set(SCREENSHOT_STATE_KEY, state)
  }

  const tick = async () => {
    if (stopped) return
    let failedThisTick = false
    let retryDelayMs = TICK_DELAY_MS
    try {
      if (Date.now() >= state.endsAt || state.bytes >= maxBytes) {
        await updateStatus(state.bytes >= maxBytes ? 'full' : 'complete')
        return
      }
      const options = { image: false, excludedApps, maxIdleSeconds: 120 }
      const context = await capture(options)
      if (stopped) return
      if (context.skipped) {
        lastApp = ''
        await updateStatus(context.skipped)
        return
      }
      const app = `${context.bundleId ?? context.appName}:${context.windowTitle ?? ''}`
      const changed = app !== lastApp
      if (!changed && Date.now() - lastImageAt < interval) {
        await updateStatus('recording')
        return
      }
      // ponytail: 5s foreground polling + periodic front-window snapshots, not a lossless replay.
      const sample = await capture({ ...options, image: true })
      if (stopped) return
      if (sample.skipped) {
        lastApp = ''
        await updateStatus(sample.skipped)
        return
      }
      const { imageBytes, ...metadata } = sample
      const pixels = new Uint8Array(imageBytes ?? [])
      if (!pixels.length) throw new Error('capture-failed')
      const encoded = await encoder.encode(pixels, changed || previousFrames.length >= MAX_VIDEO_FRAMES)
      if (stopped) return
      const { bytes } = encoded
      const refs = encoded.type === 'key' ? [] : previousFrames
      if (encoded.type === 'delta' && !refs.length) throw new CompressionFailedError('delta-without-reference-frame')
      const video: ObservationVideo = { codec: encoded.codec, width: encoded.width, height: encoded.height, frames: refs }
      const byteSize = bytes.length + new TextEncoder().encode(JSON.stringify({ ...metadata, video })).length + 256
      if (state.bytes + byteSize > maxBytes) {
        await updateStatus('full')
        return
      }
      const blob = await observationStorage.blob.put({ bytes, contentType: 'video/h264', extension: 'h264' })
      if (stopped) {
        await observationStorage.blob.delete(blob.blobId)
        return
      }
      video.frames = [...refs, { blobId: blob.blobId, type: encoded.type, timestamp: encoded.timestamp }]
      const item: Observation = { ...metadata, id: `sample:${sample.capturedAt}`, blobId: blob.blobId, video }
      try {
        await observationStorage.kv.set(item.id, item)
      } catch (error) {
        await observationStorage.blob.delete(blob.blobId)
        throw error
      }
      // A stop waits for this in-flight commit; no further capture can start.
      state.count++
      state.bytes += byteSize
      state.recent = [item, ...state.recent].slice(0, 20)
      previousFrames = video.frames
      lastImageAt = sample.capturedAt
      lastApp = `${sample.bundleId ?? sample.appName}:${sample.windowTitle ?? ''}`
      state.status = 'recording'
      state.updatedAt = Date.now()
      await observationStorage.kv.set(SCREENSHOT_STATE_KEY, state)
    } catch (error) {
      failedThisTick = true
      if (stopped) return
      const code = error instanceof Error ? error.message : String(error)
      if (error instanceof CompressionFailedError) state.lastErrorDetail = error.detail
      // A lost frame isn't corrupt state, so capture/encode hiccups retry forever instead of stopping.
      // Don't publish the failure status while retrying fast — the Settings page polls this every 3s
      // and would otherwise flash "stopped" for something that self-heals in under a second.
      // compression-failed also gets a fresh encoder: the wedge may be the encoder's own internal
      // state (e.g. a latched error flag), not just the reference-frame chain.
      if (code === 'capture-failed' || code === 'compression-failed') {
        if (code === 'compression-failed') {
          encoder.close()
          encoder = new ObservationVideoEncoder()
        }
        previousFrames = []
        lastApp = ''
        consecutiveFailures++
        retryDelayMs = consecutiveFailures <= FAST_RETRY_ATTEMPTS ? FAST_RETRY_DELAY_MS : TICK_DELAY_MS
        return
      }
      await updateStatus(SCREENSHOT_TERMINAL_STATUSES.includes(code) ? code : 'error').catch(() => {})
      stopped = true
      encoder.close()
      reportStopped('screenshot')
    } finally {
      if (!failedThisTick) consecutiveFailures = 0
      if (!stopped && state && !['complete', 'full'].includes(state.status)) {
        timer = setTimeout(() => { running = tick() }, retryDelayMs)
      } else {
        encoder.close()
      }
    }
  }

  let running = (async () => {
    try {
      const stored = await observationStorage.kv.get<ScreenshotObservationState & { keyboard?: unknown }>(SCREENSHOT_STATE_KEY)
      if (stored) delete stored.keyboard // drop the pre-split embedded keyboard payload; it now lives under its own key.
      if (stopped) return
      const now = Date.now()
      state = stored ?? { startedAt: now, endsAt: observationDeadline(now, maxDays), count: 0, bytes: 0, updatedAt: now, status: 'starting', recent: [] }
      // Recompute from the original start so an edited maxDays takes effect on an already-running session.
      if (stored) state.endsAt = observationDeadline(state.startedAt, maxDays)
      await tick()
    } catch {
      stopped = true
      encoder.close()
      reportStopped('screenshot')
    }
  })()

  // Synchronous registration is essential: disabling during the first capture must cancel it.
  return async () => {
    stopped = true
    clearTimeout(timer)
    encoder.close()
    await running
  }
}

// ---------------------------------------------------------------------------
// Keyboard capture. Fully independent of screenshot capture above.
// ---------------------------------------------------------------------------

export type KeyboardObserverSettings = {
  enabled: boolean
  excludedApps: string
  /** Bumping this (e.g. Date.now()) forces a clean restart — the manual "retry" button. */
  retryNonce?: number
}
export const keyboardDefaults: KeyboardObserverSettings = { enabled: false, excludedApps: '' }
export const KEYBOARD_STATE_KEY = 'keyboard-observation-state'
/**
 * Statuses that stop the loop outright. Permission-required and overflow are deliberately NOT here:
 * permission checks are cheap and re-evaluated on every poll, so recording resumes on its own the
 * moment the user grants it in System Settings; overflow is cleared with an explicit stop+reinstall
 * (see the `overflow` branch below) rather than by giving up.
 */
export const KEYBOARD_TERMINAL_STATUSES = ['desktop-required', 'unsupported-platform', 'error']

export type KeyboardObservationEvent = {
  at: number
  appName: string
  bundleId?: string
  keyCode: number
  key: string
  modifiers: string[]
  repeat: boolean
}
type KeyboardBatch = { status: string; events: KeyboardObservationEvent[] }
export type KeyboardObservationState = {
  startedAt: number
  endsAt: number
  count: number
  bytes: number
  updatedAt: number
  status: string
  recent: KeyboardObservationEvent[]
}

async function stopNativeKeyboard() {
  await invoke('stop_keyboard_observation')
}

export function startKeyboardObservation(settings: KeyboardObserverSettings) {
  if (settings.enabled !== true || !isNativeDesktopRuntime()) return
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: KeyboardObservationState
  const excludedApps = excludedAppsFor(settings.excludedApps)

  const updateStatus = async (status: string) => {
    if (stopped) return
    state.status = status
    state.updatedAt = Date.now()
    await observationStorage.kv.set(KEYBOARD_STATE_KEY, state)
  }

  const tick = async () => {
    if (stopped) return
    try {
      if (Date.now() >= state.endsAt || state.bytes >= MAX_BYTES) {
        await updateStatus(state.bytes >= MAX_BYTES ? 'full' : 'complete')
        await stopNativeKeyboard().catch(() => {})
        return
      }
      const batch = await invoke<KeyboardBatch>('poll_keyboard_observation', { options: { excludedApps, endsAt: state.endsAt } })
      if (stopped) return
      if (batch.status === 'overflow') {
        // Sticky on the native side until an explicit stop; clear it so the next poll can resume.
        await stopNativeKeyboard().catch(() => {})
      }
      state.status = batch.status
      state.updatedAt = Date.now()
      if (batch.events.length) {
        // Native has already removed password/unknown-focus events before reading their key values.
        const id = `keys:${batch.events[0].at}:${batch.events.at(-1)!.at}`
        const item = { id, events: batch.events }
        const byteSize = new TextEncoder().encode(JSON.stringify(item)).length
        if (state.bytes + byteSize > MAX_BYTES) {
          await updateStatus('full')
          await stopNativeKeyboard().catch(() => {})
          return
        }
        await observationStorage.kv.set(id, item)
        state.bytes += byteSize
        state.count += batch.events.length
        state.recent = [...batch.events].reverse().concat(state.recent).slice(0, 50)
      }
      await observationStorage.kv.set(KEYBOARD_STATE_KEY, state)
    } catch (error) {
      if (stopped) return
      const code = error instanceof Error ? error.message : String(error)
      await updateStatus(KEYBOARD_TERMINAL_STATUSES.includes(code) ? code : 'error').catch(() => {})
      stopped = true
      await stopNativeKeyboard().catch(() => {})
      reportStopped('keyboard')
    } finally {
      if (!stopped && state && !['complete', 'full'].includes(state.status)) {
        timer = setTimeout(() => { running = tick() }, TICK_DELAY_MS)
      }
    }
  }

  let running = (async () => {
    try {
      const stored = await observationStorage.kv.get<KeyboardObservationState>(KEYBOARD_STATE_KEY)
      if (stopped) return
      const now = Date.now()
      if (stored) {
        state = stored
      } else {
        // One-time carry-over of history recorded before keyboard/screenshot were split apart.
        const legacy = await observationStorage.kv.get<{ startedAt?: number; endsAt?: number; keyboard?: { count: number; recent: KeyboardObservationEvent[] } }>(SCREENSHOT_STATE_KEY)
        state = legacy?.keyboard
          ? { startedAt: legacy.startedAt ?? now, endsAt: legacy.endsAt ?? observationDeadline(now), count: legacy.keyboard.count, bytes: 0, updatedAt: now, status: 'starting', recent: legacy.keyboard.recent }
          : { startedAt: now, endsAt: observationDeadline(now), count: 0, bytes: 0, updatedAt: now, status: 'starting', recent: [] }
      }
      if (stopped) return
      await tick()
    } catch {
      stopped = true
      await stopNativeKeyboard().catch(() => {})
      reportStopped('keyboard')
    }
  })()

  return async () => {
    stopped = true
    clearTimeout(timer)
    await Promise.all([stopNativeKeyboard().catch(() => {}), running])
  }
}

// ---------------------------------------------------------------------------
// App-owned lifecycle. Mounted once by the desktop launcher's root; manages both
// recorders independently so a settings change or failure on one side never
// restarts or stops the other.
// ---------------------------------------------------------------------------

let screenshotDraining = Promise.resolve()
let keyboardDraining = Promise.resolve()

export function startBehaviorObservation() {
  if (!isNativeDesktopRuntime()) return () => {}

  if (!useAppStore.getState().settings.behaviorObservation) {
    // One-time transfer of the prototype's preferences; never enable a previously denied recorder.
    try {
      const legacy = JSON.parse(localStorage.getItem('hiven-plugin-settings') ?? '{}')
        .state?.pluginSettings?.builtin?.['behavior-observer']?.value
      const grants = JSON.parse(localStorage.getItem('hiven-plugin-permissions') ?? '{}')
        .state?.permissions?.builtin?.['behavior-observer'] ?? {}
      if (legacy) useAppStore.getState().updateSetting('behaviorObservation', {
        enabled: legacy.enabled === true && grants['screen.capture']?.granted === true
          && !useAppStore.getState().settings.disabledBuiltins?.includes('behavior-observer')
          && ['context.foreground-app', 'storage.private', 'storage.blob'].every((p) => grants[p]?.granted !== false),
        intervalSeconds: Math.max(15, Math.min(300, Number(legacy.intervalSeconds) || 30)),
        excludedApps: typeof legacy.excludedApps === 'string' ? legacy.excludedApps : '',
      })
    } catch { /* Malformed prototype preferences leave observation off. */ }
  }
  if (!useAppStore.getState().settings.keyboardObservation) {
    // One-time split of the old combined `behaviorObservation.keyboardEnabled` sub-toggle.
    const legacyCombined = useAppStore.getState().settings.behaviorObservation as (ScreenshotObserverSettings & { keyboardEnabled?: boolean }) | undefined
    useAppStore.getState().updateSetting('keyboardObservation', {
      enabled: legacyCombined?.keyboardEnabled === true,
      excludedApps: legacyCombined?.excludedApps ?? '',
    })
  }

  let screenshotGeneration = 0
  let stopScreenshot: ReturnType<typeof startScreenshotObservation>
  const restartScreenshot = () => {
    const current = ++screenshotGeneration
    const stopped = stopScreenshot?.()
    stopScreenshot = undefined
    screenshotDraining = Promise.all([screenshotDraining, stopped]).then(() => {
      if (current === screenshotGeneration) stopScreenshot = startScreenshotObservation(useAppStore.getState().settings.behaviorObservation ?? screenshotDefaults)
    }).catch(() => reportStopped('screenshot'))
  }

  let keyboardGeneration = 0
  let stopKeyboard: ReturnType<typeof startKeyboardObservation>
  const restartKeyboard = () => {
    const current = ++keyboardGeneration
    const stopped = stopKeyboard?.()
    stopKeyboard = undefined
    keyboardDraining = Promise.all([keyboardDraining, stopped]).then(() => {
      if (current === keyboardGeneration) stopKeyboard = startKeyboardObservation(useAppStore.getState().settings.keyboardObservation ?? keyboardDefaults)
    }).catch(() => reportStopped('keyboard'))
  }

  restartScreenshot()
  restartKeyboard()
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (JSON.stringify(state.settings.behaviorObservation) !== JSON.stringify(previous.settings.behaviorObservation)) restartScreenshot()
    if (JSON.stringify(state.settings.keyboardObservation) !== JSON.stringify(previous.settings.keyboardObservation)) restartKeyboard()
  })
  return () => {
    screenshotGeneration++
    keyboardGeneration++
    unsubscribe()
    screenshotDraining = Promise.all([screenshotDraining, stopScreenshot?.()]).then(() => {}).catch(() => {})
    keyboardDraining = Promise.all([keyboardDraining, stopKeyboard?.()]).then(() => {}).catch(() => {})
  }
}
