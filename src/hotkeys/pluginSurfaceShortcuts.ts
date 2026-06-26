import { usePluginPermissionStore, getPluginPermissionSnapshot, missingPluginPermissions } from '../workspace/pluginPermissions'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { requestOpenPluginSurfaceTool } from '../workspace/pluginSurfaceOpenRequest'
import { getPluginSurfaceShortcutPresentation, requestOpenPluginSurfaceWindow } from '../workspace/pluginSurfaceWindows'
import {
  pluginSurfaceShortcutKey,
  usePluginSurfaceShortcutStore,
  type PluginSurfaceShortcut,
} from '../workspace/pluginSurfaceShortcuts'
import { useAppStore, type PluginSurfaceOpenTarget } from '../store'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')

let installed = false
let unsubscribeShortcutStore: (() => void) | null = null
let unsubscribeRegistry: (() => void) | null = null
let unsubscribePermissions: (() => void) | null = null
const currentAccelerators = new Map<string, string>()
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()

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

  return () => {
    installed = false
    syncGeneration += 1
    unsubscribeShortcutStore?.()
    unsubscribeShortcutStore = null
    unsubscribeRegistry?.()
    unsubscribeRegistry = null
    unsubscribePermissions?.()
    unsubscribePermissions = null
    void unregisterAllPluginSurfaceShortcuts()
  }
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
  const current = currentAccelerators.get(key)
  try {
    const { register, isRegistered } = await loadGlobalShortcutApi()
    if (current === accelerator) {
      await unregisterAccelerator(accelerator)
      currentAccelerators.delete(key)
    } else {
      await unregisterKey(key)
    }

    if (await isRegistered(accelerator)) {
      if (isGlobalPinnedLauncherAccelerator(accelerator)) {
        usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
          registrationStatus: 'conflict',
          registrationError: 'Shortcut is already registered',
        })
        return
      }
      await unregisterAccelerator(accelerator)
    }
    await register(accelerator, (event) => {
      if (event.state !== 'Pressed') return
      const latest = usePluginSurfaceShortcutStore.getState().shortcuts[key]
      if (!latest || !latest.enabled || normalizeAccelerator(latest.accelerator) !== accelerator) return
      void openSurfaceForShortcut(shortcut.target)
    })
    if (generation !== syncGeneration) {
      await unregisterAccelerator(accelerator)
      return
    }
    currentAccelerators.set(key, accelerator)
    usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
      registrationStatus: 'registered',
      registrationError: undefined,
    })
  } catch (error) {
    usePluginSurfaceShortcutStore.getState().updateRegistration(key, {
      registrationStatus: 'failed',
      registrationError: formatError(error),
    })
  }
}

async function openSurfaceForShortcut(target: PluginSurfaceOpenTarget): Promise<void> {
  if (getPluginSurfaceShortcutPresentation(target) === 'window') {
    await requestOpenPluginSurfaceWindow(target)
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
  await unregisterAccelerator(accelerator)
  currentAccelerators.delete(key)
}

async function unregisterAllPluginSurfaceShortcuts(): Promise<void> {
  for (const key of Array.from(currentAccelerators.keys())) {
    await unregisterKey(key)
  }
}

async function unregisterAccelerator(accelerator: string): Promise<void> {
  try {
    const { unregister } = await loadGlobalShortcutApi()
    await unregister(accelerator)
  } catch (error) {
    console.warn('[hiven] Failed to unregister plugin surface shortcut:', error)
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

function isGlobalPinnedLauncherAccelerator(accelerator: string): boolean {
  const shortcut = useAppStore.getState().settings.globalPinnedLauncherShortcut
  return shortcut.kind === 'accelerator' && normalizeAccelerator(shortcut.accelerator) === accelerator
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
