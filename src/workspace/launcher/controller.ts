/**
 * Launcher Controller
 *
 * Framework-agnostic state machine driving both CommandPalette and GlobalLauncher.
 * The UI renders `controller.state` and calls intents (selectItem, submitInput,
 * activateChoice, back). The controller owns:
 *   - first-level selection
 *   - collect-input flow (two-step items)
 *   - result-choice stack (multi-level output)
 *   - usage recording at first-level selection time
 *   - Enter (single-result) and Escape (back) semantics
 *
 * Usage rules (design doc §4):
 *   - perform        → record usage BEFORE execution
 *   - collect-input  → record usage when ENTERING input mode (not on submit)
 *   - pinned / dynamic items → never record long-term usage (the caller passes
 *     recordUsage:false for pinned; dynamic items are kind 'dynamic' and skipped)
 */

import type {
  LauncherExecuteResult,
  LauncherInputSpec,
  LauncherItem,
  LauncherOutput,
  LauncherParamSpec,
  LauncherResultChoice,
  LauncherSurfaceId,
  PluginLauncherApi,
} from './types'
import type { PluginPrivateStorageApi } from '../pluginTypes'
import { isOutputResult } from './output'
import { translate, type Locale } from '../../i18n'

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
  previewOutput?: LauncherOutput
  previewInputText?: string
}

export type ParamInputFrame = {
  kind: 'param-input'
  item: LauncherItem
  params: Record<string, unknown>
  paramIndex: number
  query: string
  selectedIndex: number
}

