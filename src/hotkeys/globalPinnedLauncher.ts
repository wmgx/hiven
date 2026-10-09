import { useAppStore, type GlobalPinnedLauncherShortcut } from '../store'
import { registerHotkeyReloadParticipant } from './pageReload'
import { suppressStandaloneLauncherBlur } from '../workspace/launcherBlurGuard'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')
type TauriCoreApi = typeof import('@tauri-apps/api/core')
type TauriEventApi = typeof import('@tauri-apps/api/event')

let installed = false
let unsubscribeStore: (() => void) | null = null
let unsubscribeDoubleModifierError: (() => void) | null = null
let unsubscribeDoubleModifierReady: (() => void) | null = null
let currentAccelerator: string | null = null
let currentRegistration: { generation: number } | null = null
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()

export function installGlobalPinnedLauncherHotkeys() {
  if (installed) return () => {}
  installed = true

  const shortcut = useAppStore.getState().settings.globalPinnedLauncherShortcut
  void syncShortcut(shortcut)
  void listenForDoubleModifierErrors()
  void listenForDoubleModifierReady()
  unsubscribeStore = useAppStore.subscribe((state, previousState) => {
    const next = state.settings.globalPinnedLauncherShortcut
    const previous = previousState.settings.globalPinnedLauncherShortcut
    const quickEditorActive = state.globalLauncherOpen && state.launcherHostSurfaceTarget === 'quick-editor'
    const previousQuickEditorActive = previousState.globalLauncherOpen && previousState.launcherHostSurfaceTarget === 'quick-editor'
    if (shortcutIdentity(next) !== shortcutIdentity(previous) || quickEditorActive !== previousQuickEditorActive) {
      void syncShortcut(next)
    }
  })

  return registerHotkeyReloadParticipant('global-launcher', {
    resume: installGlobalPinnedLauncherHotkeys,
    stop: () => {
      installed = false
      syncGeneration += 1
      unsubscribeStore?.()
      unsubscribeStore = null
      unsubscribeDoubleModifierError?.()
      unsubscribeDoubleModifierError = null
      unsubscribeDoubleModifierReady?.()
      unsubscribeDoubleModifierReady = null
      syncQueue = syncQueue.catch(() => undefined).then(async () => {
        await unregisterCurrentAccelerator()
        const modifierStopped = await unregisterDoubleModifier()
        if (currentAccelerator || !modifierStopped) throw new Error('Could not release Global Launcher shortcut')
      })
      return syncQueue
    },
  })
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

async function listenForDoubleModifierReady() {
  if (!isTauriRuntime() || unsubscribeDoubleModifierReady) return
  try {
    const { listen } = await loadTauriEventApi()
    unsubscribeDoubleModifierReady = await listen<{ status?: string }>('hiven://double-modifier-hotkey-ready', (event) => {
      const shortcut = useAppStore.getState().settings.globalPinnedLauncherShortcut
      if (shortcut.kind !== 'double-modifier') return
      updateShortcutStatus(shortcut, event.payload?.status ?? 'Registered')
    })
  } catch (error) {
    console.warn('[hiven] Failed to listen for double modifier ready:', error)
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
  if (generation !== syncGeneration) return
  if (currentAccelerator) {
    if (shortcut.kind === 'accelerator' && normalizeAccelerator(shortcut.accelerator) === currentAccelerator && currentRegistration) {
      // Failed native cleanup still leaves this exact registration owned by us.
      currentRegistration.generation = generation
      updateShortcutStatus(shortcut, 'Registered')
    } else {
      updateShortcutStatus(shortcut, 'Registration failed', 'Could not release previous shortcut')
    }
    return
  }

  if (
    useAppStore.getState().globalLauncherOpen &&
    useAppStore.getState().launcherHostSurfaceTarget === 'quick-editor' &&
    shortcut.kind === 'accelerator' &&
    isQuickEditorCommandAccelerator(shortcut.accelerator)
  ) {
    updateShortcutStatus(shortcut, 'Handled by Quick Editor')
    return
  }

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
    const registration = { generation }
    const { register, isRegistered } = await loadGlobalShortcutApi()
    await register(accelerator, (event) => {
      if (!installed || currentRegistration !== registration || registration.generation !== syncGeneration || event.state !== 'Pressed') return
      if (shortcutIdentity(useAppStore.getState().settings.globalPinnedLauncherShortcut) !== shortcutIdentity(shortcut)) return
      void (async () => {
        await routeGlobalPinnedLauncherShortcut()
      })()
    })
    currentAccelerator = accelerator
    currentRegistration = registration
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
    if (currentAccelerator === accelerator) {
      currentAccelerator = null
      currentRegistration = null
    }
  } catch (error) {
    console.warn('[hiven] Failed to unregister global shortcut:', error)
  }
}

async function unregisterAccelerator(accelerator: string) {
  const { unregister } = await loadGlobalShortcutApi()
  await unregister(accelerator)
}

async function unregisterDoubleModifier(): Promise<boolean> {
  if (!isTauriRuntime()) return true
  try {
    const { invoke } = await loadTauriCoreApi()
    await invoke('unregister_double_modifier_hotkey')
    return true
  } catch (error) {
    console.warn('[hiven] Failed to unregister double modifier hook:', error)
    return false
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
  const state = useAppStore.getState()
  if (state.globalLauncherOpen && state.launcherHostSurfaceTarget === 'quick-editor') {
    suppressStandaloneLauncherBlur()
    state.openQuickEditorCommand()
    return
  }
  await showLauncherWindow()
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

function isQuickEditorCommandAccelerator(accelerator: string) {
  const parts = normalizeAccelerator(accelerator)
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
  return parts.includes('k') && parts.some((part) => (
    part === 'command' ||
    part === 'cmd' ||
    part === 'control' ||
    part === 'ctrl' ||
    part === 'cmdorctrl' ||
    part === 'commandorcontrol'
  ))
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
