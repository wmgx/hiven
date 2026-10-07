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
  OutputIntent,
  PluginLauncherApi,
} from './types'
import type { PluginNetworkApi, PluginPrivateStorageApi, PluginShellApi } from '../pluginTypes'
import type { PluginAiApi } from '../ai/types'
import { appendUsageJournal } from '../usageJournal'
import { getHostOutputIntent, isOutputResult } from './output'
import { captureForegroundSelectionText } from './foregroundSelectionCapture'
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
  /** Manual input draft for this command, restored after editing its params. */
  inputText?: string
  /** Unsubmitted text/number edits; normalization happens only on commit. */
  paramDrafts?: Record<string, string>
  recordUsage: boolean
}

export type ResultFrame = {
  kind: 'result'
  /** Host-controlled explicit previews never auto-deliver a single choice. */
  executionMode?: LauncherItem['executionMode']
  output: LauncherOutput
  /** The item or choice that produced this output (for labeling). */
  sourceTitle?: string
  committedRun?: CommittedRunContext
  /** Delay usage until the user commits one successful output action. */
  pendingUsage?: { item: LauncherItem; recordUsage: boolean }
  /** A failed automatic action can only retry that same primary action. */
  retryOnly?: boolean
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
  /** Present only while an output action is being delivered. */
  deliveryIntent?: OutputIntent | 'action' | null
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
  /** Clear search after a successful host return/save, preserving attached material. */
  onReturnToRoot?: () => void
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
  private flowGeneration = 0
  private prepareGeneration = 0
  private readonly choiceGenerations = new WeakMap<LauncherResultChoice, number>()
  private activeDelivery: symbol | null = null
  private pendingItemKey: string | null = null
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
    if (patch.frames) {
      const top = patch.frames[patch.frames.length - 1]
      const output = top?.kind === 'result' ? top.output : top?.kind === 'collect-input' ? top.previewOutput : undefined
      const previous = this.topFrame()
      const previousOutput = previous.kind === 'result' ? previous.output : previous.kind === 'collect-input' ? previous.previewOutput : undefined
      if (output && output !== previousOutput) this.registerChoices(output)
    }
    this.state = { ...this.state, ...patch }
    this.deps.onChange(this.state)
  }

  private topFrame(): LauncherFrame {
    return this.state.frames[this.state.frames.length - 1]
  }

  private invalidatePendingActions(): void {
    this.flowGeneration += 1
    this.previewRunId += 1
    this.suggestRunId += 1
    this.activeDelivery = null
    this.pendingItemKey = null
    this.setState({ busy: false, deliveryIntent: null })
  }

  private registerChoices(output: LauncherOutput): void {
    for (const choice of output.choices) this.choiceGenerations.set(choice, this.flowGeneration)
  }

  /** Reset to the base list frame (e.g. when the launcher opens). */
  reset(): void {
    if (this.suggestDebounceTimer != null) {
      clearTimeout(this.suggestDebounceTimer)
      this.suggestDebounceTimer = null
    }
    this.fallbackSessionId = newExperienceId('session')
    this.invalidatePendingActions()
    this.prepareGeneration += 1
    this.setState({ frames: [{ kind: 'list' }], error: null, busy: false })
  }

  /**
   * Build the execution context for an item, given optional collected input.
   */
  private buildExecutionContext(item: LauncherItem, inputText?: string, inputSource?: 'foreground-app') {
    const resolvedInputText = inputText !== undefined ? inputText : item.initialInputText
    return {
      surfaceId: this.deps.surfaceId,
      input: resolvedInputText !== undefined ? { text: resolvedInputText, source: inputSource } : undefined,
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

  private isExplicitTextPreview(item: LauncherItem): boolean {
    return this.deps.surfaceId === 'global-launcher' && item.executionMode === 'explicit-text-preview'
  }

  private inputBindingFor(item: LauncherItem): InputBinding | undefined {
    if (this.isExplicitTextPreview(item)) return 'prompt'
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
    inputText?: string,
    paramDrafts?: Record<string, string>,
  ): ParamInputFrame {
    const param = item.params?.[paramIndex]
    const currentValue = param && params[param.key]
    if (param?.type === 'multi-select' && Array.isArray(currentValue)) {
      // Options may have changed since this step was last visited. Drop only
      // unavailable selections, which the user can no longer see or deselect.
      const options = this.paramOptions(param)
      params = { ...params, [param.key]: [...new Set(currentValue)].filter((value) => options.includes(value)) }
    }
    return {
      kind: 'param-input',
      item,
      params,
      paramIndex,
      query: param && (param.type === 'text' || param.type === 'number')
        ? paramDrafts?.[param.key] ?? this.queryFor(param, params)
        : '',
      selectedIndex: this.selectedIndexFor(param, params),
      objectBlockText,
      inputText,
      paramDrafts,
      recordUsage,
    }
  }

  private hasCustomizableParams(item: LauncherItem): boolean {
    return Boolean(item.executeWithParams && item.params && item.params.length > 0)
  }

  private shouldCollectTextInput(item: LauncherItem): boolean {
    if (this.isExplicitTextPreview(item)) return true
    if (this.deps.surfaceId !== 'global-launcher' || item.behavior.type !== 'perform' || !item.inputPolicy) return false
    const mode = item.inputPolicy?.mode ?? 'auto'
    const api = this.deps.makeApi?.(item) ?? this.deps.api
    const hasBoundSelection = (mode === 'auto' || mode === 'selection') && Boolean(api.getSelectionText())
    return !hasBoundSelection
  }

  /**
   * Whether this item's collect-input flow may use an on-demand foreground-app
   * capture as a text source at all. 'all' mode means "whole document", which
   * a foreign app's selection can't stand in for. This governs eligibility
   * only — callers decide *when* to actually trigger a capture.
   */
  private isForegroundCaptureEligible(item: LauncherItem): boolean {
    if (this.isExplicitTextPreview(item) || item.metadataInput) return false
    const mode = item.inputPolicy?.mode ?? 'auto'
    return this.deps.surfaceId === 'global-launcher' &&
      item.behavior.type === 'perform' &&
      item.inputPolicy != null &&
      mode !== 'all'
  }

  /** Explicitly import the foreground selection into an empty input step. */
  async captureInput(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'collect-input' || top.inputText || this.state.busy || !this.isForegroundCaptureEligible(top.item)) return
    const api = this.deps.makeApi?.(top.item) ?? this.deps.api
    const generation = this.flowGeneration
    this.setState({ busy: true, error: null })
    try {
      const text = await captureForegroundSelectionText(api, this.deps.locale as Locale, { restoreLauncher: true })
      // Navigation or typing while capture is pending must not overwrite a newer draft.
      if (this.topFrame() === top && text !== undefined) this.setInputText(text)
    } catch (error) {
      if (this.topFrame() === top) this.setState({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      if (generation === this.flowGeneration) this.setState({ busy: false })
    }
  }

  private hasObjectBlockText(text: string | undefined): text is string {
    return text !== undefined
  }

  private shouldPreviewInput(frame: CollectInputFrame): boolean {
    return !this.isExplicitTextPreview(frame.item) && !frame.item.metadataInput && this.shouldCollectTextInput(frame.item)
  }

  private collectInputFrameFor(
    item: LauncherItem,
    params?: Record<string, unknown>,
    recordUsage = this.shouldRecord(item, {}),
    inputText?: string,
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
      inputText: inputText ?? item.initialInputText ?? '',
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
    if (this.state.busy && this.pendingItemKey === item.systemKey) return
    this.invalidatePendingActions()
    const prepareGeneration = ++this.prepareGeneration
    // A first-level selection starts a new command, never a nested draft session.
    this.setState({ frames: [{ kind: 'list' }], error: null })
    if (item.prepare) {
      this.setState({ busy: true })
      try {
        const prepared = await item.prepare(this.buildExecutionContext(item))
        if (prepareGeneration !== this.prepareGeneration) return
        item = prepared ?? item
      } catch (error) {
        if (prepareGeneration === this.prepareGeneration) {
          this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      this.setState({ busy: false })
    }
    // Names and search filters are command metadata, never attached material.
    if (item.metadataInput) {
      options = { ...options, objectBlockText: undefined }
      item = { ...item, initialInputText: undefined }
    }
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

    if ((options.customizeParams || this.isExplicitTextPreview(item)) && this.hasCustomizableParams(item)) {
      trackBehavior(TelemetryEvents.launcherEnterParamInput, itemTelemetryProps(item))
      this.setState({
        frames: [...this.state.frames, this.paramFrameFor(item, undefined, 0, options.objectBlockText, recordUsage)],
      })
      return
    }

    if (item.behavior.type === 'collect-input') {
      if (item.initialInputText === undefined && this.hasObjectBlockText(options.objectBlockText)) {
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
      if (item.initialInputText === undefined && this.hasObjectBlockText(options.objectBlockText)) {
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

    const inputText = item.initialInputText ?? options.objectBlockText
    await this.commitResolvedAction({
      item,
      via: item.commitVia ?? 'execute',
      params: this.defaultParamsFor(item),
      sourceTitle: this.itemTitle(item),
      recordUsage,
      inputBinding: inputText !== undefined ? 'prompt' : this.inputBindingFor(item),
      inputText,
      execute: () => Promise.resolve(item.execute(this.buildExecutionContext(item, inputText))),
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
    const label = param.labelI18n?.[this.deps.locale as Locale] ?? param.label
    const required = () => translate(this.deps.locale as Locale, 'palette', 'fieldRequiredWithLabel', { label })
    const invalid = () => translate(this.deps.locale as Locale, 'palette', 'invalidParamWithLabel', { label })
    if (value === undefined || value === null || value === '') {
      return param.required || (param.type === 'multi-select' && (param.minSelect ?? 0) > 0) ? required() : null
    }
    if (param.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
      return translate(this.deps.locale as Locale, 'palette', 'invalidNumber')
    }
    if (param.type === 'text' && typeof value !== 'string') return invalid()
    if (param.type === 'boolean' && typeof value !== 'boolean') return invalid()
    if (param.type === 'single-select' && !this.paramOptions(param).includes(value)) return invalid()
    if (param.type === 'multi-select') {
      if (!Array.isArray(value)) return invalid()
      if (value.length < Math.max(param.minSelect ?? 0, param.required ? 1 : 0)) return required()
      const options = this.paramOptions(param)
      if (value.length > (param.maxSelect ?? Number.POSITIVE_INFINITY) ||
        new Set(value).size !== value.length || value.some((entry) => !options.includes(entry))) return invalid()
    }
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
    if (this.state.busy) return
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

    const paramDrafts = { ...top.paramDrafts }
    delete paramDrafts[param.key]
    const nextIndex = top.paramIndex + 1
    if (nextIndex < (top.item.params?.length ?? 0)) {
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.paramFrameFor(top.item, params, nextIndex, top.objectBlockText, top.recordUsage, top.inputText, paramDrafts))
      this.setState({ frames, error: null })
      return
    }

    const frames = this.state.frames.slice(0, -1)
    frames.push(this.paramFrameFor(top.item, params, top.paramIndex, top.objectBlockText, top.recordUsage, top.inputText, paramDrafts))
    this.setState({ frames, error: null })
    await this.submitParams()
  }

  /** Submit the active parameter input frame. */
  async submitParams(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'param-input' || !top.item.executeWithParams) return
    if (this.state.busy) return

    const error = this.validateParams(top.item, top.params)
    if (error) {
      this.setState({ error })
      return
    }

    if (top.inputText !== undefined || top.item.behavior.type === 'collect-input' || this.shouldCollectTextInput(top.item)) {
      // If Object Block text is available, skip collect-input and execute directly with params.
      if (top.inputText === undefined && top.item.initialInputText === undefined && this.hasObjectBlockText(top.objectBlockText)) {
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
      frames.push(this.collectInputFrameFor(top.item, top.params, top.recordUsage, top.inputText))
      this.setState({ frames, error: null })
      return
    }

    const inputText = top.item.initialInputText ?? top.objectBlockText
    await this.commitResolvedAction({
      item: top.item,
      via: top.item.commitVia ?? 'execute',
      params: top.params,
      inputBinding: inputText !== undefined ? 'prompt' : this.inputBindingFor(top.item),
      inputText,
      sourceTitle: this.itemTitle(top.item),
      recordUsage: top.recordUsage,
      execute: () => Promise.resolve(top.item.executeWithParams?.(this.buildExecutionContext(top.item, inputText), top.params) ?? top.item.execute(this.buildExecutionContext(top.item, inputText))),
    })
  }

  /** Update the text in the active collect-input frame. */
  setInputText(text: string, expectedFrame?: CollectInputFrame): void {
    const top = this.topFrame()
    if (top.kind !== 'collect-input') return
    // Host drafts get a fresh item per edit. Typing replaces the frame, while
    // its item remains the same until that edit is left or another one starts.
    if (expectedFrame && top.item !== expectedFrame.item) return
    if (text !== top.inputText) this.invalidatePendingActions()
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
    if (this.activeDelivery || top.kind !== 'collect-input' || !top.item.suggest) return

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
    if (this.activeDelivery || top.kind !== 'collect-input' || !this.shouldPreviewInput(top)) return
    // Suggest path owns empty/partial lists for collect-input items with suggest.
    if (top.item.suggest) return

    const paramError = top.params && this.validateParams(top.item, top.params)
    if (paramError) {
      this.setState({ error: paramError })
      return
    }

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

    this.registerChoices(result.output)
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
    if (top.kind !== 'collect-input' || top.item.systemKey !== frame.item.systemKey) return
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
  async submitInput(expectedFrame?: CollectInputFrame): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'collect-input') return
    if (expectedFrame && top !== expectedFrame) return
    if (this.state.busy) return
    const paramError = top.params && this.validateParams(top.item, top.params)
    if (paramError) {
      this.setState({ error: paramError })
      return
    }
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
    const hasInput = this.isExplicitTextPreview(item) ? inputText.length > 0 : inputText.trim().length > 0
    if (!hasInput && !inputSpec?.allowEmptyInput) {
      this.setState({ error: inputSpec?.emptyInputMessageI18n?.[this.deps.locale as Locale] ?? inputSpec?.emptyInputMessage ?? translate(this.deps.locale as Locale, 'palette', 'inputRequired') })
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

  private canActivateChoice(choice: LauncherResultChoice): boolean {
    if (this.state.busy || this.activeDelivery) return false
    if (this.choiceGenerations.get(choice) !== this.flowGeneration) return false
    const top = this.topFrame()
    if (top.kind === 'result') return top.output.choices.includes(choice)
    return top.kind === 'collect-input' && Boolean(top.previewOutput?.choices.includes(choice)) &&
      (Boolean(top.item.suggest) || top.previewInputText === top.inputText)
  }

  /** Keep the legacy host paste destination under the same output guard. */
  async activatePreviewPaste(
    choice: LauncherResultChoice,
    paste: (text: string, isCurrent: () => boolean) => void | LauncherExecuteResult | Promise<void | LauncherExecuteResult>,
  ): Promise<void> {
    if (!this.canActivateChoice(choice)) return
    const top = this.topFrame()
    if ((top.kind === 'result' && (top.retryOnly || top.executionMode === 'explicit-text-preview')) ||
      (top.kind === 'collect-input' && (this.isExplicitTextPreview(top.item) || top.item.metadataInput))) return
    const text = (choice.preview ?? choice.title ?? '').trim()
    if (!text) return
    const pendingUsage = top.kind === 'result' ? top.pendingUsage
      : top.kind === 'collect-input' ? { item: top.item, recordUsage: top.recordUsage } : undefined
    const generation = this.flowGeneration
    await this.runChoiceAction(() => paste(text, () => generation === this.flowGeneration), choice.title, { via: 'preview-paste' },
      undefined, undefined, pendingUsage, { intent: 'paste-to-foreground-app' })
  }

  /** Activate a result choice's primary action. */
  async activateChoice(choice: LauncherResultChoice): Promise<void> {
    if (!this.canActivateChoice(choice)) return
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
    if (!this.canActivateChoice(choice)) return
    if (this.topFrame().kind === 'result' && (this.topFrame() as ResultFrame).retryOnly) return
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
    if (this.state.busy || top.kind !== 'result' || top.output.selection?.type !== 'multi' || top.retryOnly) return
    if (choices.some((choice) => !this.canActivateChoice(choice))) return
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
   * - param-input paramIndex > 0 → previous param, preserving the command draft
   * - collect-input with params → re-enter last param with the input draft
   * - otherwise → pop one frame (list keeps launcher open)
   * From the base list frame, returns false so the host can close the launcher.
   */
  back(expectedFrame?: CollectInputFrame): boolean {
    const current = this.topFrame()
    if (expectedFrame && (current.kind !== 'collect-input' || current.item !== expectedFrame.item)) return false
    this.invalidatePendingActions()
    this.prepareGeneration += 1
    if (this.state.frames.length <= 1) return false
    const top = this.topFrame()
    trackBehavior(TelemetryEvents.launcherBack, {
      surfaceId: this.state.surfaceId,
      fromFrame: top.kind,
      stackDepth: this.state.frames.length,
    })

    if (top.kind === 'param-input' && top.paramIndex > 0) {
      const prevIndex = top.paramIndex - 1
      const param = this.currentParam(top)
      // Text edits may not have been committed yet; keep them as a draft too.
      const paramDrafts = param && (param.type === 'text' || param.type === 'number')
        ? { ...top.paramDrafts, [param.key]: top.query }
        : top.paramDrafts
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.paramFrameFor(top.item, top.params, prevIndex, top.objectBlockText, top.recordUsage, top.inputText, paramDrafts))
      this.setState({ frames, error: null })
      return true
    }

    if (top.kind === 'collect-input' && top.item.params && top.item.params.length > 0) {
      const lastIndex = top.item.params.length - 1
      const nextParams = top.params ?? this.defaultParamsFor(top.item)
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.paramFrameFor(top.item, nextParams, lastIndex, undefined, top.recordUsage, top.inputText))
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
  exitCommand(expectedFrame?: CollectInputFrame): boolean {
    const current = this.topFrame()
    if (expectedFrame && (current.kind !== 'collect-input' || current.item !== expectedFrame.item)) return false
    this.invalidatePendingActions()
    this.prepareGeneration += 1
    if (this.state.frames.length <= 1) return false
    const base = this.state.frames[0]
    if (!base || base.kind !== 'list') {
      this.setState({ frames: this.state.frames.slice(0, 1), error: null })
      return true
    }
    this.setState({ frames: [base], error: null })
    return true
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

  private recordOutputApplied(run: CommittedRunContext, node: LauncherResultChoice | LauncherResultAction, updateLastRun = true): void {
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
      try {
        touchSavedAction(run.artifactId)
      } catch (error) {
        console.warn('[hiven] Failed to update Saved Action usage:', error)
      }
    }
    if (updateLastRun && run.via !== 'saved-action') {
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
    const flowGeneration = this.flowGeneration
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

    this.pendingItemKey = item.systemKey
    this.setState({ busy: true, error: null })
    const startedAt = telemetryNow()

    if (resolvedChoice) {
      await this.runChoiceAction(() => resolvedChoice.primaryAction(), sourceTitle,
        { via, systemKey: item.systemKey }, committedRun, resolvedChoice,
        { item, recordUsage: input.recordUsage }, { finishRun: true })
      return
    }

    if (!execute) return
    let result: LauncherExecuteResult
    try {
      result = await execute()
      if (flowGeneration !== this.flowGeneration) return
    } catch (error) {
      if (flowGeneration !== this.flowGeneration) return
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
    run: () => Awaited<ReturnType<LauncherResultChoice['primaryAction']>> | Promise<Awaited<ReturnType<LauncherResultChoice['primaryAction']>>>,
    sourceTitle: string,
    extra?: Record<string, unknown>,
    committedRun?: CommittedRunContext,
    actionNode?: LauncherResultChoice | LauncherResultAction,
    pendingUsage?: ResultFrame['pendingUsage'],
    options: { retryFrame?: ResultFrame; finishRun?: boolean; intent?: OutputIntent } = {},
  ): Promise<void> {
    if (this.activeDelivery) return
    const generation = this.flowGeneration
    const delivery = Symbol('output-delivery')
    this.activeDelivery = delivery
    this.pendingItemKey = pendingUsage?.item.systemKey ?? null
    // A pending preview/suggestion refresh must not clear delivery busy/error state.
    this.previewRunId += 1
    this.suggestRunId += 1
    const isCurrent = () => generation === this.flowGeneration && this.activeDelivery === delivery
    this.setState({ busy: true, error: null, deliveryIntent: options.intent ?? (actionNode && getHostOutputIntent(actionNode)) ?? 'action' })
    const startedAt = telemetryNow()
    let result: Awaited<ReturnType<LauncherResultChoice['primaryAction']>>
    try {
      result = await run()
    } catch (error) {
      const failure = classifyExperienceError(error, 'output-failed')
      if (committedRun && options.finishRun) this.recordRunFinished(committedRun, failure.status, failure.errorType)
      trackLatencyFrom(TelemetryEvents.launcherChoiceLatency, startedAt, { failed: true, ...extra })
      if (!isCurrent()) return
      this.failDelivery(error instanceof Error ? error.message : String(error), options.retryFrame)
      return
    }
    const launcherResult = result && typeof result === 'object' && 'ok' in result
      ? result as LauncherExecuteResult
      : undefined
    const succeeded = launcherResult?.ok !== false
    trackLatencyFrom(TelemetryEvents.launcherChoiceLatency, startedAt, { terminal: !launcherResult, failed: !succeeded, ...extra })
    if (committedRun && options.finishRun) {
      if (succeeded) this.recordRunFinished(committedRun, 'success')
      else {
        const failure = classifyExperienceError(new Error(launcherResult?.ok === false ? launcherResult.message : ''), 'output-failed')
        this.recordRunFinished(committedRun, failure.status, failure.errorType)
      }
    }
    // An already-started external delivery can finish after navigation. Record
    // what actually happened, without replacing LastRun or touching the new flow.
    if (committedRun && actionNode && succeeded) this.recordOutputApplied(committedRun, actionNode, isCurrent())
    if (!isCurrent()) return
    if (launcherResult?.ok === false) {
      this.failDelivery(launcherResult.message, options.retryFrame)
      return
    }
    this.activeDelivery = null
    this.setState({ deliveryIntent: null })
    const usageToCommit = actionNode && 'tone' in actionNode && actionNode.tone === 'muted'
      ? undefined
      : pendingUsage
    if (launcherResult) {
      await this.applyResult(launcherResult, sourceTitle, committedRun, usageToCommit, actionNode ? getHostOutputIntent(actionNode) ?? undefined : undefined)
    } else {
      this.flowGeneration += 1
      if (usageToCommit) this.recordSuccessfulSelection(usageToCommit.item, { recordUsage: usageToCommit.recordUsage })
      this.setState({ busy: false })
      this.deps.requestClose()
    }
  }

  private failDelivery(error: string, retryFrame?: ResultFrame): void {
    this.activeDelivery = null
    this.setState({
      busy: false, deliveryIntent: null, error,
      ...(retryFrame ? { frames: [...this.state.frames, retryFrame] } : {}),
    })
  }

  private async applyResult(
    result: LauncherExecuteResult,
    sourceTitle: string,
    committedRun?: CommittedRunContext,
    pendingUsage?: ResultFrame['pendingUsage'],
    appliedOutputIntent?: OutputIntent,
  ): Promise<void> {
    if (!result.ok) {
      // Failure: keep launcher open, show error.
      this.setState({ busy: false, error: result.message })
      return
    }
    if (isOutputResult(result)) {
      const explicitPreview = pendingUsage && this.isExplicitTextPreview(pendingUsage.item)
      // Existing single-choice actions retain their immediate execution.
      if (!explicitPreview && result.output.choices.length === 1) {
        const choice = result.output.choices[0]
        await this.runChoiceAction(
          () => choice.primaryAction(),
          choice.title,
          undefined,
          committedRun,
          choice,
          pendingUsage,
          { retryFrame: { kind: 'result', output: result.output.selection ? { choices: [choice] } : result.output, sourceTitle, committedRun, pendingUsage, retryOnly: true } },
        )
        return
      }
      // Success with output: enter result-choice mode (keep open).
      this.setState({
        busy: false,
        error: null,
        frames: [...this.state.frames, {
          kind: 'result',
          executionMode: explicitPreview ? 'explicit-text-preview' : undefined,
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
      if (appliedOutputIntent === 'return-to-launcher') {
        this.flowGeneration += 1
        this.deps.onReturnToRoot?.()
        this.setState({ busy: false, error: null, frames: this.state.frames.slice(0, 1) })
        return
      }
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
      if (pendingUsage?.item.metadataInput) this.deps.onReturnToRoot?.()
      this.setState({
        busy: false,
        error: null,
        frames: root ? [root] : this.state.frames,
      })
      return
    }
    // Success with no output: close.
    this.flowGeneration += 1
    this.setState({ busy: false, error: null })
    this.deps.requestClose()
  }

  private itemTitle(item: LauncherItem): string {
    return item.display.titleI18n?.[this.deps.locale as never] ?? item.display.title
  }
}
