/**
 * Launcher Controller
 *
 * Framework-agnostic state machine driving launcher hosts such as EditorCommandBar and GlobalLauncher.
 * The UI renders `controller.state` and calls intents (selectItem, submitInput,
 * activateChoice, back). The controller owns:
 *   - first-level selection
 *   - collect-input flow (two-step items)
 *   - result-choice stack (multi-level output)
 *   - usage recording after a successful first-level commit
 *   - Enter (single-result) and Escape (back) semantics
 *
 * Usage rules (design doc §4):
 *   - perform / collect-input → record only after execution succeeds
 *   - dynamic items  → record only when item.recordUsage === true (stable ids)
 *   - select options recordUsage:false → caller can suppress for ephemeral selections
 */

import type {
  CommittedRunContext,
  CommitVia,
  InputBinding,
  LauncherExecuteResult,
  LauncherInputSpec,
  LauncherItem,
  LauncherOutput,
  LauncherParamSpec,
  LauncherResultAction,
  LauncherResultChoice,
  LauncherSurfaceId,
  MiningRunSnapshot,
  PluginLauncherApi,
} from './types'
import type { PluginNetworkApi, PluginPrivateStorageApi, PluginShellApi } from '../pluginTypes'
import type { PluginAiApi } from '../ai/types'
import { appendUsageJournal } from '../usageJournal'
import { getHostOutputIntent, isOutputResult } from './output'
import { translate, type Locale } from '../../i18n'
import {
  TelemetryEvents,
  itemTelemetryProps,
  trackBehavior,
  trackLatencyFrom,
  telemetryNow,
} from '../telemetry'
import {
  appendExperienceEvent,
  currentExperienceSessionId,
  newExperienceId,
} from '../experience/journal'
import { classifyExperienceError } from '../experience/errorType'
import type { ExperienceErrorType, ExperienceEvent, ExperienceRunStatus } from '../experience/types'
import { isSafeExperienceIdentifier } from '../contentBoundary'
import { extractSaveableParams } from '../experience/saveableParams'
import { createMiningFingerprints } from '../experience/miningFingerprint'
import { setLastSaveableRun } from '../savedActions/lastSaveableRun'
import { touchSavedAction } from '../savedActions/store'

// ─── Frames ──────────────────────────────────────────────────────────────────

export type ListFrame = {
  kind: 'list'
}

export type CollectInputFrame = {
  kind: 'collect-input'
  item: LauncherItem
  inputText: string
  input: LauncherInputSpec
  params?: Record<string, unknown>
  recordUsage: boolean
  previewOutput?: LauncherOutput
  previewInputText?: string
  /**
   * Index into previewOutput.choices for keyboard highlight.
   * -1 = no highlight (Enter uses typed inputText).
   */
  selectedSuggestionIndex: number
}

export type ParamInputFrame = {
  kind: 'param-input'
  item: LauncherItem
  params: Record<string, unknown>
  paramIndex: number
  query: string
  selectedIndex: number
  /** Carried from selectItem options; used to skip collect-input after params. */
  objectBlockText?: string
  recordUsage: boolean
}

export type ResultFrame = {
  kind: 'result'
  output: LauncherOutput
  /** The item or choice that produced this output (for labeling). */
  sourceTitle?: string
  committedRun?: CommittedRunContext
  /** Delay usage until the user commits one successful output action. */
  pendingUsage?: { item: LauncherItem; recordUsage: boolean }
}

export type LauncherFrame = ListFrame | CollectInputFrame | ParamInputFrame | ResultFrame

// ─── State ─────────────────────────────────────────────────────────────────

export type LauncherControllerState = {
  surfaceId: LauncherSurfaceId
  /** Frame stack; the top frame is the active one. Always has a list base. */
  frames: LauncherFrame[]
  /** Last error message to display (cleared on next transition). */
  error: string | null
  busy: boolean
}

export type LauncherControllerDeps = {
  surfaceId: LauncherSurfaceId
  api: PluginLauncherApi
  makeApi?: (item: LauncherItem) => PluginLauncherApi
  getStorage?: (item: LauncherItem) => PluginPrivateStorageApi
  getNetwork?: (item: LauncherItem) => PluginNetworkApi
  getShell?: (item: LauncherItem) => PluginShellApi
  getAi?: (item: LauncherItem) => PluginAiApi
  locale: string
  /** Translate function scoped to the item's plugin. */
  makeT: (item: LauncherItem) => (key: string, vars?: Record<string, string | number>) => string
  /** Resolve current settings for an item's plugin (real source). */
  getSettings: (item: LauncherItem) => unknown
  /** Record a first-level selection in launcher usage. */
  recordSelection: (surfaceId: LauncherSurfaceId, item: LauncherItem) => void
  /** Notify the host that the launcher should close (success, no output). */
  requestClose: () => void
  /** Notify subscribers of a state change. */
  onChange: (state: LauncherControllerState) => void
  /** Test/alternate sink injection; production defaults to the native journal. */
  appendExperienceEvent?: (event: ExperienceEvent) => void
}

const emptyStorage: PluginPrivateStorageApi = {
  kv: {
    get: async () => undefined,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  },
  blob: {
    put: async () => {
      throw new Error('Plugin storage is not available for this launcher item')
    },
    get: async () => undefined,
    delete: async () => {},
    url: async () => '',
  },
  quota: {
    usage: async () => ({ bytes: 0, itemCount: 0 }),
    prune: async () => ({ removedBytes: 0, removedItems: 0 }),
  },
}

const emptyNetwork: PluginNetworkApi = {
  request: async () => {
    throw new Error('Plugin network is not available for this launcher item')
  },
}

const emptyShell: PluginShellApi = {
  run: async () => {
    throw new Error('Plugin shell is not available for this launcher item')
  },
}

const emptyAi: PluginAiApi = {
  providers: async () => [],
  stream: async function* () {
    throw new Error('AI is not available for this launcher item')
  },
  cancel: async () => {},
  usage: async () => [],
}

