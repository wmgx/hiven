import type { AiPreflightResult, AiProviderDescriptor, AiReasoningEffort, PluginAiApi } from '@hiven/plugin'
import type { TranslateProfile } from '../settings/model'

export type AiTranslationSelection = {
  providerId: string
  agentId: string
  effort?: AiReasoningEffort
}

export type AiReadinessReason = AiPreflightResult['reason'] | 'checking' | 'permission_denied' | 'legacy_host' | 'selection_required'
export type AiReadinessSnapshot = {
  revision: number
  status: AiPreflightResult['status'] | 'checking'
  reason: AiReadinessReason
  result?: AiPreflightResult
  providers: AiProviderDescriptor[]
}

type Selection = Pick<TranslateProfile, 'aiProviderId' | 'aiAgentId' | 'aiEffort'>

export function aiSelectionKey(profile?: Selection): string {
  return profile ? JSON.stringify([profile.aiProviderId || '', profile.aiAgentId || '', profile.aiEffort || 'inherit']) : ''
}

function permissionDenied(error: unknown): boolean {
  return error instanceof Error && /Plugin permission required: ai\.use/.test(error.message)
}

/** Metadata lifecycle only. Text, output deltas and usage never enter this controller. */
export class AiTranslationReadiness {
  private ai?: PluginAiApi
  private selection?: Selection
  private key = ''
  private generation = 0
  private unsubscribeAi?: () => void
  private listeners = new Set<() => void>()
  private snapshot: AiReadinessSnapshot = { revision: 0, status: 'checking', reason: 'checking', providers: [] }

  private readonly includeProviders: boolean

  constructor(includeProviders = false) { this.includeProviders = includeProviders }

  getSnapshot = (): AiReadinessSnapshot => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(patch: Omit<AiReadinessSnapshot, 'revision'>): void {
    this.snapshot = { ...patch, revision: this.snapshot.revision + 1 }
    for (const listener of this.listeners) listener()
  }

  private invalidate(clearProviders = false): void {
    this.generation += 1
    this.publish({ status: 'checking', reason: 'checking', providers: clearProviders ? [] : this.snapshot.providers })
  }

  /** Binding only: changing a host wrapper never performs a metadata read here. */
  setAi(ai: PluginAiApi): void {
    if (this.ai === ai) return
    this.unsubscribeAi?.()
    this.unsubscribeAi = undefined
    this.ai = ai
    this.invalidate(true)
    this.unsubscribeAi = ai.subscribePreflight?.(() => {
      if (this.ai !== ai) return
      this.invalidate()
      void this.refresh()
    })
  }

  setSelection(profile?: Selection): void {
    const key = aiSelectionKey(profile)
    if (key === this.key) return
    this.selection = profile ? { aiProviderId: profile.aiProviderId, aiAgentId: profile.aiAgentId, aiEffort: profile.aiEffort } : undefined
    this.key = key
    this.invalidate()
  }

  matches(ai: PluginAiApi, profile?: Selection): boolean {
    return this.ai === ai && this.key === aiSelectionKey(profile)
  }

  async refresh(forceRefresh = false): Promise<void> {
    const ai = this.ai
    const selection = this.selection
    if (!ai || !selection) return
    this.invalidate()
    const generation = this.generation
    const current = () => generation === this.generation && ai === this.ai
    let listPermissionDenied = false
    const providerTask = this.includeProviders
      ? Promise.resolve().then(() => ai.providers()).catch((error) => { listPermissionDenied = permissionDenied(error); return [] as AiProviderDescriptor[] })
      : Promise.resolve(this.snapshot.providers)
    let result: AiPreflightResult | undefined
    let failureReason: AiReadinessReason | undefined
    try {
      if (ai.preflight) {
        result = await ai.preflight({
          providerId: selection.aiProviderId || undefined,
          agentId: selection.aiAgentId || undefined,
          effort: selection.aiEffort || 'inherit',
          capabilities: ['text.generate'],
          inputModalities: ['text'],
          forceRefresh,
        })
      } else {
        failureReason = 'legacy_host'
      }
    } catch (error) {
      failureReason = permissionDenied(error) ? 'permission_denied' : 'metadata_unavailable'
    }
    const providers = await providerTask
    if (!current()) return
    if (listPermissionDenied) failureReason = 'permission_denied'
    if (failureReason) {
      this.publish({ status: failureReason === 'permission_denied' ? 'blocked' : 'unknown', reason: failureReason, providers })
      return
    }
    if (!result) return
    // A host must never substitute a different explicit provider or model.
    if ((selection.aiProviderId && result.providerId && result.providerId !== selection.aiProviderId)
      || (selection.aiAgentId && result.agentId && result.agentId !== selection.aiAgentId)) {
      this.publish({ status: 'unknown', reason: 'configuration_changed', providers })
      return
    }
    const missingBinding = !result.providerId || !result.agentId
    this.publish({
      status: result.status === 'ready' && missingBinding ? 'unknown' : result.status,
      reason: result.status === 'ready' && missingBinding ? 'selection_required' : result.reason,
      result,
      providers,
    })
  }

  /** Rechecks identity at execution time, including before a stale debounce/button can run. */
  execution(ai: PluginAiApi, profile: Selection): AiTranslationSelection | undefined {
    if (!this.matches(ai, profile)) return undefined
    const { status, result, reason } = this.snapshot
    if (status === 'checking' || status === 'blocked') return undefined
    if (reason === 'configuration_changed') return undefined
    const providerId = result?.providerId || profile.aiProviderId
    const agentId = result?.agentId || profile.aiAgentId
    if (!providerId || !agentId) return undefined
    return {
      providerId,
      agentId,
      effort: result?.effort ?? (profile.aiEffort && profile.aiEffort !== 'inherit' ? profile.aiEffort : undefined),
    }
  }

  dispose(): void {
    this.unsubscribeAi?.()
    this.unsubscribeAi = undefined
    this.ai = undefined
    this.invalidate(true)
  }
}

/** Keep unavailable and saved-but-missing values visible in controlled selects. */
export function keepSelectedOption<T extends string>(options: Array<{ value: T; label: string }>, selected: T, missingLabel: string): Array<{ value: T; label: string }> {
  return !selected || options.some((option) => option.value === selected) ? options : [...options, { value: selected, label: missingLabel }]
}
