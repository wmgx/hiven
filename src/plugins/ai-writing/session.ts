import type { AiPreflightResult, AiProviderDescriptor, PluginAiApi, PluginSurfaceHostApi } from '@hiven/plugin'
import { SUMMARY_POINT_LIMITS, SummaryError, type SummaryErrorCode, type SummaryPointLimit, type SummarySelection } from './prompt'
import { streamSummary } from './stream'

export type ReadinessReason = AiPreflightResult['reason'] | 'checking' | 'selection_required' | 'permission_denied' | 'legacy_host'
export type SummaryReadiness = {
  status: AiPreflightResult['status'] | 'checking'
  reason: ReadinessReason
  result?: AiPreflightResult
}
export type SummarySnapshot = {
  text: string
  maxPoints: SummaryPointLimit
  providerId: string
  agentId: string
  providers: AiProviderDescriptor[]
  readiness: SummaryReadiness
  phase: 'idle' | 'running' | 'success' | 'stopped' | 'error'
  preview: string
  errorCode?: SummaryErrorCode
  errorDetail?: string
  outputBusy: boolean
  suspended: boolean
}
type OutputHost = Pick<PluginSurfaceHostApi, 'clipboard' | 'returnToLauncherWithObject' | 'showMessage'>
type OutputMessages = { copied: string; copyFailed: string; continueFailed: string }

function permissionDenied(error: unknown): boolean {
  return error instanceof Error && /Plugin permission required: ai\.use/.test(error.message)
}

/** Ephemeral surface state. Only generate() is allowed to send the source text. */
export class SummarySession {
  private ai?: PluginAiApi
  private unsubscribeAi?: () => void
  private listeners = new Set<() => void>()
  private revision = 0
  private metadataGeneration = 0
  private run?: { revision: number; controller: AbortController }
  private outputAction?: object
  private snapshot: SummarySnapshot
  private initialText: string

  constructor(text = '') {
    this.initialText = text
    this.snapshot = {
      text, maxPoints: 5, providerId: '', agentId: '', providers: [],
      readiness: { status: 'checking', reason: 'checking' },
      phase: 'idle', preview: '', outputBusy: false, suspended: false,
    }
  }