export type SelectOptions = {
  /** When false, usage is not recorded for this selection. */
  recordUsage?: boolean
  /** Enter a system-owned parameter form instead of running default params. */
  customizeParams?: boolean
  /** Pre-existing text from Object Block; when provided, skip collect-input and use directly. */
  objectBlockText?: string
}

// ─── Controller ───────────────────────────────────────────────────────────

export class LauncherController {
  private readonly experienceRunQueues = new WeakMap<CommittedRunContext, Promise<void>>()
  private state: LauncherControllerState
  private deps: LauncherControllerDeps
  private previewRunId = 0
  private suggestRunId = 0
  /** Debounce timer for suggest refresh (kill process filter, history, …). */
  private suggestDebounceTimer: ReturnType<typeof setTimeout> | null = null
  /** Last journaled command id (for prev_command_id chain). */
  private lastJournalCommandId: string | null = null
  private fallbackSessionId = newExperienceId('session')

  constructor(deps: LauncherControllerDeps) {
    this.deps = deps
    this.state = {
      surfaceId: deps.surfaceId,
      frames: [{ kind: 'list' }],
      error: null,
      busy: false,
    }
  }

  getState(): LauncherControllerState {
    return this.state
  }

  private setState(patch: Partial<LauncherControllerState>): void {
    this.state = { ...this.state, ...patch }
    this.deps.onChange(this.state)
  }

  private topFrame(): LauncherFrame {
    return this.state.frames[this.state.frames.length - 1]
  }

  /** Reset to the base list frame (e.g. when the launcher opens). */
  reset(): void {
    if (this.suggestDebounceTimer != null) {
      clearTimeout(this.suggestDebounceTimer)
      this.suggestDebounceTimer = null
    }
    this.fallbackSessionId = newExperienceId('session')
    this.setState({ frames: [{ kind: 'list' }], error: null, busy: false })
  }

  /**
   * Build the execution context for an item, given optional collected input.
   */
  private buildExecutionContext(item: LauncherItem, inputText?: string) {
    return {
      surfaceId: this.deps.surfaceId,
      input: inputText !== undefined ? { text: inputText } : undefined,
      settings: this.deps.getSettings(item),
      locale: this.deps.locale as never,
      api: this.deps.makeApi?.(item) ?? this.deps.api,
      storage: this.deps.getStorage?.(item) ?? emptyStorage,
      ai: this.deps.getAi?.(item) ?? emptyAi,
      t: this.deps.makeT(item),
    }
  }

  private shouldRecord(item: LauncherItem, options: SelectOptions): boolean {
    if (options.recordUsage === false) return false
    if (item.recordUsage === false) return false
    // Dynamic items default off; stable actions opt in via recordUsage: true.
    if (item.kind === 'dynamic') return item.recordUsage === true
    return true
  }

  /** Record a successfully committed selection + fire-and-forget journal row. */
  recordSuccessfulSelection(item: LauncherItem, options: SelectOptions = {}): void {
    if (!this.shouldRecord(item, options)) return
    this.deps.recordSelection(this.deps.surfaceId, item)
    void appendUsageJournal({
      commandId: item.systemKey,
      surfaceId: this.deps.surfaceId,
      executedAt: Date.now(),
      prevCommandId: this.lastJournalCommandId ?? null,
    }).catch(() => {})
    this.lastJournalCommandId = item.systemKey
  }

  private defaultParamsFor(item: LauncherItem): Record<string, unknown> {
    const params: Record<string, unknown> = { ...(item.defaultParams ?? {}) }
    for (const param of item.params ?? []) {
      if (params[param.key] === undefined && param.default !== undefined) {
        params[param.key] = param.default
      }
    }
    return params
  }

  private inputBindingFor(item: LauncherItem): InputBinding | undefined {
    const mode = item.inputPolicy?.mode
    if (!mode) return undefined
    const api = this.deps.makeApi?.(item) ?? this.deps.api
    if (mode === 'selection') return api.getSelectionText() ? 'selection' : undefined
    if (mode === 'all') return api.getActiveText() ? 'active-text' : undefined
    if (api.getSelectionText()) return 'selection'
    return api.getActiveText() ? 'active-text' : undefined
  }

  private paramOptions(param: LauncherParamSpec): unknown[] {
    if (param.type === 'boolean') return [true, false]
    return (param.options ?? []).map((option) => typeof option === 'string' ? option : option.value)
  }

  private selectedIndexFor(param: LauncherParamSpec | undefined, params: Record<string, unknown>): number {
    if (!param) return 0
    if (param.type === 'multi-select') return 0
    const value = params[param.key]
    const index = this.paramOptions(param).findIndex((option) => option === value)
    return index >= 0 ? index : 0
  }

  private queryFor(param: LauncherParamSpec | undefined, params: Record<string, unknown>): string {
    if (!param || (param.type !== 'text' && param.type !== 'number')) return ''
    const value = params[param.key]
    return value === undefined || value === null ? '' : String(value)
  }

  private paramFrameFor(
    item: LauncherItem,
    params = this.defaultParamsFor(item),
    paramIndex = 0,
    objectBlockText?: string,
    recordUsage = this.shouldRecord(item, {}),
  ): ParamInputFrame {
    const param = item.params?.[paramIndex]
    return {
      kind: 'param-input',
      item,
      params,
      paramIndex,
      query: this.queryFor(param, params),
      selectedIndex: this.selectedIndexFor(param, params),
      objectBlockText,
      recordUsage,
    }
  }

  private hasCustomizableParams(item: LauncherItem): boolean {
    return Boolean(item.executeWithParams && item.params && item.params.length > 0)
  }

  private shouldCollectTextInput(item: LauncherItem): boolean {
    const mode = item.inputPolicy?.mode ?? 'auto'
    const api = this.deps.makeApi?.(item) ?? this.deps.api
    const hasBoundSelection = (mode === 'auto' || mode === 'selection') && Boolean(api.getSelectionText())
    return this.deps.surfaceId === 'global-launcher' &&
      item.behavior.type === 'perform' &&
      item.inputPolicy != null &&
      !hasBoundSelection
  }

