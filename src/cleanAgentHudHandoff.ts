import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from './store'
import { detectContent } from './kits/content'
import { acquireRegisteredSurfaceShortcutInterceptor } from './hotkeys/pluginSurfaceShortcuts'
import { cleanAgentText } from './plugins/line-tools/cleanAgentText'
import { CleanAgentHudSession, type CleanAgentHudView } from './plugins/line-tools/cleanAgentHudSession'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from './workspace/pluginPermissions'
import { pluginRegistry } from './workspace/pluginRegistry'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from './workspace/pluginSurfaceShortcuts'
import { readNativeClipboardText, writeTextWithoutHistory } from './workspace/nativeClipboard'
import { writeClipboardText } from './workspace/pluginClipboard'
import { claimTextResultHud, type TextResultHudClaim, type TextResultHudLease } from './workspace/textResultHudOwnership'

const TARGET = { source: 'builtin' as const, pluginId: 'line-tools', surfaceId: 'clean-agent-clipboard' }
const REQUIRED = ['clipboard.write'] as const
const PASTE_REQUIRED = ['clipboard.write', 'accessibility.paste'] as const
const ACTION_EVENT = 'hiven://text-result-hud-action'
type NativeAction = { product: 'translation' | 'qr-scan' | 'clean-agent'; sessionId: string; revision: number; action: 'copy' | 'paste' | 'close' }
const sensitive = (text: string) => detectContent(text).some(({ kind }) => kind === 'secret' || kind === 'secret-like')

function definitionReady() {
  const definition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
  if (!isCurrentBundledDefinition(TARGET.pluginId, TARGET.source, definition)) return null
  const requested = pluginRegistry.getPluginPermissions(TARGET.pluginId, TARGET.source)
  if (!REQUIRED.every((permission) => requested.includes(permission))) return null
  const snapshot = getPluginPermissionSnapshot(TARGET.source, TARGET.pluginId, requested)
  return missingPluginPermissions(snapshot, [...REQUIRED]).length ? null : definition
}
function pasteReady() {
  const definition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
  if (!isCurrentBundledDefinition(TARGET.pluginId, TARGET.source, definition)) return false
  const requested = pluginRegistry.getPluginPermissions(TARGET.pluginId, TARGET.source)
  if (!PASTE_REQUIRED.every((permission) => requested.includes(permission))) return false
  const snapshot = getPluginPermissionSnapshot(TARGET.source, TARGET.pluginId, requested)
  return missingPluginPermissions(snapshot, [...PASTE_REQUIRED]).length === 0
}
function nativeSnapshot(view: CleanAgentHudView) {
  const settings = useAppStore.getState().settings
  const documentTheme = document.documentElement.dataset.theme
  return { ...view, locale: settings.locale === 'zh' ? 'zh' : 'en',
    theme: documentTheme === 'light' || settings.theme === 'light' ? 'light' : 'dark' }
}

let installedStop: (() => void) | null = null
export function installCleanAgentHudHost(): () => void {
  if (installedStop || new URLSearchParams(window.location.search).get('window') !== 'launcher'
    || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return () => {}
  let alive = true
  let release: (() => Promise<void>) | null = null
  let pendingClaim: TextResultHudClaim | null = null
  let hudLease: TextResultHudLease | null = null
  let syncing = false, resyncRequested = false
  const hudOwner = Symbol('clean-agent-hud-owner')
  const session = new CleanAgentHudSession({
    read: (signal, isCurrent) => readNativeClipboardText(() => {
      if (signal.aborted || !isCurrent()) throw new DOMException('Clipboard read cancelled', 'AbortError')
    }),
    clean: (text) => cleanAgentText(text, false),
    isSensitive: sensitive,
    write: (text, isSensitive, signal) => isSensitive
      ? writeClipboardText(text, { sensitive: true, signal })
      : writeTextWithoutHistory(text, signal),
    canPaste: pasteReady,
    paste: (sessionId, revision) => invoke('text_result_hud_paste', { sessionId, revision }).then(() => undefined),
    present: (view, fullText) => invoke<boolean>('text_result_hud_present', { snapshot: nativeSnapshot(view), fullText })
      .then((accepted) => { if (!accepted) throw new Error('Text result HUD rejected the session') }),
    activate: (view) => invoke<number | null>('text_result_hud_activate', { sessionId: view.sessionId, revision: view.revision }),
    dismiss: (sessionId, revision) => invoke('text_result_hud_dismiss', { sessionId, revision }).then(() => undefined),
    now: () => Date.now(), schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clearSchedule: (timer) => clearTimeout(timer), randomId: () => crypto.randomUUID(),
  })
  const releaseCurrent = async () => { const current = release; release = null; if (current) await current().catch(() => undefined) }
  const sync = async () => {
    if (!alive) return
    if (syncing) { resyncRequested = true; return }
    syncing = true
    try {
      await releaseCurrent()
      const key = pluginSurfaceShortcutKey(TARGET)
      const shortcut = usePluginSurfaceShortcutStore.getState().shortcuts[key]
      if (!shortcut?.enabled || !definitionReady()) return
      release = await acquireRegisteredSurfaceShortcutInterceptor(TARGET, async () => {
        const claim = claimTextResultHud(hudOwner, () => session.cancel()); pendingClaim = claim
        const lease = await claim.acquired
        if (pendingClaim === claim) pendingClaim = null
        const latest = usePluginSurfaceShortcutStore.getState().shortcuts[key]
        if (!lease || !alive || !latest?.enabled || latest.registrationStatus !== 'registered' || !definitionReady()) {
          lease?.release(); return true
        }
        hudLease?.release(); hudLease = lease
        await session.trigger(); return true
      }).catch(() => null)
    } finally {
      syncing = false
      if (resyncRequested) { resyncRequested = false; void sync() }
    }
  }
  const invalidate = () => {
    pendingClaim?.cancel(); pendingClaim = null; hudLease?.release(); hudLease = null
    void session.cancel(); void sync()
  }
  const stops = [pluginRegistry.subscribe(invalidate), usePluginPermissionStore.subscribe(invalidate), usePluginSurfaceShortcutStore.subscribe((state, previous) => {
    const key = pluginSurfaceShortcutKey(TARGET)
    if (state.shortcuts[key] !== previous.shortcuts[key]) invalidate()
  })]
  let stopAction = () => {}
  void listen<NativeAction>(ACTION_EVENT, ({ payload }) => {
    if (!alive || payload.product !== 'clean-agent') return
    const expected = { sessionId: payload.sessionId, revision: payload.revision }
    if (payload.action === 'copy') void session.copyAndClose(expected)
    else if (payload.action === 'paste') void session.pasteAndClose(expected)
    else void session.cancelExpected(expected)
  }).then((stop) => { if (alive) stopAction = stop; else stop() }).catch(() => undefined)
  setTimeout(() => { void sync() }, 0)
  const stop = () => {
    if (!alive) return
    alive = false; stopAction(); for (const unsubscribe of stops) unsubscribe()
    pendingClaim?.cancel(); pendingClaim = null; hudLease?.release(); hudLease = null
    void session.cancel(); void releaseCurrent(); installedStop = null
  }
  installedStop = stop
  return stop
}
