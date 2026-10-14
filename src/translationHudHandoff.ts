import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { detectContent } from './kits/content'
import { useAppStore } from './store'
import { acquireRegisteredSurfaceShortcutInterceptor } from './hotkeys/pluginSurfaceShortcuts'
import { HudTranslationSession, type HudTranslationView } from './plugins/translate/hud/session'
import { AiTranslationReadiness } from './plugins/translate/ai/readiness'
import { profileExecutionKey } from './plugins/translate/settings/executionKey'
import { migrateTranslateSettings, DEFAULT_TRANSLATE_SETTINGS, type TranslateProfile, type TranslateSettings } from './plugins/translate/settings/model'
import { resolveSmartTargetLang, translateWithAi } from './plugins/translate/providers/adapters'
import { pluginRegistry } from './workspace/pluginRegistry'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from './workspace/pluginPermissions'
import { resolvePluginSettings, usePluginSettingsStore } from './workspace/pluginSettingsStore'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from './workspace/pluginSurfaceShortcuts'
import { createPluginAi } from './workspace/ai/runtime'
import { readNativeClipboardText, writeTextWithoutHistory } from './workspace/nativeClipboard'
import { claimTextResultHud, releaseTextResultHud } from './workspace/textResultHudOwnership'

const TARGET = { source: 'builtin' as const, pluginId: 'translate', surfaceId: 'main' }
const REQUIRED = ['ai.use', 'globalShortcut.register', 'clipboard.read', 'clipboard.write'] as const
const ACTION_EVENT = 'hiven://text-result-hud-action'

type NativeAction = { product: 'translation' | 'qr-scan'; sessionId: string; revision: number; action: 'copy' | 'close' }

function definitionAndSettings(): { definition: object; settings: TranslateSettings; profile: TranslateProfile } | null {
  const definition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
  const contribution = definition?.settings
  if (!definition || !contribution) return null
  const settings = resolvePluginSettings('builtin', TARGET.pluginId, {
    version: contribution.version,
    defaultValue: DEFAULT_TRANSLATE_SETTINGS,
    migrate: (stored, version) => migrateTranslateSettings(stored, version),
  }).value
  const profile = settings.profiles.find((candidate) => candidate.enabled && candidate.id === settings.defaultProfileId)
  return profile?.provider === 'ai' ? { definition, settings, profile } : null
}

function permissionsReady(): ReturnType<typeof getPluginPermissionSnapshot> | null {
  const requested = pluginRegistry.getPluginPermissions(TARGET.pluginId, 'builtin')
  if (!REQUIRED.every((permission) => requested.includes(permission))) return null
  const snapshot = getPluginPermissionSnapshot('builtin', TARGET.pluginId, requested)
  return missingPluginPermissions(snapshot, [...REQUIRED]).length ? null : snapshot
}

function nativeSnapshot(view: HudTranslationView) {
  const settings = useAppStore.getState().settings
  const locale = settings.locale === 'zh' ? 'zh' : 'en'
  const documentTheme = document.documentElement.dataset.theme
  const theme = documentTheme === 'light' || settings.theme === 'light' ? 'light' : 'dark'
  return { ...view, locale, theme }
}

let installedStop: (() => void) | null = null

/** App-composition adapter for the bundled Translate product. */
export function installTranslationHudHost(): () => void {
  if (installedStop || new URLSearchParams(window.location.search).get('window') !== 'launcher'
    || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return () => {}
  let alive = true
  let release: (() => Promise<void>) | null = null
  let syncing = false
  let resyncRequested = false

  const session = new HudTranslationSession({
    async prepare() {
      const resolved = definitionAndSettings()
      const permissions = permissionsReady()
      if (!resolved || !permissions) return null
      const { definition, profile } = resolved
      const executionKey = profileExecutionKey(profile)
      const ai = createPluginAi(TARGET.pluginId, TARGET.source, permissions)
      const readiness = new AiTranslationReadiness()
      readiness.setAi(ai)
      readiness.setSelection(profile)
      try {
        // Each explicit shortcut is a retry boundary. Recheck metadata so a
        // recovered local provider is not hidden behind the normal cache TTL.
        await readiness.refresh(true)
        if (readiness.getSnapshot().status !== 'ready') return null
        const selection = readiness.execution(ai, profile)
        if (!selection) return null
        return {
          async translate(input, options) {
            const current = definitionAndSettings()
            if (!current || current.definition !== definition || profileExecutionKey(current.profile) !== executionKey || !permissionsReady()) {
              throw new DOMException('Translation configuration changed', 'AbortError')
            }
            const targetLang = profile.defaultTargetLang === 'smart' ? resolveSmartTargetLang(input) : profile.defaultTargetLang
            const result = await translateWithAi({ text: input, sourceLang: profile.defaultSourceLang, targetLang }, profile, ai, {
              signal: options.signal, onText: options.onText, aiSelection: selection,
            })
            return result.text
          },
        }
      } finally {
        readiness.dispose()
      }
    },
    readClipboard: async (signal) => signal.aborted ? '' : readNativeClipboardText(),
    isSensitive: (text) => detectContent(text).some(({ kind }) => kind === 'secret' || kind === 'secret-like'),
    writeClipboard: (text, signal) => writeTextWithoutHistory(text, signal),
    present: (view, fullText) => invoke<boolean>('text_result_hud_present', { snapshot: nativeSnapshot(view), fullText })
      .then((accepted) => { if (!accepted) throw new Error('Text result HUD rejected the session') }),
    activate: (view) => invoke<number | null>('text_result_hud_activate', { sessionId: view.sessionId, revision: view.revision }),
    dismiss: (sessionId, revision) => invoke('text_result_hud_dismiss', { sessionId, revision }).then(() => undefined),
    now: () => Date.now(),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    clearSchedule: (timer) => clearTimeout(timer),
    randomId: () => crypto.randomUUID(),
  })
  const hudOwner = Symbol('translation-hud-owner')

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
      if (!shortcut?.enabled || !definitionAndSettings() || !permissionsReady()) return
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
    usePluginSettingsStore.subscribe(invalidate),
    usePluginSurfaceShortcutStore.subscribe((state, previous) => {
      const key = pluginSurfaceShortcutKey(TARGET)
      if (state.shortcuts[key] !== previous.shortcuts[key]) invalidate()
    }),
  ]
  let stopAction = () => {}
  void listen<NativeAction>(ACTION_EVENT, ({ payload }) => {
    if (!alive || payload.product !== 'translation') return
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
    releaseTextResultHud(hudOwner)
    void releaseCurrent()
    installedStop = null
  }
  installedStop = stop
  return stop
}
