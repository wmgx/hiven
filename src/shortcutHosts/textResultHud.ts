import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useAppStore } from '../store'
import { acquireRegisteredSurfaceShortcutInterceptor } from '../hotkeys/pluginSurfaceShortcuts'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { isCurrentBundledDefinition } from '../workspace/bundledPluginIdentity'
import { createPluginAi } from '../workspace/ai/runtime'
import { readNativeClipboardText, writeTextWithoutHistory } from '../workspace/nativeClipboard'
import { createPluginClipboardImageReader } from '../workspace/pluginClipboardImageRead'
import { usePluginPermissionStore } from '../workspace/pluginPermissions'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from '../workspace/pluginSurfaceShortcuts'
import type {
  PluginTextResultHudContribution,
  PluginTextResultHudExpected,
  PluginTextResultHudHost,
  PluginTextResultHudRunner,
  PluginTextResultHudView,
} from '../workspace/pluginTypes'
import { claimTextResultHud, type TextResultHudClaim, type TextResultHudLease } from '../workspace/textResultHudOwnership'
import { BUNDLED_SOURCE, grantedPermissions, isLauncherNativeRuntime, listBundledSurfaceTasks, type BundledSurfaceTask } from './bundledSurfaces'

const ACTION_EVENT = 'hiven://text-result-hud-action'
const PRODUCT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

type Contribution = PluginTextResultHudContribution<unknown>
type Task = BundledSurfaceTask<Contribution>
type NativeAction = { product: string; sessionId: string; revision: number; action: 'copy' | 'paste' | 'close' }

function nativeSnapshot(task: Task, view: PluginTextResultHudView) {
  const settings = useAppStore.getState().settings
  const locale = settings.locale === 'zh' ? 'zh' : 'en'
  const documentTheme = document.documentElement.dataset.theme
  const theme = documentTheme === 'light' || settings.theme === 'light' ? 'light' : 'dark'
  const { contribution } = task
  return {
    ...view,
    product: contribution.product,
    labels: contribution.labels(makePluginT(task.pluginId, locale)),
    pasteable: contribution.pasteRequires !== undefined,
    hidePassivePreview: contribution.hidePassivePreview === true,
    locale,
    theme,
  }
}

/** One shortcut-triggered text result product, owned by a bundled plugin and hosted here. */
class TextResultHudEntry {
  private alive = true
  private release: (() => Promise<void>) | null = null
  private pendingClaim: TextResultHudClaim | null = null
  private hudLease: TextResultHudLease | null = null
  private syncing = false
  private resyncRequested = false
  private readonly owner = Symbol('text-result-hud-owner')
  private readonly shortcutKey: string
  private readonly runner: PluginTextResultHudRunner
  private readonly stops: Array<() => void>

  readonly task: Task
  private lastSettingsRecord: unknown

  constructor(task: Task) {
    this.task = task
    this.shortcutKey = pluginSurfaceShortcutKey({ source: BUNDLED_SOURCE, pluginId: task.pluginId, surfaceId: task.surfaceId })
    this.runner = task.contribution.create(this.createHost())
    const settingsRecord = () => usePluginSettingsStore.getState().getPluginSettings(BUNDLED_SOURCE, task.pluginId)
    this.stops = [
      usePluginPermissionStore.subscribe(() => this.invalidate()),
      usePluginSettingsStore.subscribe(() => { if (settingsRecord() !== this.lastSettingsRecord) this.invalidate() }),
      usePluginSurfaceShortcutStore.subscribe((state, previous) => {
        if (state.shortcuts[this.shortcutKey] !== previous.shortcuts[this.shortcutKey]) this.invalidate()
      }),
    ]
    this.lastSettingsRecord = settingsRecord()
    setTimeout(() => { void this.sync() }, 0)
  }

  private isDefinitionCurrent(): boolean {
    const { pluginId, definition } = this.task
    return this.alive && pluginRegistry.getPluginDefinition(pluginId, 'production') === definition
      && isCurrentBundledDefinition(pluginId, BUNDLED_SOURCE, definition)
  }

  private settings(): unknown {
    const { pluginId, definition } = this.task
    return definition.settings ? resolvePluginSettings(BUNDLED_SOURCE, pluginId, definition.settings).value : {}
  }

  private readiness() {
    if (!this.isDefinitionCurrent()) return null
    const snapshot = grantedPermissions(this.task.pluginId, this.task.contribution.permissions)
    if (!snapshot) return null
    if (this.task.contribution.isConfigured && !this.task.contribution.isConfigured(this.settings())) return null
    return snapshot
  }

  private canPaste(): boolean {
    const { pasteRequires, permissions } = this.task.contribution
    return !!pasteRequires && this.isDefinitionCurrent()
      && grantedPermissions(this.task.pluginId, [...permissions, ...pasteRequires]) !== null
  }