  private hasObjectBlockText(text: string | undefined): text is string {
    return text !== undefined
  }

  private shouldPreviewInput(frame: CollectInputFrame): boolean {
    return this.shouldCollectTextInput(frame.item)
  }

  private collectInputFrameFor(
    item: LauncherItem,
    params?: Record<string, unknown>,
    recordUsage = this.shouldRecord(item, {}),
  ): CollectInputFrame {
    const input = item.behavior.type === 'collect-input'
      ? item.behavior.input
      : {
          placeholder: translate(this.deps.locale as Locale, 'palette', 'quickTextPlaceholder', { title: this.itemTitle(item) }),
          emptyInputMessage: translate(this.deps.locale as Locale, 'palette', 'inputRequired'),
        }
    return {
      kind: 'collect-input',
      item,
      inputText: '',
      input,
      params,
      recordUsage,
      selectedSuggestionIndex: -1,
    }
  }

  /**
   * Select a first-level launcher item.
   * Usage is recorded only when the resulting commit succeeds.
   */
  async selectItem(item: LauncherItem, options: SelectOptions = {}): Promise<void> {
    this.setState({ error: null })
    if (item.disabledReason) {
      this.setState({
        error: item.disabledReason.messageI18n?.[this.deps.locale as Locale] ?? item.disabledReason.message,
      })
      return
    }
    trackBehavior(TelemetryEvents.launcherItemSelect, {
      ...itemTelemetryProps(item),
      surfaceId: this.state.surfaceId,
      customizeParams: Boolean(options.customizeParams),
      hasObjectBlock: this.hasObjectBlockText(options.objectBlockText),
    })
    const recordUsage = this.shouldRecord(item, options)

    if (options.customizeParams && this.hasCustomizableParams(item)) {
      trackBehavior(TelemetryEvents.launcherEnterParamInput, itemTelemetryProps(item))
      this.setState({
        frames: [...this.state.frames, this.paramFrameFor(item, undefined, 0, options.objectBlockText, recordUsage)],
      })
      return
    }

    if (item.behavior.type === 'collect-input') {
      if (this.hasObjectBlockText(options.objectBlockText)) {
        await this.commitResolvedAction({
          item,
          via: item.commitVia ?? 'execute',
          params: this.defaultParamsFor(item),
          inputBinding: 'prompt',
          inputText: options.objectBlockText,
          sourceTitle: this.itemTitle(item),
          recordUsage,
          execute: () => Promise.resolve(item.execute(this.buildExecutionContext(item, options.objectBlockText))),
        })
        return
      }
      trackBehavior(TelemetryEvents.launcherEnterCollectInput, itemTelemetryProps(item))
      this.setState({
        frames: [...this.state.frames, this.collectInputFrameFor(item, undefined, recordUsage)],
      })
      if (item.suggest) void this.refreshSuggestions()
      return
    }

    if (this.shouldCollectTextInput(item)) {
      // If Object Block text is available, skip collect-input and execute directly.
      if (this.hasObjectBlockText(options.objectBlockText)) {
        await this.commitResolvedAction({
          item,
          via: item.commitVia ?? 'execute',
          params: this.defaultParamsFor(item),
          inputBinding: 'prompt',
          inputText: options.objectBlockText,
          sourceTitle: this.itemTitle(item),
          recordUsage,
          execute: () => Promise.resolve(item.execute(this.buildExecutionContext(item, options.objectBlockText))),
        })
        return
      }
      trackBehavior(TelemetryEvents.launcherEnterCollectInput, itemTelemetryProps(item))
      this.setState({
        frames: [...this.state.frames, this.collectInputFrameFor(item, undefined, recordUsage)],
      })
      if (item.suggest) void this.refreshSuggestions()
      return
    }

    await this.commitResolvedAction({
      item,
      via: item.commitVia ?? 'execute',
      params: this.defaultParamsFor(item),
      inputBinding: this.inputBindingFor(item),
      sourceTitle: this.itemTitle(item),
      recordUsage,
      execute: () => Promise.resolve(item.execute(this.buildExecutionContext(item))),
    })
  }

  setParamQuery(query: string): void {
    const top = this.topFrame()
    if (top.kind !== 'param-input') return
    const frames = this.state.frames.slice(0, -1)
    frames.push({ ...top, query, selectedIndex: 0 })
    this.setState({ frames })
  }

  setParamSelectedIndex(selectedIndex: number): void {
    const top = this.topFrame()
    if (top.kind !== 'param-input') return
    const frames = this.state.frames.slice(0, -1)
    frames.push({ ...top, selectedIndex: Math.max(0, selectedIndex) })
    this.setState({ frames })
  }

  toggleCurrentMultiParamValue(value: unknown): void {
    const top = this.topFrame()
    if (top.kind !== 'param-input') return
    const param = this.currentParam(top)
    if (!param || param.type !== 'multi-select') return
    const currentValue = top.params[param.key]
    const current = Array.isArray(currentValue) ? [...currentValue] : []
    const valueKey = String(value)
    const existingIndex = current.findIndex((item) => String(item) === valueKey)
    const max = param.maxSelect ?? Number.POSITIVE_INFINITY
    let next: unknown[]
    if (existingIndex >= 0) {
      next = current.filter((_, index) => index !== existingIndex)
    } else {
      if (current.length >= max) return
      next = [...current, value]
    }
    const frames = this.state.frames.slice(0, -1)
    frames.push({
      ...top,
      params: {
        ...top.params,
        [param.key]: next,
      },
    })
    this.setState({ frames, error: null })
  }

  private currentParam(frame: ParamInputFrame): LauncherParamSpec | undefined {
    return frame.item.params?.[frame.paramIndex]
  }

  private normalizeParamValue(param: LauncherParamSpec, value: unknown): unknown {
    if (param.type === 'number') {
      if (value === '' || value === undefined || value === null) return undefined
      const numberValue = Number(value)
      return Number.isFinite(numberValue) ? numberValue : value
    }
    return value
  }

