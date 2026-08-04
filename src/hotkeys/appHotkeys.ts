/**
 * Register per-app global shortcuts → native toggle_installed_app.
 */

import { useAppStore } from '../store'
import type { AppHotkeyBinding } from '../workspace/appHotkeys'

type GlobalShortcutApi = typeof import('@tauri-apps/plugin-global-shortcut')
type TauriCoreApi = typeof import('@tauri-apps/api/core')

let installed = false
let unsubscribeStore: (() => void) | null = null
const currentAccelerators = new Map<string, string>() // appId → accelerator
let syncGeneration = 0
let syncQueue: Promise<void> = Promise.resolve()

export function installAppHotkeys(): () => void {
  if (installed) return () => {}
  installed = true
  void enqueueSync()
  unsubscribeStore = useAppStore.subscribe((state, prev) => {
    if (state.settings.appHotkeys !== prev.settings.appHotkeys) void enqueueSync()
  })
  return () => {
    installed = false
    syncGeneration += 1
    unsubscribeStore?.()
    unsubscribeStore = null
    void unregisterAll()
  }
}

function enqueueSync(): Promise<void> {
  const generation = ++syncGeneration
  syncQueue = syncQueue.catch(() => undefined).then(() => syncNow(generation))
  return syncQueue
}

function normalizeAccelerator(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/CommandOrControl/gi, 'CmdOrCtrl')
    .replace(/Command/gi, 'Cmd')
    .replace(/Control/gi, 'Ctrl')
    .replace(/Option/gi, 'Alt')
}

async function syncNow(generation: number): Promise<void> {
  const bindings = (useAppStore.getState().settings.appHotkeys ?? []).filter(
    (b) => b.enabled !== false && b.accelerator.trim() && b.appId.trim(),
  )

  if (!isTauriRuntime()) {
    currentAccelerators.clear()
    return
  }

  const desired = new Map<string, string>()
  for (const b of bindings) {
    desired.set(b.appId, normalizeAccelerator(b.accelerator))
  }

  // Unregister removed / changed
  for (const [appId, acc] of [...currentAccelerators.entries()]) {
    if (desired.get(appId) === acc) continue
    await safeUnregister(acc)
    currentAccelerators.delete(appId)
  }
  if (generation !== syncGeneration) return

  for (const [appId, acc] of desired) {
    if (generation !== syncGeneration) return
    if (currentAccelerators.get(appId) === acc) continue
    try {
      const { register, isRegistered } = await loadGlobalShortcutApi()
      if (await isRegistered(acc)) {
        // Conflict with another subsystem — skip quietly
        continue
      }
      await register(acc, (event) => {
        if (event.state !== 'Pressed') return
        void toggleApp(appId)
      })
      currentAccelerators.set(appId, acc)
    } catch (error) {
      console.warn('[hiven] app hotkey register failed', appId, acc, error)
    }
  }
}

async function toggleApp(appId: string): Promise<void> {
  try {
    const { invoke } = await loadTauriCoreApi()
    await invoke<string>('toggle_installed_app', { appId })
  } catch (error) {
    console.warn('[hiven] toggle_installed_app failed', appId, error)
  }
}

async function unregisterAll(): Promise<void> {
  for (const acc of currentAccelerators.values()) {
    await safeUnregister(acc)
  }
  currentAccelerators.clear()
}

async function safeUnregister(accelerator: string): Promise<void> {
  try {
    const { unregister, isRegistered } = await loadGlobalShortcutApi()
    if (await isRegistered(accelerator)) await unregister(accelerator)
  } catch {
    // ignore
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function loadGlobalShortcutApi(): Promise<GlobalShortcutApi> {
  return import('@tauri-apps/plugin-global-shortcut')
}

async function loadTauriCoreApi(): Promise<TauriCoreApi> {
  return import('@tauri-apps/api/core')
}

/** Test helper signature */
export function appHotkeysSyncSignature(list: AppHotkeyBinding[]): string {
  return list
    .map((b) => `${b.appId}|${b.accelerator}|${b.enabled !== false ? 1 : 0}`)
    .sort()
    .join(';')
}