  private createHost(): PluginTextResultHudHost<unknown> {
    const { task } = this
    return {
      pluginId: task.pluginId,
      settings: () => this.settings(),
      isCurrent: () => this.readiness() !== null,
      canPaste: () => this.canPaste(),
      createAi: () => {
        const snapshot = this.readiness()
        if (!snapshot) throw new DOMException('Text result HUD is not available', 'AbortError')
        return createPluginAi(task.pluginId, BUNDLED_SOURCE, snapshot)
      },
      readClipboardText: (beforeRead) => readNativeClipboardText(beforeRead),
      writeClipboardText: (text, signal) => writeTextWithoutHistory(text, signal),
      readClipboardImage: async ({ signal, isCurrent }) => {
        const snapshot = this.readiness()
        if (!snapshot || signal.aborted || !isCurrent()) throw new DOMException('Clipboard read unavailable', 'AbortError')
        const definition = task.definition
        const reader = createPluginClipboardImageReader(task.pluginId, snapshot, {
          source: BUNDLED_SOURCE,
          isCurrent: () => this.alive && isCurrent() && this.readiness() !== null && pluginRegistry.getPluginDefinition(task.pluginId, 'production') === definition,
        })
        if (!reader) throw new DOMException('Clipboard read unavailable', 'NotReadableError')
        const image = await reader({ signal })
        if (signal.aborted || !isCurrent()) throw new DOMException('Clipboard read cancelled', 'AbortError')
        return image
      },
      present: (view, fullText) => invoke<boolean>('text_result_hud_present', { snapshot: nativeSnapshot(task, view), fullText })
        .then((accepted) => { if (!accepted) throw new Error('Text result HUD rejected the session') }),
      activate: (view) => invoke<number | null>('text_result_hud_activate', { sessionId: view.sessionId, revision: view.revision }),
      dismiss: (sessionId, revision) => invoke('text_result_hud_dismiss', { sessionId, revision }).then(() => undefined),
      paste: (sessionId, revision) => invoke('text_result_hud_paste', { sessionId, revision }).then(() => undefined),
    }
  }

  private async releaseCurrent() {
    const current = this.release
    this.release = null
    if (current) await current().catch(() => undefined)
  }

  private async sync(): Promise<void> {
    if (!this.alive) return
    if (this.syncing) { this.resyncRequested = true; return }
    this.syncing = true
    try {
      await this.releaseCurrent()
      const shortcut = usePluginSurfaceShortcutStore.getState().shortcuts[this.shortcutKey]
      if (!shortcut?.enabled || !this.readiness()) return
      const target = { source: BUNDLED_SOURCE, pluginId: this.task.pluginId, surfaceId: this.task.surfaceId }
      this.release = await acquireRegisteredSurfaceShortcutInterceptor(target, async () => {
        const claim = claimTextResultHud(this.owner, () => this.runner.cancel().then(() => undefined))
        this.pendingClaim = claim
        const lease = await claim.acquired
        if (this.pendingClaim === claim) this.pendingClaim = null
        const latest = usePluginSurfaceShortcutStore.getState().shortcuts[this.shortcutKey]
        if (!lease || !this.alive || !latest?.enabled || latest.registrationStatus !== 'registered' || !this.readiness()) {
          lease?.release()
          return true
        }
        this.hudLease?.release()
        this.hudLease = lease
        await this.runner.trigger()
        return true
      }).catch(() => null)
    } finally {
      this.syncing = false
      if (this.resyncRequested) { this.resyncRequested = false; void this.sync() }
    }
  }

  private invalidate() {
    if (!this.alive) return
    this.lastSettingsRecord = usePluginSettingsStore.getState().getPluginSettings(BUNDLED_SOURCE, this.task.pluginId)
    this.pendingClaim?.cancel()
    this.pendingClaim = null
    this.hudLease?.release()
    this.hudLease = null
    void this.runner.cancel()
    void this.sync()
  }

  handleAction(payload: NativeAction) {
    if (!this.alive) return
    const expected: PluginTextResultHudExpected = { sessionId: payload.sessionId, revision: payload.revision }
    if (payload.action === 'copy') void this.runner.copyAndClose(expected)
    else if (payload.action === 'paste') void this.runner.pasteAndClose?.(expected)
    else void this.runner.cancelExpected(expected)
  }

  dispose() {
    if (!this.alive) return
    this.alive = false
    for (const unsubscribe of this.stops) unsubscribe()
    this.pendingClaim?.cancel()
    this.pendingClaim = null
    this.hudLease?.release()
    this.hudLease = null
    void this.runner.cancel()
    void this.releaseCurrent()
  }
}

let installedStop: (() => void) | null = null

/**
 * App composition for plugin-declared "shortcut -> text result -> native HUD" products.
 * Plugins own the session logic; this host owns shortcut interception, HUD ownership,
 * permission/registration lifetime and the native HUD transport.
 */
export function installTextResultHudHosts(): () => void {
  if (installedStop || !isLauncherNativeRuntime()) return () => {}
  let alive = true
  const entries = new Map<string, TextResultHudEntry>()

  const reconcile = () => {
    if (!alive) return
    const tasks = new Map(listBundledSurfaceTasks<Contribution>((surface) => surface.textResultHud)
      .filter((task) => PRODUCT_PATTERN.test(task.contribution.product))
      .map((task) => [`${task.pluginId}:${task.surfaceId}`, task]))
    for (const [key, entry] of entries) {
      const next = tasks.get(key)
      if (next?.definition === entry.task.definition) continue
      entry.dispose()
      entries.delete(key)
    }
    for (const [key, task] of tasks) {
      if (!entries.has(key)) entries.set(key, new TextResultHudEntry(task))
    }
  }

  const stopRegistry = pluginRegistry.subscribe(reconcile)
  let stopAction = () => {}
  void listen<NativeAction>(ACTION_EVENT, ({ payload }) => {
    if (!alive) return
    for (const entry of entries.values()) {
      if (entry.task.contribution.product === payload.product) entry.handleAction(payload)
    }
  }).then((stop) => { if (alive) stopAction = stop; else stop() }).catch(() => undefined)
  reconcile()

  const stop = () => {
    if (!alive) return
    alive = false
    stopAction()
    stopRegistry()
    for (const entry of entries.values()) entry.dispose()
    entries.clear()
    installedStop = null
  }
  installedStop = stop
  return stop
}