  private validateParam(param: LauncherParamSpec, params: Record<string, unknown>): string | null {
    const value = params[param.key]
    if (param.type === 'multi-select' && Array.isArray(value)) {
      const min = param.minSelect ?? (param.required ? 1 : 0)
      if (value.length < min) return translate(this.deps.locale as Locale, 'palette', 'fieldRequiredWithLabel', { label: param.label })
    }
    if (!param.required) return null
    if (value === undefined || value === null || value === '') return translate(this.deps.locale as Locale, 'palette', 'fieldRequiredWithLabel', { label: param.label })
    if (Array.isArray(value) && value.length === 0) return translate(this.deps.locale as Locale, 'palette', 'fieldRequiredWithLabel', { label: param.label })
    return null
  }

  private validateParams(item: LauncherItem, params: Record<string, unknown>): string | null {
    for (const param of item.params ?? []) {
      const error = this.validateParam(param, params)
      if (error) return error
    }
    return null
  }

  async commitCurrentParam(value: unknown): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'param-input') return
    const param = this.currentParam(top)
    if (!param) {
      await this.submitParams()
      return
    }

    const params = param.type === 'multi-select' && value === undefined
      ? top.params
      : {
          ...top.params,
          [param.key]: this.normalizeParamValue(param, value),
        }
    const error = this.validateParam(param, params)
    if (error) {
      this.setState({ error })
      return
    }

    const nextIndex = top.paramIndex + 1
    if (nextIndex < (top.item.params?.length ?? 0)) {
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.paramFrameFor(top.item, params, nextIndex, top.objectBlockText, top.recordUsage))
      this.setState({ frames, error: null })
      return
    }

    const frames = this.state.frames.slice(0, -1)
    frames.push(this.paramFrameFor(top.item, params, top.paramIndex, undefined, top.recordUsage))
    this.setState({ frames, error: null })
    await this.submitParams()
  }

  /** Submit the active parameter input frame. */
  async submitParams(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'param-input' || !top.item.executeWithParams) return

    const error = this.validateParams(top.item, top.params)
    if (error) {
      this.setState({ error })
      return
    }

    if (this.shouldCollectTextInput(top.item)) {
      // If Object Block text is available, skip collect-input and execute directly with params.
      if (this.hasObjectBlockText(top.objectBlockText)) {
        await this.commitResolvedAction({
          item: top.item,
          via: top.item.commitVia ?? 'execute',
          params: top.params,
          inputBinding: 'prompt',
          inputText: top.objectBlockText,
          sourceTitle: this.itemTitle(top.item),
          recordUsage: top.recordUsage,
          execute: () => Promise.resolve(top.item.executeWithParams?.(this.buildExecutionContext(top.item, top.objectBlockText), top.params) ?? top.item.execute(this.buildExecutionContext(top.item, top.objectBlockText))),
        })
        return
      }
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.collectInputFrameFor(top.item, top.params, top.recordUsage))
      this.setState({ frames, error: null })
      return
    }

    await this.commitResolvedAction({
      item: top.item,
      via: top.item.commitVia ?? 'execute',
      params: top.params,
      inputBinding: this.inputBindingFor(top.item),
      sourceTitle: this.itemTitle(top.item),
      recordUsage: top.recordUsage,
      execute: () => Promise.resolve(top.item.executeWithParams?.(this.buildExecutionContext(top.item), top.params) ?? top.item.execute(this.buildExecutionContext(top.item))),
    })
  }

  /** Update the text in the active collect-input frame. */
  setInputText(text: string): void {
    const top = this.topFrame()
    if (top.kind !== 'collect-input') return
    const frames = this.state.frames.slice(0, -1)
    if (top.item.suggest) {
      frames.push({ ...top, inputText: text })
    } else if (!text.trim()) {
      // Empty input → true empty well (clear last preview).
      frames.push({
        ...top,
        inputText: text,
        previewOutput: undefined,
        previewInputText: undefined,
        selectedSuggestionIndex: -1,
      })
    } else {
      // Keep last preview while typing so UI does not flash empty ↔ result every keystroke.
      // previewInputText stays until previewInput() refreshes for the new text (stale until then).
      frames.push({
        ...top,
        inputText: text,
        selectedSuggestionIndex: -1,
      })
    }
    this.setState({ frames, error: null })
    if (top.item.suggest) this.scheduleRefreshSuggestions()
  }

  /** Debounce suggest reloads so typing does not thrash state/busy every keystroke. */
  private scheduleRefreshSuggestions(): void {
    if (this.suggestDebounceTimer != null) {
      clearTimeout(this.suggestDebounceTimer)
    }
    this.suggestDebounceTimer = setTimeout(() => {
      this.suggestDebounceTimer = null
      void this.refreshSuggestions()
    }, 60)
  }

  /**
   * Move suggestion highlight for collect-input.
   * -1 = no highlight. Arrow up from first item clears highlight (does not wrap).
   * Arrow down from last item stays on last.
   */
  moveSuggestionHighlight(delta: number): void {
    const top = this.topFrame()
    if (top.kind !== 'collect-input') return
    const choices = top.previewOutput?.choices ?? []
    if (choices.length === 0) return

    let next = top.selectedSuggestionIndex
    if (next < 0) {
      next = delta > 0 ? 0 : -1
    } else {
      next = next + delta
      if (next < -1) next = -1
      if (next >= choices.length) next = choices.length - 1
    }

    if (next === top.selectedSuggestionIndex) return
    const frames = this.state.frames.slice(0, -1)
    frames.push({ ...top, selectedSuggestionIndex: next })
    this.setState({ frames })
  }

  /** Load / refresh collect-input suggestions from item.suggest. */
  async refreshSuggestions(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'collect-input' || !top.item.suggest) return

    const { item, inputText } = top
    const previousId =
      top.selectedSuggestionIndex >= 0
        ? top.previewOutput?.choices[top.selectedSuggestionIndex]?.id
        : undefined

    const runId = ++this.suggestRunId
    // Busy only on first load (no choices yet). Subsequent filter updates use the
    // cached snapshot and must not flicker busy / reflow the whole collect frame.
    const hasExistingChoices = (top.previewOutput?.choices?.length ?? 0) > 0
    const shouldToggleBusy = !this.state.busy && !hasExistingChoices
    if (shouldToggleBusy) this.setState({ busy: true, error: null })
    let output: LauncherOutput | null | undefined
    try {
      output = await Promise.resolve(
        item.suggest!({
          surfaceId: this.deps.surfaceId,
          inputText,
          settings: this.deps.getSettings(item),
          locale: this.deps.locale as never,
          api: this.deps.makeApi?.(item) ?? this.deps.api,
          storage: this.deps.getStorage?.(item) ?? emptyStorage,
          network: this.deps.getNetwork?.(item) ?? emptyNetwork,
          shell: this.deps.getShell?.(item) ?? emptyShell,
          ai: this.deps.getAi?.(item) ?? emptyAi,
          t: this.deps.makeT(item),
          pluginId: item.pluginId,
          source: item.source,
        }),
      )
    } catch {
      if (runId !== this.suggestRunId) return
      this.clearCollectInputPreview(top)
      if (shouldToggleBusy) this.setState({ busy: false })
      return
    }

    if (runId !== this.suggestRunId) return
    const latestTop = this.topFrame()
    if (
      latestTop.kind !== 'collect-input' ||
      latestTop.item.systemKey !== item.systemKey ||
      latestTop.inputText !== inputText
    ) {
      if (shouldToggleBusy) this.setState({ busy: false })
      return
    }

    const choices = output?.choices ?? []
    let selectedSuggestionIndex = -1
    if (previousId) {
      const idx = choices.findIndex((choice) => choice.id === previousId)
      if (idx >= 0) selectedSuggestionIndex = idx
    }

    const frames = this.state.frames.slice(0, -1)
    frames.push({
      ...latestTop,
      previewOutput: choices.length > 0 ? { choices } : undefined,
      previewInputText: inputText,
      selectedSuggestionIndex,
    })
    this.setState({ frames, error: null, busy: shouldToggleBusy ? false : this.state.busy })
  }

  async previewInput(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'collect-input' || !this.shouldPreviewInput(top)) return
    // Suggest path owns empty/partial lists for collect-input items with suggest.
    if (top.item.suggest) return

    const { item, inputText } = top
    if (!inputText.trim() && !top.input.allowEmptyInput) {
      this.clearCollectInputPreview(top)
      return
    }

    const runId = ++this.previewRunId
    // Package 4: pure-function live preview must not flash busy (reflow jank).
    this.setState({ error: null })

    let result: LauncherExecuteResult
    try {
      result = await Promise.resolve(
        top.params && item.executeWithParams
          ? item.executeWithParams(this.buildExecutionContext(item, inputText), top.params)
          : item.execute(this.buildExecutionContext(item, inputText)),
      )
    } catch (error) {
      if (runId !== this.previewRunId) return
      this.setState({ error: error instanceof Error ? error.message : String(error) })
      return
    }

    if (runId !== this.previewRunId) return
    const latestTop = this.topFrame()
    if (latestTop.kind !== 'collect-input' || latestTop.item.systemKey !== item.systemKey || latestTop.inputText !== inputText) {
      return
    }

    if (!result.ok) {
      // Keep last good preview while typing; only surface the error.
      // Clearing here collapses the well and makes the native window thrash.
      this.setState({ busy: false, error: result.message })
      return
    }
    if (!isOutputResult(result)) {
      // No output payload — keep previous preview, do not clear.
      this.setState({ busy: false, error: null })
      return
    }

    const frames = this.state.frames.slice(0, -1)
    frames.push({
      ...latestTop,
      previewOutput: result.output,
      previewInputText: inputText,
      selectedSuggestionIndex: -1,
    })
    this.setState({ frames, error: null })
  }

  private clearCollectInputPreview(frame: CollectInputFrame, error: string | null = null): void {
    const top = this.topFrame()
    if (top.kind !== 'collect-input' || top.item.systemKey !== frame.item.systemKey) {
      this.setState({ busy: false, error })
      return
    }
    // Only clear when input is empty. Non-empty keeps last result (replace-on-success only).
    if (top.inputText.trim()) {
      this.setState({ busy: false, error })
      return
    }
    const frames = this.state.frames.slice(0, -1)
    frames.push({
      ...top,
      previewOutput: undefined,
      previewInputText: undefined,
      selectedSuggestionIndex: -1,
    })
    this.setState({ frames, busy: false, error })
  }

  /**
   * Submit the active collect-input frame. Executes exactly once; the UI must
   * ensure a single Enter owner (no double submit, IME-safe).
   */
  async submitInput(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'collect-input') return
    const { item, inputText } = top
    trackBehavior(TelemetryEvents.launcherSubmitInput, {
      ...itemTelemetryProps(item),
      inputLength: inputText.length,
      suggestionIndex: top.selectedSuggestionIndex,
    })

    // Highlighted suggestion wins (including empty input + history highlight).
    if (top.selectedSuggestionIndex >= 0) {
      const highlighted = top.previewOutput?.choices[top.selectedSuggestionIndex]
      if (highlighted) {
        await this.commitResolvedAction({
          item,
          via: 'suggestion',
          params: top.params ?? this.defaultParamsFor(item),
          inputBinding: 'prompt',
          inputText,
          sourceTitle: highlighted.title,
          recordUsage: top.recordUsage,
          resolvedChoice: highlighted,
        })
        return
      }
    }

    const spec = item.behavior.type === 'collect-input' ? item.behavior.input : undefined
    const inputSpec = top.input ?? spec
    if (!inputText.trim() && !inputSpec?.allowEmptyInput) {
      this.setState({ error: inputSpec?.emptyInputMessage ?? translate(this.deps.locale as Locale, 'palette', 'inputRequired') })
      return
    }

    // Legacy perform+inputPolicy preview: first choice when preview matches input.
    const firstPreviewChoice = top.previewInputText === inputText
      ? top.previewOutput?.choices[0]
      : undefined
    if (firstPreviewChoice && this.shouldPreviewInput(top) && !item.suggest) {
      await this.commitResolvedAction({
        item,
        via: 'preview-choice',
        params: top.params ?? this.defaultParamsFor(item),
        inputBinding: 'prompt',
        inputText,
        sourceTitle: firstPreviewChoice.title,
        recordUsage: top.recordUsage,
        resolvedChoice: firstPreviewChoice,
      })
      return
    }

    await this.commitResolvedAction({
      item,
      via: item.commitVia ?? 'execute',
      params: top.params ?? this.defaultParamsFor(item),
      inputBinding: 'prompt',
      inputText,
      sourceTitle: this.itemTitle(item),
      recordUsage: top.recordUsage,
      execute: () => Promise.resolve(
        top.params && item.executeWithParams
          ? item.executeWithParams(this.buildExecutionContext(item, inputText), top.params)
          : item.execute(this.buildExecutionContext(item, inputText)),
      ),
    })
  }

  /** Activate a result choice's primary action. */
  async activateChoice(choice: LauncherResultChoice): Promise<void> {
    trackBehavior(TelemetryEvents.launcherChoiceActivate, {
      via: 'primary',
    })
    const top = this.topFrame()
    const committedRun = top.kind === 'result' ? top.committedRun : undefined
    const pendingUsage = top.kind === 'result'
      ? top.pendingUsage
      : top.kind === 'collect-input'
        ? { item: top.item, recordUsage: top.recordUsage }
        : undefined
    await this.runChoiceAction(() => choice.primaryAction(), choice.title, undefined, committedRun, choice, pendingUsage)
  }

  /** Activate a result choice's secondary action by id. */
  async activateSecondary(choice: LauncherResultChoice, actionId: string): Promise<void> {
    const action = choice.secondaryActions?.find((a) => a.id === actionId)
    if (!action) return
    trackBehavior(TelemetryEvents.launcherChoiceActivate, {
      via: 'secondary',
      actionId,
    })
    const top = this.topFrame()
    const committedRun = top.kind === 'result' ? top.committedRun : undefined
    const pendingUsage = top.kind === 'result'
      ? top.pendingUsage
      : top.kind === 'collect-input'
        ? { item: top.item, recordUsage: top.recordUsage }
        : undefined
    await this.runChoiceAction(() => action.run(), action.title, { via: 'secondary', actionId }, committedRun, action, pendingUsage)
  }

  /** Submit a multi-select result frame. */
  async submitResultSelection(choices: LauncherResultChoice[]): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'result' || top.output.selection?.type !== 'multi') return
    await this.runChoiceAction(
      () => top.output.selection?.submit(choices),
      top.sourceTitle ?? '',
      undefined,
      top.committedRun,
      undefined,
      top.pendingUsage,
    )
  }

  /**
   * Escape / empty ⌫: stack-style step back.
   * - param-input paramIndex > 0 → previous param (drop values from that step on)
   * - collect-input with params → re-enter last param step (drop last param value)
   * - otherwise → pop one frame (list keeps launcher open)
   * From the base list frame, returns false so the host can close the launcher.
   */
  back(): boolean {
    if (this.state.frames.length <= 1) return false
    const top = this.topFrame()
    trackBehavior(TelemetryEvents.launcherBack, {
      surfaceId: this.state.surfaceId,
      fromFrame: top.kind,
      stackDepth: this.state.frames.length,
    })

    if (top.kind === 'param-input' && top.paramIndex > 0) {
      const prevIndex = top.paramIndex - 1
      const nextParams = this.paramsUpToIndex(top.item, top.params, prevIndex)
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.paramFrameFor(top.item, nextParams, prevIndex, top.objectBlockText, top.recordUsage))
      this.setState({ frames, error: null })
      return true
    }

    if (top.kind === 'collect-input' && top.item.params && top.item.params.length > 0) {
      const lastIndex = top.item.params.length - 1
      const nextParams = this.paramsUpToIndex(top.item, top.params ?? {}, lastIndex)
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.paramFrameFor(top.item, nextParams, lastIndex, undefined, top.recordUsage))
      this.setState({ frames, error: null })
      return true
    }

    this.setState({ frames: this.state.frames.slice(0, -1), error: null })
    return true
  }

  /**
   * Command-tag × : leave the whole command and return to search list in one step.
   * Does not step through intermediate params (unlike empty ⌫ / Esc).
   */
  exitCommand(): boolean {
    if (this.state.frames.length <= 1) return false
    const base = this.state.frames[0]
    if (!base || base.kind !== 'list') {
      this.setState({ frames: this.state.frames.slice(0, 1), error: null })
      return true
    }
    this.setState({ frames: [base], error: null })
    return true
  }

  /** Keep only params strictly before `index` (values for index..end are dropped). */
  private paramsUpToIndex(
    item: LauncherItem,
    params: Record<string, unknown>,
    index: number,
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...params }
    for (let i = index; i < (item.params?.length ?? 0); i++) {
      const key = item.params?.[i]?.key
      if (key) delete next[key]
    }
    return next
  }

  // ─── Execution plumbing ────────────────────────────────────────────────────

  private recordExperience(event: ExperienceEvent): void {
    ;(this.deps.appendExperienceEvent ?? appendExperienceEvent)(event)
  }

  private committedRunFor(item: LauncherItem, via: CommitVia): CommittedRunContext | undefined {
    if (item.experienceRecord === false || !isSafeExperienceIdentifier(item.systemKey)) return undefined
    return {
      runId: newExperienceId('run'),
      actionKey: item.systemKey,
      surfaceId: this.deps.surfaceId,
      via,
      artifactId: item.savedActionArtifactId,
    }
  }

  private recordRunStarted(
    run: CommittedRunContext,
    miningSnapshot?: Promise<MiningRunSnapshot | null>,
  ): void {
    const event: ExperienceEvent = {
      eventId: newExperienceId('event'),
      ts: Date.now(),
      sessionId: currentExperienceSessionId(this.fallbackSessionId),
      runId: run.runId,
      eventType: 'run.started',
      actionKey: run.actionKey,
      surfaceId: run.surfaceId,
      via: run.via,
      inputBinding: run.inputBinding,
    }
    if (!miningSnapshot) {
      this.recordExperience(event)
      return
    }
    const queued = miningSnapshot
      .catch(() => null)
      .then((snapshot) => {
        if (snapshot) {
          run.miningSnapshot = snapshot
          event.inputFingerprint = snapshot.inputFingerprint
          event.paramSignature = snapshot.paramSignature
          event.safeParamsJson = snapshot.safeParamsJson
        }
        this.recordExperience(event)
      })
    this.experienceRunQueues.set(run, queued)
    void queued.catch(() => {})
  }

  private queueExperience(run: CommittedRunContext, event: ExperienceEvent): void {
    const pending = this.experienceRunQueues.get(run)
    if (!pending) {
      this.recordExperience(event)
      return
    }
    const queued = pending
      .catch(() => {})
      .then(() => this.recordExperience(event))
    this.experienceRunQueues.set(run, queued)
    void queued.catch(() => {})
  }

  private recordRunFinished(
    run: CommittedRunContext,
    status: ExperienceRunStatus,
    errorType?: ExperienceErrorType,
  ): void {
    this.queueExperience(run, {
      eventId: newExperienceId('event'),
      ts: Date.now(),
      sessionId: currentExperienceSessionId(this.fallbackSessionId),
      runId: run.runId,
      eventType: 'run.finished',
      actionKey: run.actionKey,
      surfaceId: run.surfaceId,
      via: run.via,
      status,
      errorType,
    })
  }

  private recordOutputApplied(run: CommittedRunContext, node: LauncherResultChoice | LauncherResultAction): void {
    const outputIntent = getHostOutputIntent(node)
    if (!outputIntent) return
    this.queueExperience(run, {
      eventId: newExperienceId('event'),
      ts: Date.now(),
      sessionId: currentExperienceSessionId(this.fallbackSessionId),
      runId: run.runId,
      eventType: 'output.applied',
      actionKey: run.actionKey,
      surfaceId: run.surfaceId,
      via: run.via,
      outputIntent,
      outputApplication: 'explicit',
    })
    if (run.via === 'saved-action' && run.artifactId) {
      this.queueExperience(run, {
        eventId: newExperienceId('event'),
        ts: Date.now(),
        sessionId: currentExperienceSessionId(this.fallbackSessionId),
        runId: run.runId,
        eventType: 'artifact.invoked',
        actionKey: run.actionKey,
        surfaceId: run.surfaceId,
        via: run.via,
        artifactId: run.artifactId,
      })
      touchSavedAction(run.artifactId)
    }
    if (run.via !== 'saved-action') {
      const completedAt = Date.now()
      if (run.saveSnapshot) {
        setLastSaveableRun({
          status: 'ready',
          runId: run.runId,
          actionKey: run.actionKey,
          ...run.saveSnapshot,
          outputIntent,
          completedAt,
        })
      } else if (run.saveBlocked) {
        setLastSaveableRun({
          status: 'blocked',
          runId: run.runId,
          actionKey: run.actionKey,
          ...run.saveBlocked,
          completedAt,
        })
      }
    }
  }

  private async commitResolvedAction(input: {
    item: LauncherItem
    via: CommitVia
    params: Record<string, unknown>
    inputBinding?: InputBinding
    inputText?: string
    sourceTitle: string
    recordUsage: boolean
    execute?: () => Promise<LauncherExecuteResult>
    resolvedChoice?: LauncherResultChoice
  }): Promise<void> {
    const { item, via, sourceTitle, execute, resolvedChoice } = input
    const committedRun = this.committedRunFor(item, via)
    let miningSnapshot: Promise<MiningRunSnapshot | null> | undefined
    if (
      committedRun &&
      via !== 'saved-action' &&
      input.inputBinding &&
      item.contractFingerprint &&
      item.actionPolicy?.learnable === true &&
      (item.actionPolicy.effect === 'pure' || item.actionPolicy.effect === 'read')
    ) {
      committedRun.inputBinding = input.inputBinding
      const saveable = extractSaveableParams(item, input.params)
      if (saveable.ok) {
        committedRun.saveSnapshot = {
          inputBinding: input.inputBinding,
          savedParams: saveable.params,
          contractFingerprint: item.contractFingerprint,
          actionPolicy: item.actionPolicy,
        }
        const api = this.deps.makeApi?.(item) ?? this.deps.api
        const inputText = input.inputText ?? (
          input.inputBinding === 'selection'
            ? api.getSelectionText()
            : input.inputBinding === 'active-text'
              ? api.getActiveText()
              : ''
        )
        miningSnapshot = createMiningFingerprints(inputText, saveable.params)
      } else {
        committedRun.saveBlocked = {
          blockedKeys: saveable.blockedKeys,
          reason: saveable.reason,
        }
      }
    }
    if (committedRun) this.recordRunStarted(committedRun, miningSnapshot)

    this.setState({ busy: true, error: null })
    const startedAt = telemetryNow()

    if (resolvedChoice) {
      let result: Awaited<ReturnType<LauncherResultChoice['primaryAction']>>
      try {
        result = await resolvedChoice.primaryAction()
      } catch (error) {
        const failure = classifyExperienceError(error, 'output-failed')
        if (committedRun) this.recordRunFinished(committedRun, failure.status, failure.errorType)
        trackLatencyFrom(TelemetryEvents.launcherChoiceLatency, startedAt, {
          via,
          systemKey: item.systemKey,
          failed: true,
        })
        this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
        return
      }

      const launcherResult = result && typeof result === 'object' && 'ok' in result
        ? result as LauncherExecuteResult
        : undefined
      const succeeded = launcherResult?.ok !== false
      if (committedRun) {
        if (succeeded) {
          this.recordRunFinished(committedRun, 'success')
          this.recordOutputApplied(committedRun, resolvedChoice)
        } else {
          const failure = classifyExperienceError(new Error(launcherResult.message), 'output-failed')
          this.recordRunFinished(committedRun, failure.status, failure.errorType)
        }
      }
      trackLatencyFrom(TelemetryEvents.launcherChoiceLatency, startedAt, {
        via,
        systemKey: item.systemKey,
        terminal: !launcherResult,
        failed: !succeeded,
      })
      if (launcherResult) {
        await this.applyResult(launcherResult, sourceTitle, committedRun, {
          item,
          recordUsage: input.recordUsage,
        })
      } else {
        this.recordSuccessfulSelection(item, { recordUsage: input.recordUsage })
        this.setState({ busy: false })
        this.deps.requestClose()
      }
      return
    }

    if (!execute) return
    let result: LauncherExecuteResult
    try {
      result = await execute()
    } catch (error) {
      const failure = classifyExperienceError(error, 'provider-failed')
      if (committedRun) this.recordRunFinished(committedRun, failure.status, failure.errorType)
      trackLatencyFrom(TelemetryEvents.launcherItemExecute, startedAt, {
        ...itemTelemetryProps(item),
        via,
        failed: true,
      })
      this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
      return
    }

    if (committedRun) {
      if (result.ok) {
        this.recordRunFinished(committedRun, 'success')
      } else {
        const failure = classifyExperienceError(new Error(result.message), 'provider-failed')
        this.recordRunFinished(committedRun, failure.status, failure.errorType)
      }
    }
    trackLatencyFrom(TelemetryEvents.launcherItemExecute, startedAt, {
      ...itemTelemetryProps(item),
      via,
      ok: result.ok,
      keepOpen: 'keepOpen' in result ? Boolean(result.keepOpen) : undefined,
      hasOutput: isOutputResult(result),
    })
    await this.applyResult(result, sourceTitle, committedRun, {
      item,
      recordUsage: input.recordUsage,
    })
  }

  private async runChoiceAction(
    run: () => ReturnType<LauncherResultChoice['primaryAction']>,
    sourceTitle: string,
    extra?: Record<string, unknown>,
    committedRun?: CommittedRunContext,
    actionNode?: LauncherResultChoice | LauncherResultAction,
    pendingUsage?: ResultFrame['pendingUsage'],
  ): Promise<void> {
    this.setState({ busy: true, error: null })
    const startedAt = telemetryNow()
    let result: Awaited<ReturnType<LauncherResultChoice['primaryAction']>>
    try {
      result = await run()
    } catch (error) {
      trackLatencyFrom(TelemetryEvents.launcherChoiceLatency, startedAt, {
        failed: true,
        ...extra,
      })
      this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    trackLatencyFrom(TelemetryEvents.launcherChoiceLatency, startedAt, {
      terminal: !(result && typeof result === 'object' && 'ok' in result),
      ...extra,
    })
    const launcherResult = result && typeof result === 'object' && 'ok' in result
      ? result as LauncherExecuteResult
      : undefined
    const usageToCommit = actionNode && 'tone' in actionNode && actionNode.tone === 'muted'
      ? undefined
      : pendingUsage
    if (committedRun && actionNode && launcherResult?.ok !== false) {
      this.recordOutputApplied(committedRun, actionNode)
    }
    // Choice actions may return more output (multi-level) or void (terminal).
    if (launcherResult) {
      await this.applyResult(launcherResult, sourceTitle, committedRun, usageToCommit)
    } else {
      // Terminal action with no further output → close.
      if (usageToCommit) {
        this.recordSuccessfulSelection(usageToCommit.item, { recordUsage: usageToCommit.recordUsage })
      }
      this.setState({ busy: false })
      this.deps.requestClose()
    }
  }

  private async applyResult(
    result: LauncherExecuteResult,
    sourceTitle: string,
    committedRun?: CommittedRunContext,
    pendingUsage?: ResultFrame['pendingUsage'],
  ): Promise<void> {
    if (!result.ok) {
      // Failure: keep launcher open, show error.
      this.setState({ busy: false, error: result.message })
      return
    }
    if (isOutputResult(result)) {
      // Single choice: execute directly without entering result frame
      if (result.output.choices.length === 1) {
        const choice = result.output.choices[0]
        await this.runChoiceAction(
          () => choice.primaryAction(),
          choice.title,
          undefined,
          committedRun,
          choice,
          pendingUsage,
        )
        return
      }
      // Success with output: enter result-choice mode (keep open).
      this.setState({
        busy: false,
        error: null,
        frames: [...this.state.frames, {
          kind: 'result',
          output: result.output,
          sourceTitle,
          committedRun,
          pendingUsage,
        }],
      })
      return
    }
    if (pendingUsage) {
      this.recordSuccessfulSelection(pendingUsage.item, { recordUsage: pendingUsage.recordUsage })
    }
    if (result.keepOpen) {
      // Collect-input with suggest: keep the same frame and refresh suggestions
      // (e.g. secondary action mutates suggestion source). Generic, not product-specific.
      const top = this.topFrame()
      if (top.kind === 'collect-input' && top.item.suggest) {
        this.setState({ busy: false, error: null })
        void this.refreshSuggestions()
        return
      }
      // L2 confirm Cancel (kill / close-window): pop only the result frame so the
      // user returns to the previous step (process list / window list), not root.
      if (top.kind === 'result' && this.state.frames.length > 1) {
        this.setState({
          busy: false,
          error: null,
          frames: this.state.frames.slice(0, -1),
        })
        return
      }
      // Stay open, but drop nested frames (e.g. multi-select result after Diff
      // opens a tool surface) so system Esc back lands on the root list, not a
      // stale intermediate step under the surface.
      const root = this.state.frames[0]
      this.setState({
        busy: false,
        error: null,
        frames: root ? [root] : this.state.frames,
      })
      return
    }
    // Success with no output: close.
    this.setState({ busy: false, error: null })
    this.deps.requestClose()
  }

  private itemTitle(item: LauncherItem): string {
    return item.display.titleI18n?.[this.deps.locale as never] ?? item.display.title
  }
}
