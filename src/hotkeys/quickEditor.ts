/**
 * Global shortcut to summon Quick Editor from settings.
 * Supports accelerator + disabled (same shape as globalPinnedLauncherShortcut).
 */
import { useAppStore, type GlobalPinnedLauncherShortcut } from '../store'
import { showQuickEditorSurface } from '../workspace/quickEditor/quickEditorRequests'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')

let installed = false
let unsubscribeStore: (() => void) | null = null
let currentAccelerator: string | null = null
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()

export function installQuickEditorHotkeys(): () => void {
  if (installed) return () => {}
  installed = true

  void syncShortcut(useAppStore.getState().settings.quickEditorShortcut ?? { kind: 'disabled' })
  unsubscribeStore = useAppStore.subscribe((state, previousState) => {
    const next = state.settings.quickEditorShortcut
    const previous = previousState.settings.quickEditorShortcut
    if (shortcutIdentity(next) !== shortcutIdentity(previous)) {
      void syncShortcut(next ?? { kind: 'disabled' })
    }
  })

  return () => {
    installed = false
    syncGeneration += 1
    unsubscribeStore?.()
    unsubscribeStore = null
    void unregisterCurrentAccelerator()
  }
}

function syncShortcut(shortcut: GlobalPinnedLauncherShortcut) {
  const generation = ++syncGeneration
  syncQueue = syncQueue
    .catch(() => undefined)
    .then(() => syncShortcutNow(shortcut, generation))
}

async function syncShortcutNow(shortcut: GlobalPinnedLauncherShortcut, generation: number) {
  if (!isTauriRuntime()) return

  await unregisterCurrentAccelerator()
  if (generation !== syncGeneration) return

  if (shortcut.kind === 'disabled') {
    updateShortcutStatus(shortcut, 'Disabled')
    return
  }

  if (shortcut.kind === 'double-modifier') {
    updateShortcutStatus(
      shortcut,
      'Registration failed',
      'Quick Editor does not support double-modifier shortcuts; record a key combo instead.',
    )
    return
  }

  await registerAccelerator(shortcut, generation)
}

async function registerAccelerator(
  shortcut: Extract<GlobalPinnedLauncherShortcut, { kind: 'accelerator' }>,
  generation: number,
) {
  try {
    const accelerator = normalizeAccelerator(shortcut.accelerator)
    const { register, isRegistered, unregister } = await loadGlobalShortcutApi()

    const launcher = useAppStore.getState().settings.globalPinnedLauncherShortcut
    if (
      launcher.kind === 'accelerator' &&
      normalizeAccelerator(launcher.accelerator) === accelerator
    ) {
      updateShortcutStatus(shortcut, 'Registration failed', 'Shortcut is already used by Global Launcher')
      return
    }

    if (await isRegistered(accelerator)) {
      try {
        await unregister(accelerator)
      } catch {
        // ignore reclaim failures
      }
    }

    await register(accelerator, (event) => {
      if (event.state !== 'Pressed') return
      const current = useAppStore.getState().settings.quickEditorShortcut
      if (shortcutIdentity(current) !== shortcutIdentity(shortcut)) return
      void routeQuickEditorShortcut()
    })
    currentAccelerator = accelerator
    if (generation !== syncGeneration) {
      await unregisterCurrentAccelerator()
      return
    }
    const registered = await isRegistered(accelerator)
    if (generation === syncGeneration) {
      updateShortcutStatus(shortcut, registered ? 'Registered' : 'Registration pending')
    }
  } catch (error) {
    if (generation === syncGeneration) {
      updateShortcutStatus(shortcut, 'Registration failed', formatError(error))
    }
  }
}

export async function routeQuickEditorShortcut(): Promise<void> {
  try {
    await showQuickEditorSurface()
  } catch (error) {
    console.warn('[hiven] Failed to open Quick Editor from global shortcut:', error)
  }
}

async function unregisterCurrentAccelerator() {
  if (!currentAccelerator || !isTauriRuntime()) return
  const accelerator = currentAccelerator
  try {
    const { unregister } = await loadGlobalShortcutApi()
    await unregister(accelerator)
    if (currentAccelerator === accelerator) currentAccelerator = null
  } catch (error) {
    console.warn('[hiven] Failed to unregister Quick Editor shortcut:', error)
  }
}

function updateShortcutStatus(
  shortcut: GlobalPinnedLauncherShortcut,
  registrationStatus: string,
  registrationError?: string,
) {
  const current = useAppStore.getState().settings.quickEditorShortcut
  if (shortcutIdentity(current) !== shortcutIdentity(shortcut)) return
  useAppStore.getState().updateSetting('quickEditorShortcut', {
    ...current,
    registrationStatus,
    registrationError,
  })
}

function normalizeAccelerator(accelerator: string) {
  return accelerator.replace(/\bCmd\b/g, 'Command')
}

function shortcutIdentity(shortcut: GlobalPinnedLauncherShortcut | undefined | null) {
  if (!shortcut) return 'disabled'
  if (shortcut.kind === 'accelerator') return `${shortcut.kind}:${shortcut.accelerator}`
  if (shortcut.kind === 'double-modifier') return `${shortcut.kind}:${shortcut.modifier}`
  return shortcut.kind
}

function isTauriRuntime() {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function loadGlobalShortcutApi(): Promise<GlobalShortcutApi> {
  return import('@tauri-apps/plugin-global-shortcut')
}
