import { useAppStore, type GlobalPinnedLauncherShortcut } from '../store'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')
type TauriCoreApi = typeof import('@tauri-apps/api/core')
type TauriEventApi = typeof import('@tauri-apps/api/event')
type TauriWindowApi = typeof import('@tauri-apps/api/window')

let installed = false
let unsubscribeStore: (() => void) | null = null
let unsubscribeDoubleModifierError: (() => void) | null = null
let currentAccelerator: string | null = null
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()

export function installGlobalPinnedLauncherHotkeys() {
  if (installed) return () => {}
  installed = true

  void syncShortcut(useAppStore.getState().settings.globalPinnedLauncherShortcut)
  void listenForDoubleModifierErrors()
  unsubscribeStore = useAppStore.subscribe((state, previousState) => {
    const next = state.settings.globalPinnedLauncherShortcut
    const previous = previousState.settings.globalPinnedLauncherShortcut
    if (shortcutIdentity(next) !== shortcutIdentity(previous)) {
      void syncShortcut(next)
    }
  })

  return () => {
    installed = false
    syncGeneration += 1
    unsubscribeStore?.()
    unsubscribeStore = null
    unsubscribeDoubleModifierError?.()
    unsubscribeDoubleModifierError = null
    void unregisterCurrentAccelerator()
    void unregisterDoubleModifier()
  }
}

async function listenForDoubleModifierErrors() {
  if (!isTauriRuntime() || unsubscribeDoubleModifierError) return
  try {
    const { listen } = await loadTauriEventApi()
    unsubscribeDoubleModifierError = await listen<{ error?: string }>('hiven://double-modifier-hotkey-error', (event) => {
      const shortcut = useAppStore.getState().settings.globalPinnedLauncherShortcut
      if (shortcut.kind !== 'double-modifier') return
      updateShortcutStatus(shortcut, 'Registration failed', event.payload?.error ?? 'Double modifier listener failed')
    })
  } catch (error) {
    console.warn('[hiven] Failed to listen for double modifier errors:', error)
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
  await unregisterDoubleModifier()
  try {
    const { unregisterAll } = await loadGlobalShortcutApi()
    await unregisterAll()
    currentAccelerator = null
  } catch (error) {
    console.warn('[hiven] Failed to clear stale global shortcuts:', error)
  }
  if (generation !== syncGeneration) return

  if (shortcut.kind === 'disabled') {
    updateShortcutStatus(shortcut, 'Disabled')
    return
  }

  if (shortcut.kind === 'double-modifier') {
    await registerDoubleModifier(shortcut, generation)
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
    const { register, isRegistered } = await loadGlobalShortcutApi()
    await register(accelerator, (event) => {
      if (event.state !== 'Pressed') return
      if (shortcutIdentity(useAppStore.getState().settings.globalPinnedLauncherShortcut) !== shortcutIdentity(shortcut)) return
      void (async () => {
        await routeGlobalPinnedLauncherShortcut()
      })()
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
    if (generation === syncGeneration) updateShortcutStatus(shortcut, 'Registration failed', formatError(error))
  }
}

async function registerDoubleModifier(shortcut: GlobalPinnedLauncherShortcut, generation: number) {
  try {
    const { invoke } = await loadTauriCoreApi()
    const modifier = shortcut.kind === 'double-modifier' ? shortcut.modifier : 'Command'
    const result = await invoke<{ status: string }>('register_double_modifier_hotkey', { modifier })
    if (generation !== syncGeneration) {
      if (shortcutIdentity(useAppStore.getState().settings.globalPinnedLauncherShortcut) !== shortcutIdentity(shortcut)) {
        await unregisterDoubleModifier()
      }
      return
    }
    if (generation === syncGeneration) updateShortcutStatus(shortcut, result.status)
  } catch (error) {
    if (generation === syncGeneration) updateShortcutStatus(shortcut, 'Registration failed', formatError(error))
  }
}

async function unregisterCurrentAccelerator() {
  if (!currentAccelerator || !isTauriRuntime()) return
  const accelerator = currentAccelerator
  try {
    await unregisterAccelerator(accelerator)
    if (currentAccelerator === accelerator) currentAccelerator = null
  } catch (error) {
    console.warn('[hiven] Failed to unregister global shortcut:', error)
  }
}

async function unregisterAccelerator(accelerator: string) {
  const { unregister } = await loadGlobalShortcutApi()
  await unregister(accelerator)
}

async function unregisterDoubleModifier() {
  if (!isTauriRuntime()) return
  try {
    const { invoke } = await loadTauriCoreApi()
    await invoke('unregister_double_modifier_hotkey')
  } catch (error) {
    console.warn('[hiven] Failed to unregister double modifier hook:', error)
  }
}

async function showLauncherWindow() {
  try {
    const { invoke } = await loadTauriCoreApi()
    await invoke('show_launcher_window')
  } catch (error) {
    console.warn('[hiven] Failed to show launcher window from global shortcut:', error)
  }
}

export async function routeGlobalPinnedLauncherShortcut() {
  if (await shouldOpenCommandPaletteInMainWindow()) {
    useAppStore.getState().setCommandPaletteOpen(true)
    return
  }
  await showLauncherWindow()
}

async function shouldOpenCommandPaletteInMainWindow() {
  const state = useAppStore.getState()
  if (state.activeView !== 'editor') return false
  if (!isTauriRuntime()) return true
  try {
    const { getCurrentWindow } = await loadTauriWindowApi()
    return await getCurrentWindow().isFocused()
  } catch (error) {
    console.warn('[hiven] Failed to inspect main window focus for global shortcut:', error)
    return false
  }
}

function updateShortcutStatus(
  shortcut: GlobalPinnedLauncherShortcut,
  registrationStatus: string,
  registrationError?: string,
) {
  const current = useAppStore.getState().settings.globalPinnedLauncherShortcut
  if (shortcutIdentity(current) !== shortcutIdentity(shortcut)) return
  useAppStore.getState().updateSetting('globalPinnedLauncherShortcut', {
    ...current,
    registrationStatus,
    registrationError,
  })
}

function normalizeAccelerator(accelerator: string) {
  return accelerator.replace(/\bCmd\b/g, 'Command')
}

function shortcutIdentity(shortcut: GlobalPinnedLauncherShortcut) {
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

function loadTauriCoreApi(): Promise<TauriCoreApi> {
  return import('@tauri-apps/api/core')
}

function loadTauriEventApi(): Promise<TauriEventApi> {
  return import('@tauri-apps/api/event')
}

function loadTauriWindowApi(): Promise<TauriWindowApi> {
  return import('@tauri-apps/api/window')
}
