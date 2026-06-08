import { useAppStore, type GlobalPinnedLauncherShortcut } from '../store'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')
type TauriCoreApi = typeof import('@tauri-apps/api/core')
type TauriEventApi = typeof import('@tauri-apps/api/event')

let installed = false
let unsubscribeStore: (() => void) | null = null
let unsubscribeDoubleCmdError: (() => void) | null = null
let currentAccelerator: string | null = null
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()

export function installGlobalPinnedLauncherHotkeys() {
  if (installed) return () => {}
  installed = true

  void syncShortcut(useAppStore.getState().settings.globalPinnedLauncherShortcut)
  void listenForDoubleCmdErrors()
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
    unsubscribeDoubleCmdError?.()
    unsubscribeDoubleCmdError = null
    void unregisterCurrentAccelerator()
    void unregisterDoubleCmd()
  }
}

async function listenForDoubleCmdErrors() {
  if (!isTauriRuntime() || unsubscribeDoubleCmdError) return
  try {
    const { listen } = await loadTauriEventApi()
    unsubscribeDoubleCmdError = await listen<{ error?: string }>('fluxtext://double-cmd-hotkey-error', (event) => {
      const shortcut = useAppStore.getState().settings.globalPinnedLauncherShortcut
      if (shortcut.kind !== 'double-modifier') return
      updateShortcutStatus(shortcut, 'Registration failed', event.payload?.error ?? 'Double Cmd listener failed')
    })
  } catch (error) {
    console.warn('[FluxText] Failed to listen for Double Cmd errors:', error)
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
  await unregisterDoubleCmd()
  if (generation !== syncGeneration) return

  if (shortcut.kind === 'disabled') {
    updateShortcutStatus(shortcut, 'Disabled')
    return
  }

  if (shortcut.kind === 'double-modifier') {
    await registerDoubleCmd(shortcut, generation)
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
        await showLauncherWindow()
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

async function registerDoubleCmd(shortcut: GlobalPinnedLauncherShortcut, generation: number) {
  try {
    const { invoke } = await loadTauriCoreApi()
    const result = await invoke<{ status: string }>('register_double_cmd_hotkey')
    if (generation !== syncGeneration) {
      if (shortcutIdentity(useAppStore.getState().settings.globalPinnedLauncherShortcut) !== shortcutIdentity(shortcut)) {
        await unregisterDoubleCmd()
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
    console.warn('[FluxText] Failed to unregister global shortcut:', error)
  }
}

async function unregisterAccelerator(accelerator: string) {
  const { unregister } = await loadGlobalShortcutApi()
  await unregister(accelerator)
}

async function unregisterDoubleCmd() {
  if (!isTauriRuntime()) return
  try {
    const { invoke } = await loadTauriCoreApi()
    await invoke('unregister_double_cmd_hotkey')
  } catch (error) {
    console.warn('[FluxText] Failed to unregister Double Cmd hook:', error)
  }
}

async function showLauncherWindow() {
  try {
    const { invoke } = await loadTauriCoreApi()
    await invoke('show_launcher_window')
  } catch (error) {
    console.warn('[FluxText] Failed to show launcher window from global shortcut:', error)
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
