import { usePluginPermissionStore, getPluginPermissionSnapshot, missingPluginPermissions } from '../workspace/pluginPermissions'
import { registerHotkeyReloadParticipant } from './pageReload'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { requestOpenPluginSurfaceTool } from '../workspace/pluginSurfaceOpenRequest'
import { getPluginSurfaceShortcutPresentation, showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import {
  pluginSurfaceShortcutKey,
  usePluginSurfaceShortcutStore,
  type PluginSurfaceShortcut,
} from '../workspace/pluginSurfaceShortcuts'
import type { PluginSurfaceOpenTarget } from '../store'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')

let installed = false
let unsubscribeShortcutStore: (() => void) | null = null
let unsubscribeRegistry: (() => void) | null = null
let unsubscribePermissions: (() => void) | null = null
const currentAccelerators = new Map<string, string>()
const currentRegistrations = new Map<string, { generation: number }>()
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()
// Host-owned, bounded lifetime interception of an already registered surface.
// The host authorizes the plugin/permission before acquiring one.
const shortcutInterceptors = new Map<string, { accelerator: string; registered: boolean; handle: () => Promise<boolean>; pressed: boolean; release?: () => Promise<void> }>()

export function installPluginSurfaceShortcutHotkeys(): () => void {
  if (installed) return () => {}
  installed = true

  void enqueueSync()
  unsubscribeShortcutStore = usePluginSurfaceShortcutStore.subscribe((state, previous) => {
    if (shortcutSyncSignature(state.shortcuts) !== shortcutSyncSignature(previous.shortcuts)) void enqueueSync()
  })
  unsubscribeRegistry = pluginRegistry.subscribe(() => {
    void enqueueSync()
  })
  unsubscribePermissions = usePluginPermissionStore.subscribe((state, previous) => {
    if (state.permissions !== previous.permissions) void enqueueSync()
  })

  return registerHotkeyReloadParticipant('plugin-surfaces', {
    resume: installPluginSurfaceShortcutHotkeys,
    stop: () => {
      installed = false
      syncGeneration += 1
      unsubscribeShortcutStore?.()
      unsubscribeShortcutStore = null
      unsubscribeRegistry?.()
      unsubscribeRegistry = null
      unsubscribePermissions?.()
      unsubscribePermissions = null
      syncQueue = syncQueue.catch(() => undefined).then(async () => {
        await unregisterAllPluginSurfaceShortcuts()
        if (currentAccelerators.size) throw new Error('Could not release plugin surface shortcuts')
      })
      return syncQueue
    },
  })
}

function enqueueSync(): Promise<void> {
  const generation = ++syncGeneration
  syncQueue = syncQueue
    .catch(() => undefined)
    .then(() => syncNow(generation))
  return syncQueue
}

async function syncNow(generation: number): Promise<void> {
  const shortcuts = usePluginSurfaceShortcutStore.getState().shortcuts
  const normalizedEntries = Object.entries(shortcuts)
    .map(([key, shortcut]) => ({ key, shortcut, accelerator: normalizeAccelerator(shortcut.accelerator) }))
    .filter(({ shortcut, accelerator }) => shortcut.enabled && accelerator.length > 0)

  const duplicateAccelerators = new Set<string>()
  const seen = new Map<string, string>()
  for (const { key, accelerator } of normalizedEntries) {
    const first = seen.get(accelerator)
    if (first) {
      duplicateAccelerators.add(accelerator)
      usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
        registrationStatus: 'conflict',
        registrationError: `Shortcut already used by ${first}`,
      })
    } else {
      seen.set(accelerator, key)
    }
  }

  await unregisterRemovedOrChanged(shortcuts)
  if (!isTauriRuntime()) {
    markNonTauri(shortcuts)
    return
  }

  for (const { key, shortcut, accelerator } of normalizedEntries) {
    if (generation !== syncGeneration) return
    if (duplicateAccelerators.has(accelerator)) {
      await unregisterKey(key)
      continue
    }
    if (!isBindableSurfaceTarget(shortcut.target)) {
      await unregisterKey(key)
      usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
        registrationStatus: 'disabled',
        registrationError: 'Plugin surface is not registered',
      })
      continue
    }
    const missing = missingShortcutPermissions(shortcut.target)
    if (missing.length > 0) {
      await unregisterKey(key)
      usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
        registrationStatus: 'failed',
        registrationError: `Missing permission: ${missing.join(', ')}`,
      })
      continue
    }
    await registerShortcut(key, shortcut, accelerator, generation)
  }
}