  getSnapshot = (): SummarySnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(patch: Partial<SummarySnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private invalidate(): void {
    this.revision += 1
    const oldRun = this.run
    this.run = undefined
    this.outputAction = undefined
    oldRun?.controller.abort()
  }

  private reset(patch: Partial<SummarySnapshot> = {}): void {
    this.invalidate()
    this.publish({ phase: 'idle', preview: '', errorCode: undefined, errorDetail: undefined, outputBusy: false, ...patch })
  }

  matches(ai: PluginAiApi): boolean { return this.ai === ai }

  /** Rebinding never reads metadata or sends text by itself. */
  setAi(ai: PluginAiApi): void {
    if (this.ai === ai) return
    this.unsubscribeAi?.()
    this.ai = ai
    this.metadataGeneration += 1
    this.reset({ readiness: { status: 'checking', reason: 'checking' } })
    this.unsubscribeAi = ai.subscribePreflight?.(() => {
      if (this.ai === ai) void this.refresh()
    })
  }

  setText(text: string): void {
    if (this.snapshot.text !== text) this.reset({ text })
  }

  matchesInitialText(text = ''): boolean { return this.initialText === text }

  /** A new host-provided object replaces the draft once; ordinary renders preserve edits. */
  setInitialText(text = ''): void {
    if (this.initialText === text) return
    this.initialText = text
    this.reset({ text })
  }

  setMaxPoints(maxPoints: SummaryPointLimit): void {
    if (SUMMARY_POINT_LIMITS.includes(maxPoints) && this.snapshot.maxPoints !== maxPoints) this.reset({ maxPoints })
  }

  setSelection(providerId: string, agentId: string): void {
    if (providerId === this.snapshot.providerId && agentId === this.snapshot.agentId) return
    this.reset({ providerId, agentId, readiness: { status: 'checking', reason: 'checking' } })
    void this.refresh()
  }

  /** The metadata request is an allowlist: no source, prompt, draft or output. */
  async refresh(forceRefresh = false): Promise<void> {
    const ai = this.ai
    if (!ai) return
    const generation = ++this.metadataGeneration
    this.reset({ readiness: { status: 'checking', reason: 'checking' } })
    const { providerId, agentId, providers: previousProviders } = this.snapshot
    const selected = Boolean(providerId && agentId)
    const [catalog, check] = await Promise.allSettled([
      Promise.resolve().then(() => ai.providers()),
      selected && ai.preflight ? Promise.resolve().then(() => ai.preflight!({
        providerId, agentId, capabilities: ['text.generate'], inputModalities: ['text'], forceRefresh,
      })) : Promise.resolve(undefined),
    ])
    if (this.ai !== ai || generation !== this.metadataGeneration) return
    const providers = catalog.status === 'fulfilled' ? catalog.value : previousProviders
    const denied = [catalog, check].some((item) => item.status === 'rejected' && permissionDenied(item.reason))
    let readiness: SummaryReadiness
    if (denied) readiness = { status: 'blocked', reason: 'permission_denied' }
    else if (!selected) readiness = { status: 'blocked', reason: catalog.status === 'rejected' ? 'metadata_unavailable' : 'selection_required' }
    else if (!ai.preflight) readiness = { status: 'blocked', reason: 'legacy_host' }
    else if (check.status === 'rejected' || !check.value) readiness = { status: 'unknown', reason: 'metadata_unavailable' }
    else {
      const result = check.value
      // Never accept a fallback, including a ready response without concrete IDs.
      readiness = result.providerId !== providerId || result.agentId !== agentId
        ? { status: 'blocked', reason: 'configuration_changed' }
        : { status: result.status, reason: result.reason, result }
    }
    this.publish({ providers, readiness })
  }

  private selection(): SummarySelection | undefined {
    const { readiness, providerId, agentId, suspended } = this.snapshot
    if (!this.ai || suspended || !providerId || !agentId || readiness.status === 'blocked' || readiness.status === 'checking' || readiness.reason === 'configuration_changed') return
    return { providerId, agentId, effort: readiness.result?.effort }
  }

  canGenerate(snapshot = this.snapshot): boolean {
    return snapshot === this.snapshot && snapshot.phase !== 'running' && Boolean(snapshot.text.trim()) && Boolean(this.selection())
  }

  /** The caller supplies the last rendered snapshot, rejecting a stale button. */
  async generate(expected: SummarySnapshot): Promise<void> {
    if (!this.canGenerate(expected)) return
    const ai = this.ai!
    const selection = this.selection()!
    this.invalidate()
    const run = { revision: this.revision, controller: new AbortController() }
    this.run = run
    const current = () => this.run === run && this.revision === run.revision && this.ai === ai && !run.controller.signal.aborted
    this.publish({ phase: 'running', preview: '', errorCode: undefined, errorDetail: undefined, outputBusy: false })
    try {
      const output = await streamSummary(ai, expected.text, expected.maxPoints, selection, run.controller.signal, (preview) => {
        if (current()) this.publish({ preview })
      })
      if (current()) this.publish({ phase: 'success', preview: output })
    } catch (error) {
      if (!current()) return
      if (error instanceof Error && error.name === 'AbortError') this.publish({ phase: 'stopped' })
      else this.publish({
        phase: 'error', errorCode: error instanceof SummaryError ? error.code : 'provider',
        errorDetail: error instanceof SummaryError && error.code !== 'provider' ? undefined : error instanceof Error ? error.message : undefined,
      })
    } finally {
      if (this.run === run) this.run = undefined
    }
  }

  stop(): void {
    if (this.snapshot.phase !== 'running') return
    this.invalidate()
    this.publish({ phase: 'stopped', outputBusy: false })
  }

  suspend(): void {
    this.reset({ suspended: true })
  }

  async resume(): Promise<void> {
    this.publish({ suspended: false })
    await this.refresh(true)
  }

  canUseOutput(snapshot = this.snapshot): boolean {
    return snapshot === this.snapshot && Boolean(this.ai) && !snapshot.suspended && snapshot.phase === 'success' && Boolean(snapshot.preview.trim()) && !snapshot.outputBusy
  }

  async useOutput(action: 'copy' | 'continue', expected: SummarySnapshot, host: OutputHost, messages: OutputMessages): Promise<void> {
    if (!this.canUseOutput(expected)) return
    const revision = this.revision
    const token = {}
    this.outputAction = token
    const current = () => this.revision === revision && this.outputAction === token && Boolean(this.ai)
    this.publish({ outputBusy: true })
    try {
      if (action === 'copy') {
        await host.clipboard.writeText(expected.preview)
        if (current()) host.showMessage(messages.copied, 'success')
      } else {
        await host.returnToLauncherWithObject({ kind: 'text', text: expected.preview, source: 'tool-result' })
      }
    } catch {
      if (current()) host.showMessage(action === 'copy' ? messages.copyFailed : messages.continueFailed, 'error')
    } finally {
      if (current()) {
        this.outputAction = undefined
        this.publish({ outputBusy: false })
      }
    }
  }

  dispose(): void {
    this.unsubscribeAi?.()
    this.unsubscribeAi = undefined
    this.ai = undefined
    this.metadataGeneration += 1
    this.invalidate()
  }
}
