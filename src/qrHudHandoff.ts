import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from './store'
import { acquireRegisteredSurfaceShortcutInterceptor } from './hotkeys/pluginSurfaceShortcuts'
import { decodeQrFromBlob } from './plugins/qr-code/qrCore'
import { QrHudSession, type QrHudView } from './plugins/qr-code/qrHudSession'
import { isSensitiveQrText } from './qrHudSensitivity'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'
import { createPluginClipboardImageReader } from './workspace/pluginClipboardImageRead'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from './workspace/pluginPermissions'
import { pluginRegistry } from './workspace/pluginRegistry'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from './workspace/pluginSurfaceShortcuts'
import { readNativeClipboardText, writeTextWithoutHistory } from './workspace/nativeClipboard'
import { writeClipboardText } from './workspace/pluginClipboard'
import { claimTextResultHud, releaseTextResultHud } from './workspace/textResultHudOwnership'

const TARGET = { source: 'builtin' as const, pluginId: 'qr-code', surfaceId: 'scan' }
const REQUIRED = ['clipboard.read', 'clipboard.image', 'clipboard.write'] as const
const ACTION_EVENT = 'hiven://text-result-hud-action'

type NativeAction = { product: 'translation' | 'qr-scan'; sessionId: string; revision: number; action: 'copy' | 'close' }

function permissionsReady() {
  const definition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
  if (!isCurrentBundledDefinition(TARGET.pluginId, TARGET.source, definition)) return null
  const requested = pluginRegistry.getPluginPermissions(TARGET.pluginId, TARGET.source)
  if (!REQUIRED.every((permission) => requested.includes(permission))) return null
  const snapshot = getPluginPermissionSnapshot(TARGET.source, TARGET.pluginId, requested)
  return missingPluginPermissions(snapshot, [...REQUIRED]).length ? null : { definition, snapshot }
}

function nativeSnapshot(view: QrHudView) {
  const settings = useAppStore.getState().settings
  const locale = settings.locale === 'zh' ? 'zh' : 'en'
  const documentTheme = document.documentElement.dataset.theme
  const theme = documentTheme === 'light' || settings.theme === 'light' ? 'light' : 'dark'
  return { ...view, locale, theme }
}

let installedStop: (() => void) | null = null

/** App composition for the bundled QR Scan shortcut; normal surface opening is unchanged. */
export function installQrHudHost(): () => void {
  if (installedStop || new URLSearchParams(window.location.search).get('window') !== 'launcher'
    || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return () => {}
  let alive = true
  let release: (() => Promise<void>) | null = null
  let syncing = false
  let resyncRequested = false
  const hudOwner = Symbol('qr-hud-owner')

  const session = new QrHudSession({
    async read(signal, isCurrent) {
      const ready = permissionsReady()
      if (!ready || signal.aborted || !isCurrent()) throw new DOMException('QR read unavailable', 'AbortError')
      // Check public text before touching image bytes. On macOS this native read
      // atomically suppresses Concealed/Transient pasteboard content.
      const publicText = await readNativeClipboardText(() => {
        if (signal.aborted || !isCurrent()) throw new DOMException('QR read cancelled', 'AbortError')
      })
      if (signal.aborted || !isCurrent() || isSensitiveQrText(publicText)) {
        throw new DOMException('QR read refused', 'NotAllowedError')
      }
      const reader = createPluginClipboardImageReader(TARGET.pluginId, ready.snapshot, {
        source: TARGET.source,
        isCurrent: () => alive && isCurrent() && permissionsReady()?.definition === ready.definition,
      })
      if (!reader) throw new DOMException('QR read unavailable', 'NotReadableError')
      const image = await reader({ signal })
      if (signal.aborted || !isCurrent()) throw new DOMException('QR read cancelled', 'AbortError')
      return new Blob([image.bytes as BlobPart], { type: image.contentType })
    },
    decode: decodeQrFromBlob,
    isSensitive: isSensitiveQrText,
    write: (text, sensitive, signal) => sensitive
      ? writeClipboardText(text, { sensitive: true, signal })
      : writeTextWithoutHistory(text, signal),
    present: (view, fullText) => invoke<boolean>('text_result_hud_present', { snapshot: nativeSnapshot(view), fullText })
      .then((accepted) => { if (!accepted) throw new Error('Text result HUD rejected the session') }),
    activate: (view) => invoke<number | null>('text_result_hud_activate', { sessionId: view.sessionId, revision: view.revision }),
    dismiss: (sessionId, revision) => invoke('text_result_hud_dismiss', { sessionId, revision }).then(() => undefined),
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clearSchedule: (timer) => clearTimeout(timer),
    randomId: () => crypto.randomUUID(),
  })

  const releaseCurrent = async () => {
    const current = release
    release = null
    if (current) await current().catch(() => undefined)
  }
  const sync = async () => {
    if (!alive) return
    if (syncing) { resyncRequested = true; return }
    syncing = true
    try {
      await releaseCurrent()
      const key = pluginSurfaceShortcutKey(TARGET)
      const shortcut = usePluginSurfaceShortcutStore.getState().shortcuts[key]
      if (!shortcut?.enabled || !permissionsReady()) return
      release = await acquireRegisteredSurfaceShortcutInterceptor(TARGET, async () => {
        await claimTextResultHud(hudOwner, () => session.cancel())
        await session.trigger()
        return true
      }).catch(() => null)
    } finally {
      syncing = false
      if (resyncRequested) { resyncRequested = false; void sync() }
    }
  }
  const invalidate = () => { void session.cancel(); void sync() }
  const stops = [
    pluginRegistry.subscribe(invalidate),
    usePluginPermissionStore.subscribe(invalidate),
    usePluginSurfaceShortcutStore.subscribe((state, previous) => {
      const key = pluginSurfaceShortcutKey(TARGET)
      if (state.shortcuts[key] !== previous.shortcuts[key]) invalidate()
    }),
  ]
  let stopAction = () => {}
  void listen<NativeAction>(ACTION_EVENT, ({ payload }) => {
    if (!alive || payload.product !== 'qr-scan') return
    const expected = { sessionId: payload.sessionId, revision: payload.revision }
    if (payload.action === 'copy') void session.copyAndClose(expected)
    else void session.cancelExpected(expected)
  }).then((stop) => { if (alive) stopAction = stop; else stop() }).catch(() => undefined)
  setTimeout(() => { void sync() }, 0)

  const stop = () => {
    if (!alive) return
    alive = false
    stopAction()
    for (const unsubscribe of stops) unsubscribe()
    void session.cancel()
    void releaseCurrent()
    releaseTextResultHud(hudOwner)
    installedStop = null
  }
  installedStop = stop
  return stop
}
