/** Register per-app global shortcuts → native toggle_installed_app. */
import { useAppStore } from '../store'
import { translate } from '../i18n'
import { showToast } from '../workspace/toast'
import { normalizeAppHotkeyAccelerator, type AppHotkeyBinding } from '../workspace/appHotkeys'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')
type Registration = { accelerator: string; appId: string | null; lifecycle: number }
export type AppHotkeySaveResult = 'saved' | 'cancelled' | 'conflict' | 'failed'

let installed = false
let lifecycle = 0
let syncGeneration = 0
let saveGeneration = 0
let queue: Promise<unknown> = Promise.resolve()
const registrations = new Map<string, Registration>()

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const result = queue.catch(() => undefined).then(work)
  queue = result
  return result
}

export function installAppHotkeys(): () => void {
  if (installed) return () => {}
  installed = true
  const owner = ++lifecycle
  const sync = () => {
    const generation = ++syncGeneration
    void enqueue(() => syncNow(() => installed && lifecycle === owner && generation === syncGeneration))
  }
  sync()
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (state.settings.appHotkeys !== prev.settings.appHotkeys) sync()
  })
  return () => {
    if (lifecycle !== owner) return
    installed = false
    lifecycle += 1
    unsubscribe()
    // Queue cleanup behind pending native calls, and before a subsequent install.
    void enqueue(async () => {
      for (const [key, registration] of registrations) await release(key, registration)
    })
  }
}

/** Settings commit only after registration succeeds; failed attempts never touch persistence. */
export function saveAppHotkey(
  binding: AppHotkeyBinding,
  isCurrent: () => boolean = () => true,
): Promise<AppHotkeySaveResult> {
  const owner = lifecycle
  const request = ++saveGeneration
  const before = useAppStore.getState().settings.appHotkeys
  const current = () => installed && lifecycle === owner && request === saveGeneration &&
    isCurrent() && useAppStore.getState().settings.appHotkeys === before
  const accelerator = normalizeAppHotkeyAccelerator(binding.accelerator)
  return enqueue(async () => {
    if (!current()) return 'cancelled'
    if (!isTauriRuntime() || !binding.appId.trim() || !accelerator) return 'failed'
    const result = await acquire(accelerator, current)
    if (typeof result === 'string') return current() ? result : 'cancelled'
    if (!current()) {
      if (!result.appId) await release(accelerator.toLowerCase(), result)
      return 'cancelled'
    }
    // No asynchronous work between the final guard and the actual Zustand write.
    const beforeCommit = syncGeneration
    try {
      useAppStore.getState().setAppHotkey({ ...binding, accelerator })
    } catch (error) {
      if (!result.appId) await release(accelerator.toLowerCase(), result)
      console.warn('[hiven] app hotkey save failed', error)
      return 'failed'
    }
    if (!installed || lifecycle !== owner || request !== saveGeneration || !isCurrent() ||
        syncGeneration !== beforeCommit + 1) {
      if (!result.appId) await release(accelerator.toLowerCase(), result)
      return 'cancelled'
    }
    result.appId = binding.appId
    const generation = syncGeneration
    await syncNow(() => installed && lifecycle === owner && generation === syncGeneration)
    return 'saved'
  })
}

async function syncNow(current: () => boolean): Promise<void> {
  if (!current() || !isTauriRuntime()) return
  const bindings = (useAppStore.getState().settings.appHotkeys ?? []).filter(
    (b) => b.enabled !== false && b.accelerator.trim() && b.appId.trim(),
  )
  const desired = new Map(bindings.map((b) => [b.appId, normalizeAppHotkeyAccelerator(b.accelerator).toLowerCase()]))
  for (const binding of bindings) {
    if (!current()) return
    const result = await acquire(normalizeAppHotkeyAccelerator(binding.accelerator), current)
    if (result === 'cancelled' || (!current() && typeof result === 'string')) return
    if (typeof result === 'string') {
      showToast(translate(useAppStore.getState().locale, 'settings',
        result === 'conflict' ? 'appHotkeysConflict' : 'appHotkeysRegistrationFailed',
        { name: binding.name, shortcut: binding.accelerator }), 'error')
      continue
    }
    if (!current()) {
      if (!result.appId) await release(result.accelerator.toLowerCase(), result)
      return
    }
    // Existing app-owned keys transfer by changing their route, without unregistering.
    result.appId = binding.appId
  }
  if (!current()) return
  for (const [key, registration] of registrations) {
    const wanted = registration.appId ? desired.get(registration.appId) : undefined
    if (wanted === key) continue
    // Keep the old working key until its replacement has actually registered.
    if (wanted && registrations.get(wanted)?.appId !== registration.appId) continue
    await release(key, registration)
    if (!current()) return
  }
}

async function acquire(
  accelerator: string,
  current: () => boolean,
): Promise<Registration | 'cancelled' | 'conflict' | 'failed'> {
  const key = accelerator.toLowerCase()
  if (!current()) return 'cancelled'
  const existing = registrations.get(key)
  if (existing?.lifecycle === lifecycle) return existing
  if (existing) {
    await release(key, existing)
    if (!current()) return 'cancelled'
    if (registrations.has(key)) return 'failed'
  }
  try {
    const { register, isRegistered } = await loadGlobalShortcutApi()
    if (!current()) return 'cancelled'
    const occupied = await isRegistered(accelerator)
    if (!current()) return 'cancelled'
    if (occupied) return 'conflict'
    const owner = lifecycle
    const registration: Registration = { accelerator, appId: null, lifecycle: owner }
    await register(accelerator, (event) => {
      if (event.state !== 'Pressed' || !installed || lifecycle !== owner ||
          registrations.get(key) !== registration || !registration.appId) return
      const appId = registration.appId
      const active = () => installed && lifecycle === owner && registrations.get(key) === registration &&
        registration.appId === appId && useAppStore.getState().settings.appHotkeys.some(
          (binding) => binding.appId === appId && binding.enabled !== false,
        )
      if (active()) void toggleApp(appId, active)
    })
    registrations.set(key, registration)
    if (!current()) {
      await release(key, registration)
      return 'cancelled'
    }
    return registration
  } catch (error) {
    if (!current()) return 'cancelled'
    console.warn('[hiven] app hotkey register failed', accelerator, error)
    return 'failed'
  }
}

async function release(key: string, registration: Registration): Promise<void> {
  // Suppress a queued native callback even while unregister is still pending.
  registration.appId = null
  try {
    const { unregister } = await loadGlobalShortcutApi()
    await unregister(registration.accelerator)
    if (registrations.get(key) === registration) registrations.delete(key)
  } catch (error) {
    // Keep ownership so the next sync / lifecycle cleanup can retry safely.
    console.warn('[hiven] app hotkey unregister failed', registration.accelerator, error)
  }
}

async function toggleApp(appId: string, active: () => boolean): Promise<void> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    if (!active()) return
    await invoke<string>('toggle_installed_app', { appId })
  } catch (error) {
    console.warn('[hiven] toggle_installed_app failed', appId, error)
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function loadGlobalShortcutApi(): Promise<GlobalShortcutApi> {
  return import('@tauri-apps/plugin-global-shortcut')
}

/** Test helper signature */
export function appHotkeysSyncSignature(list: AppHotkeyBinding[]): string {
  return list
    .map((b) => `${b.appId}|${b.accelerator}|${b.enabled !== false ? 1 : 0}`)
    .sort()
    .join(';')
}