export type ResultFrame = {
  kind: 'result'
  output: LauncherOutput
  /** The item or choice that produced this output (for labeling). */
  sourceTitle?: string
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

export type SelectOptions = {
  /** When false (pinned execution), usage is not recorded. */
  recordUsage?: boolean
  /** Enter a system-owned parameter form instead of running default params. */
  customizeParams?: boolean
}

// ─── Controller ───────────────────────────────────────────────────────────

export class LauncherController {
  private state: LauncherControllerState
  private deps: LauncherControllerDeps
  private previewRunId = 0

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
      t: this.deps.makeT(item),
    }
  }

  private shouldRecord(item: LauncherItem, options: SelectOptions): boolean {
    if (options.recordUsage === false) return false
    // Dynamic items never write long-term usage.
    if (item.kind === 'dynamic') return false
    return true
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

  private paramOptions(param: LauncherParamSpec): unknown[] {
    if (param.type === 'boolean') return [true, false]
    return (param.options ?? []).map((option) => typeof option === 'string' ? option : option.value)
  }

  private selectedIndexFor(param: LauncherParamSpec | undefined, params: Record<string, unknown>): number {
    if (!param) return 0
    const value = params[param.key]
    const index = this.paramOptions(param).findIndex((option) => option === value)
    return index >= 0 ? index : 0
  }

  private queryFor(param: LauncherParamSpec | undefined, params: Record<string, unknown>): string {
    if (!param || (param.type !== 'text' && param.type !== 'number')) return ''
    const value = params[param.key]
    return value === undefined || value === null ? '' : String(value)
  }

  private paramFrameFor(item: LauncherItem, params = this.defaultParamsFor(item), paramIndex = 0): ParamInputFrame {
    const param = item.params?.[paramIndex]
    return {
      kind: 'param-input',
      item,
      params,
      paramIndex,
      query: this.queryFor(param, params),
      selectedIndex: this.selectedIndexFor(param, params),
    }
  }

  private hasCustomizableParams(item: LauncherItem): boolean {
    return Boolean(item.executeWithParams && item.params && item.params.length > 0)
  }

  private shouldCollectTextInput(item: LauncherItem): boolean {
    return this.deps.surfaceId === 'global-launcher' &&
      item.behavior.type === 'perform' &&
      item.inputPolicy != null
  }

  private shouldPreviewInput(frame: CollectInputFrame): boolean {
    return this.shouldCollectTextInput(frame.item)
  }

  private collectInputFrameFor(item: LauncherItem, params?: Record<string, unknown>): CollectInputFrame {
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
    }
  }

  /**
   * Select a first-level launcher item.
   *  - collect-input: record usage now, enter input frame.
   *  - perform: record usage now, execute immediately.
   */
  async selectItem(item: LauncherItem, options: SelectOptions = {}): Promise<void> {
    this.setState({ error: null })

    if (options.customizeParams && this.hasCustomizableParams(item)) {
      if (this.shouldRecord(item, options)) {
        this.deps.recordSelection(this.deps.surfaceId, item)
      }
      this.setState({
        frames: [...this.state.frames, this.paramFrameFor(item)],
      })
      return
    }

    if (item.behavior.type === 'collect-input') {
      if (this.shouldRecord(item, options)) {
        this.deps.recordSelection(this.deps.surfaceId, item)
      }
      this.setState({
        frames: [...this.state.frames, this.collectInputFrameFor(item)],
      })
      return
    }

    if (this.shouldCollectTextInput(item)) {
      if (this.shouldRecord(item, options)) {
        this.deps.recordSelection(this.deps.surfaceId, item)
      }
      this.setState({
        frames: [...this.state.frames, this.collectInputFrameFor(item)],
      })
      return
    }

    // perform: record before execution
    if (this.shouldRecord(item, options)) {
      this.deps.recordSelection(this.deps.surfaceId, item)
    }
    await this.runAndHandle(
      () => Promise.resolve(item.execute(this.buildExecutionContext(item))),
      this.itemTitle(item),
    )
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

    const params = {
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
      frames.push(this.paramFrameFor(top.item, params, nextIndex))
      this.setState({ frames, error: null })
      return
    }

    const frames = this.state.frames.slice(0, -1)
    frames.push(this.paramFrameFor(top.item, params, top.paramIndex))
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
      const frames = this.state.frames.slice(0, -1)
      frames.push(this.collectInputFrameFor(top.item, top.params))
      this.setState({ frames, error: null })
      return
    }

    await this.runAndHandle(
      () => Promise.resolve(top.item.executeWithParams?.(this.buildExecutionContext(top.item), top.params) ?? top.item.execute(this.buildExecutionContext(top.item))),
      this.itemTitle(top.item),
    )
  }

  /** Update the text in the active collect-input frame. */
  setInputText(text: string): void {
    const top = this.topFrame()
    if (top.kind !== 'collect-input') return
    const frames = this.state.frames.slice(0, -1)
    frames.push({ ...top, inputText: text, previewOutput: undefined, previewInputText: undefined })
    this.setState({ frames, error: null })
  }

  async previewInput(): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'collect-input' || !this.shouldPreviewInput(top)) return

    const { item, inputText } = top
    if (!inputText.trim() && !top.input.allowEmptyInput) {
      this.clearCollectInputPreview(top)
      return
    }

    const runId = ++this.previewRunId
    this.setState({ busy: true, error: null })

    let result: LauncherExecuteResult
    try {
      result = await Promise.resolve(
        top.params && item.executeWithParams
          ? item.executeWithParams(this.buildExecutionContext(item, inputText), top.params)
          : item.execute(this.buildExecutionContext(item, inputText)),
      )
    } catch (error) {
      if (runId !== this.previewRunId) return
      this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
      return
    }

    if (runId !== this.previewRunId) return
    const latestTop = this.topFrame()
    if (latestTop.kind !== 'collect-input' || latestTop.item.systemKey !== item.systemKey || latestTop.inputText !== inputText) {
      this.setState({ busy: false })
      return
    }

    if (!result.ok) {
      this.clearCollectInputPreview(latestTop, result.message)
      return
    }
    if (!isOutputResult(result)) {
      this.clearCollectInputPreview(latestTop)
      return
    }

    const frames = this.state.frames.slice(0, -1)
    frames.push({
      ...latestTop,
      previewOutput: result.output,
      previewInputText: inputText,
    })
    this.setState({ frames, busy: false, error: null })
  }

  private clearCollectInputPreview(frame: CollectInputFrame, error: string | null = null): void {
    const top = this.topFrame()
    if (top.kind !== 'collect-input' || top.item.systemKey !== frame.item.systemKey) {
      this.setState({ busy: false, error })
      return
    }
    const frames = this.state.frames.slice(0, -1)
    frames.push({ ...top, previewOutput: undefined, previewInputText: undefined })
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

    const spec = item.behavior.type === 'collect-input' ? item.behavior.input : undefined
    const inputSpec = top.input ?? spec
    if (!inputText.trim() && !inputSpec?.allowEmptyInput) {
      this.setState({ error: inputSpec?.emptyInputMessage ?? translate(this.deps.locale as Locale, 'palette', 'inputRequired') })
      return
    }

    const firstPreviewChoice = top.previewInputText === inputText
      ? top.previewOutput?.choices[0]
      : undefined
    if (firstPreviewChoice && this.shouldPreviewInput(top)) {
      await this.runChoiceAction(() => firstPreviewChoice.primaryAction(), firstPreviewChoice.title)
      return
    }

    await this.runAndHandle(
      () => Promise.resolve(
        top.params && item.executeWithParams
          ? item.executeWithParams(this.buildExecutionContext(item, inputText), top.params)
          : item.execute(this.buildExecutionContext(item, inputText)),
      ),
      this.itemTitle(item),
    )
  }

  /** Activate a result choice's primary action. */
  async activateChoice(choice: LauncherResultChoice): Promise<void> {
    await this.runChoiceAction(() => choice.primaryAction(), choice.title)
  }

  /** Activate a result choice's secondary action by id. */
  async activateSecondary(choice: LauncherResultChoice, actionId: string): Promise<void> {
    const action = choice.secondaryActions?.find((a) => a.id === actionId)
    if (!action) return
    await this.runChoiceAction(() => action.run(), action.title)
  }

  /** Submit a multi-select result frame. */
  async submitResultSelection(choices: LauncherResultChoice[]): Promise<void> {
    const top = this.topFrame()
    if (top.kind !== 'result' || top.output.selection?.type !== 'multi') return
    await this.runChoiceAction(() => top.output.selection?.submit(choices), top.sourceTitle ?? '')
  }

  /**
   * Escape: pop one frame. From the base list frame, returns false so the host
   * can close the launcher.
   */
  back(): boolean {
    if (this.state.frames.length <= 1) return false
    this.setState({ frames: this.state.frames.slice(0, -1), error: null })
    return true
  }

  // ─── Execution plumbing ────────────────────────────────────────────────────

  private async runAndHandle(run: () => Promise<LauncherExecuteResult>, sourceTitle: string): Promise<void> {
    this.setState({ busy: true, error: null })
    let result: LauncherExecuteResult
    try {
      result = await run()
    } catch (error) {
      this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    this.applyResult(result, sourceTitle)
  }

  private async runChoiceAction(run: () => ReturnType<LauncherResultChoice['primaryAction']>, sourceTitle: string): Promise<void> {
    this.setState({ busy: true, error: null })
    let result: Awaited<ReturnType<LauncherResultChoice['primaryAction']>>
    try {
      result = await run()
    } catch (error) {
      this.setState({ busy: false, error: error instanceof Error ? error.message : String(error) })
      return
    }
    // Choice actions may return more output (multi-level) or void (terminal).
    if (result && typeof result === 'object' && 'ok' in result) {
      this.applyResult(result as LauncherExecuteResult, sourceTitle)
    } else {
      // Terminal action with no further output → close.
      this.setState({ busy: false })
      this.deps.requestClose()
    }
  }

  private applyResult(result: LauncherExecuteResult, sourceTitle: string): void {
    if (!result.ok) {
      // Failure: keep launcher open, show error.
      this.setState({ busy: false, error: result.message })
      return
    }
    if (isOutputResult(result)) {
      // Success with output: enter result-choice mode (keep open).
      this.setState({
        busy: false,
        error: null,
        frames: [...this.state.frames, { kind: 'result', output: result.output, sourceTitle }],
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