async function registerShortcut(
  key: string,
  shortcut: PluginSurfaceShortcut,
  accelerator: string,
  generation: number,
): Promise<void> {
  try {
    const { register, isRegistered } = await loadGlobalShortcutApi()
    await unregisterKey(key)

    if (currentAccelerators.has(key)) {
      const registration = currentRegistrations.get(key)
      if (currentAccelerators.get(key) !== accelerator || !registration) throw new Error('Could not release previous shortcut')
      if (generation !== syncGeneration) return
      registration.generation = generation
      usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
        registrationStatus: 'registered', registrationError: undefined,
      })
      return
    }
    const occupied = await isRegistered(accelerator)
    if (generation !== syncGeneration) return
    if (occupied) {
      // Occupancy alone never authorizes taking over another registrar's key.
      usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
        registrationStatus: 'conflict',
        registrationError: 'Shortcut is already registered',
      })
      return
    }
    const registration = { generation }
    await register(accelerator, (event) => {
      if (!installed || currentRegistrations.get(key) !== registration || registration.generation !== syncGeneration) return
      const latest = usePluginSurfaceShortcutStore.getState().shortcuts[key]
      if (!latest || !latest.enabled || normalizeAccelerator(latest.accelerator) !== accelerator) return
      const interceptor = shortcutInterceptors.get(key)
      if (interceptor && (interceptor.registered || sameAccelerator(interceptor.accelerator, accelerator))) {
        if (event.state === 'Released') { interceptor.pressed = false; return }
        if (event.state !== 'Pressed' || interceptor.pressed || interceptor.release) return
        interceptor.pressed = true
        void interceptor.handle().then((handled) => { if (!handled) return openSurfaceForShortcut(shortcut.target) }).catch(() => undefined)
      } else if (event.state === 'Pressed') void openSurfaceForShortcut(shortcut.target)
    })
    currentAccelerators.set(key, accelerator)
    currentRegistrations.set(key, registration)
    if (generation !== syncGeneration) {
      await unregisterKey(key)
      return
    }
    usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
      registrationStatus: 'registered',
      registrationError: undefined,
    })
  } catch (error) {
    if (generation !== syncGeneration) return
    usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
      registrationStatus: 'failed',
      registrationError: formatError(error),
    })
  }
}

async function openSurfaceForShortcut(target: PluginSurfaceOpenTarget): Promise<void> {
  if (getPluginSurfaceShortcutPresentation(target) === 'window') {
    await showPluginSurfaceWindow(target)
    return
  }
  await requestOpenPluginSurfaceTool(target)
}

async function unregisterRemovedOrChanged(shortcuts: Record<string, PluginSurfaceShortcut>): Promise<void> {
  for (const [key, accelerator] of Array.from(currentAccelerators)) {
    const shortcut = shortcuts[key]
    if (!shortcut || !shortcut.enabled || normalizeAccelerator(shortcut.accelerator) !== accelerator) {
      await unregisterKey(key)
    }
  }
}

async function unregisterKey(key: string): Promise<void> {
  const accelerator = currentAccelerators.get(key)
  if (!accelerator || !isTauriRuntime()) return
  if (await unregisterAccelerator(accelerator)) {
    currentAccelerators.delete(key)
    currentRegistrations.delete(key)
  }
}

async function unregisterAllPluginSurfaceShortcuts(): Promise<void> {
  for (const key of Array.from(currentAccelerators.keys())) {
    await unregisterKey(key)
  }
}

async function unregisterAccelerator(accelerator: string): Promise<boolean> {
  try {
    const { unregister } = await loadGlobalShortcutApi()
    await unregister(accelerator)
    return true
  } catch (error) {
    console.warn('[hiven] Failed to unregister plugin surface shortcut:', error)
    return false
  }
}

function isBindableSurfaceTarget(target: PluginSurfaceOpenTarget): boolean {
  const entry = pluginRegistry.getAllPluginDefinitions().find((candidate) => {
    if (candidate.pluginId !== target.pluginId) return false
    return resolvePluginSettingsSource(candidate.pluginId, candidate.source) === target.source
  })
  const surface = entry?.definition.ui?.surfaces?.find((item) => item.id === target.surfaceId)
  return !!surface && surface.entry?.shortcutBindable !== false
}

function missingShortcutPermissions(target: PluginSurfaceOpenTarget): string[] {
  const requestedPermissions = pluginRegistry.getPluginPermissions(target.pluginId, target.source)
  const snapshot = getPluginPermissionSnapshot(target.source, target.pluginId, requestedPermissions)
  return missingPluginPermissions(snapshot, requestedPermissions.includes('globalShortcut.register') ? ['globalShortcut.register'] : [])
}

function markNonTauri(shortcuts: Record<string, PluginSurfaceShortcut>): void {
  for (const [key, shortcut] of Object.entries(shortcuts)) {
    if (!shortcut.enabled) continue
    usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
      registrationStatus: 'disabled',
      registrationError: 'Desktop app required',
    })
  }
}

function normalizeAccelerator(accelerator: string): string {
  return accelerator.trim().replace(/\bCmd\b/g, 'Command')
}

function shortcutSyncSignature(shortcuts: Record<string, PluginSurfaceShortcut>): string {
  return Object.entries(shortcuts)
    .map(([key, shortcut]) => [
      key,
      shortcut.target.source,
      shortcut.target.pluginId,
      shortcut.target.surfaceId,
      normalizeAccelerator(shortcut.accelerator),
      shortcut.enabled ? '1' : '0',
    ].join('\u0000'))
    .sort()
    .join('\u0001')
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function loadGlobalShortcutApi(): Promise<GlobalShortcutApi> {
  return import('@tauri-apps/plugin-global-shortcut')
}

export function getPluginSurfaceShortcutDebugKey(target: PluginSurfaceOpenTarget): string {
  return pluginSurfaceShortcutKey(target)
}


function sameAccelerator(left: string, right: string): boolean {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const canonical = (value: string) => value.toLowerCase().split('+').map((part) => {
    if (['cmdorctrl', 'commandorcontrol', 'commandorctrl'].includes(part)) return mac ? 'command' : 'control'
    if (part === 'ctrl') return 'control'
    if (part === 'cmd') return 'command'
    return part.trim()
  }).sort().join('+')
  return canonical(left) === canonical(right)
}

/** Narrow app-composition hook: only an existing permission-approved surface.
 * It never takes an occupied key from another registrar and never persists a key.
 */
export async function acquireSurfaceShortcutInterceptor(
  target: PluginSurfaceOpenTarget,
  accelerator: string,
  handle: () => Promise<boolean>,
): Promise<() => Promise<void>> {
  if (!isTauriRuntime() || !installed || !isBindableSurfaceTarget(target) || missingShortcutPermissions(target).length) throw new Error('QueueUnavailableError')
  await syncQueue
  const key = pluginSurfaceShortcutKey(target)
  const previous = shortcutInterceptors.get(key)
  if (previous?.release) await previous.release()
  else if (previous) throw new Error('QueueShortcutConflictError')
  const entry: { accelerator: string; registered: boolean; handle: () => Promise<boolean>; pressed: boolean; release?: () => Promise<void> } = { accelerator, registered: false, handle, pressed: false }
  const registered = currentAccelerators.get(key)
  let temporary = false
  if (!registered || !sameAccelerator(registered, accelerator)) {
    const { register, isRegistered } = await loadGlobalShortcutApi()
    if (await isRegistered(accelerator)) throw new Error('QueueShortcutConflictError')
    await register(accelerator, (event) => {
      if (shortcutInterceptors.get(key) !== entry || !installed) return
      if (event.state === 'Released') { entry.pressed = false; return }
      if (event.state !== 'Pressed' || entry.pressed || entry.release) return
      entry.pressed = true
      void handle().catch(() => undefined)
    })
    temporary = true
  }
  shortcutInterceptors.set(key, entry)
  let stopped = false
  let releasing: Promise<void> | null = null
  const stop = (): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (releasing) return releasing
    // Preserve this exact release capability on failure. A later cancel,
    // controlled reload recovery, or acquisition can retry only our own key.
    entry.release = stop
    releasing = (async () => {
      if (temporary && !await unregisterAccelerator(accelerator)) throw new Error('QueueShortcutReleaseError')
      stopped = true
      if (shortcutInterceptors.get(key) === entry) shortcutInterceptors.delete(key)
      if (temporary && installed) await enqueueSync().catch(() => undefined)
    })().finally(() => { releasing = null })
    return releasing
  }
  return stop
}

/** Attach behavior only to the user's already-registered surface shortcut.
 * Never registers, moves, or persists an accelerator of its own.
 */
export async function acquireRegisteredSurfaceShortcutInterceptor(
  target: PluginSurfaceOpenTarget,
  handle: () => Promise<boolean>,
): Promise<() => Promise<void>> {
  if (!isTauriRuntime() || !installed || !isBindableSurfaceTarget(target) || missingShortcutPermissions(target).length) throw new Error('ShortcutUnavailableError')
  await syncQueue
  const key = pluginSurfaceShortcutKey(target)
  const shortcut = usePluginSurfaceShortcutStore.getState().shortcuts[key]
  const accelerator = currentAccelerators.get(key)
  if (!shortcut?.enabled || shortcut.registrationStatus !== 'registered' || !accelerator
    || !sameAccelerator(accelerator, shortcut.accelerator)) throw new Error('ShortcutUnavailableError')
  const previous = shortcutInterceptors.get(key)
  if (previous?.release) await previous.release()
  else if (previous) throw new Error('ShortcutConflictError')
  const entry: { accelerator: string; registered: boolean; handle: () => Promise<boolean>; pressed: boolean; release?: () => Promise<void> } = {
    accelerator, registered: true, handle, pressed: false,
  }
  shortcutInterceptors.set(key, entry)
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    if (shortcutInterceptors.get(key) === entry) shortcutInterceptors.delete(key)
  }
  return stop
}

/** Install fail-closed behavior before a registered shortcut can fire.
 * Registration, persistence and conflict ownership remain with the surface
 * shortcut registrar; this handler never creates or moves a key binding.
 */
export function installRegisteredSurfaceShortcutHandler(
  target: PluginSurfaceOpenTarget,
  handle: () => Promise<boolean>,
): () => void {
  if (!isBindableSurfaceTarget(target)) throw new Error('ShortcutUnavailableError')
  const key = pluginSurfaceShortcutKey(target)
  if (shortcutInterceptors.has(key)) throw new Error('ShortcutConflictError')
  const entry = { accelerator: '', registered: true, handle, pressed: false }
  shortcutInterceptors.set(key, entry)
  return () => {
    if (shortcutInterceptors.get(key) === entry) shortcutInterceptors.delete(key)
  }
}
