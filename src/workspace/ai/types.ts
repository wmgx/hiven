export type AiProviderStatus = 'ready' | 'login_required' | 'unavailable'

export type AiReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export type AiCapability =
  | 'text.generate'
  | 'image.understand'
  | 'image.generate'
  | 'image.edit'
  | 'audio.transcribe'
  | 'audio.generate'
  | 'audio.realtime'
  | 'video.generate'
  | 'web.search'
  | 'tool.call'
  | 'structured_output'

export type AiAgent = {
  id: string
  name: string
  capabilities: AiCapability[]
  inputModalities: string[]
  supportedEfforts: AiReasoningEffort[]
  contextWindow?: number
  maxOutputTokens?: number
  defaultEffort?: AiReasoningEffort
  isDefault?: boolean
}

export type AiQuotaWindow = {
  usedPercent: number
  windowDurationMinutes?: number
  resetsAt?: number
}

export type AiQuotaBucket = {
  id: string
  name?: string
  primary?: AiQuotaWindow
  secondary?: AiQuotaWindow
}

export type AiProviderDescriptor = {
  id: string
  kind: string
  name: string
  /** Omitted means the existing account-based connection controls apply. */
  authentication?: 'none' | 'account'
  /** A configured selection must fail closed instead of choosing another provider/model. */
  fallbackPolicy?: 'never'
  status: AiProviderStatus
  statusMessage?: string
  /** Evidence from describe(), never a model inference or quota guarantee. */
  statusReason?: 'desktop_required' | 'cli_missing' | 'metadata_unavailable'
    | 'service_unreachable' | 'metadata_timeout' | 'metadata_invalid' | 'models_empty' | 'models_unsupported'
  /** partial confirms listed live models only; fallback entries are not discovery evidence. */
  modelCatalog?: 'complete' | 'partial' | 'fallback' | 'unknown'
  isDefault: boolean
  capabilities: AiCapability[]
  agents: AiAgent[]
  subscription?: {
    accountName?: string
    plan?: string
  }
  quota?: {
    buckets: AiQuotaBucket[]
    creditsRemaining?: number
  }
}

export type AiInput =
  | { type: 'text'; text: string }
  | { type: 'image'; blobId: string }
  | { type: 'audio'; blobId: string }
  | { type: 'file'; blobId: string }

export type AiRequest = {
  signal?: AbortSignal
  providerId?: string
  agentId?: string
  effort?: AiReasoningEffort | 'inherit'
  input: AiInput[]
  capabilities?: AiCapability[]
}

/** Configuration metadata only. Never include a prompt, body, input or blob identifier. */
export type AiPreflightRequest = {
  providerId?: string
  agentId?: string
  effort?: AiReasoningEffort | 'inherit'
  capabilities?: AiCapability[]
  inputModalities?: string[]
  forceRefresh?: boolean
}

export type AiPreflightReason =
  | 'configuration_ready'
  | 'provider_not_configured'
  | 'provider_not_registered'
  | 'provider_login_required'
  | 'desktop_required'
  | 'cli_missing'
  | 'metadata_unavailable'
  | 'metadata_timeout'
  | 'model_catalog_unknown'
  | 'model_catalog_incomplete'
  | 'model_catalog_fallback'
  | 'agent_unknown'
  | 'capability_unavailable'
  | 'input_unavailable'
  | 'configuration_changed'

export type AiPreflightResult = {
  /** ready means configuration checks passed; it does not guarantee quota or a successful run. */
  status: 'ready' | 'blocked' | 'unknown'
  reason: AiPreflightReason
  providerId?: string
  providerName?: string
  agentId?: string
  agentName?: string
  effort?: AiReasoningEffort
  checkedAt: number
  /** Opaque identity of the configuration checked, useful for rejecting stale UI results. */
  selectionKey: string
  /** Optional provider diagnostic. Consumers should localize their UI using reason. */
  message?: string
}

export type AiUsageMetric = {
  kind: string
  amount: number
  unit: 'token' | 'request' | 'image' | 'second'
}

export type AiUsageRecord = {
  runId: string
  pluginId: string
  pluginSource: 'builtin' | 'installed' | 'dev'
  providerId: string
  agentId: string
  effort?: AiReasoningEffort
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  metrics: AiUsageMetric[]
}

export type AiUsageQuery = {
  providerId?: string
  since?: number
  limit?: number
}

export type AiEvent =
  | { type: 'run.started'; runId: string; providerId: string; agentId: string }
  | { type: 'text.delta'; runId: string; delta: string }
  | { type: 'reasoning.delta'; runId: string; delta: string }
  | { type: 'image.completed'; runId: string; base64?: string; path?: string; revisedPrompt?: string }
  | { type: 'audio.delta'; runId: string; base64: string }
  | { type: 'item.started' | 'item.completed'; runId: string; item: unknown }
  | { type: 'usage.updated'; runId: string; metrics: AiUsageMetric[] }
  | { type: 'completed'; runId: string; status: 'completed' | 'cancelled' }
  | { type: 'error'; runId: string; code: string; message: string }

export interface PluginAiApi {
  providers(): Promise<AiProviderDescriptor[]>
  preflight?(request?: AiPreflightRequest): Promise<AiPreflightResult>
  /** Invalidates displayed checks on selection, permission or explicit account/provider changes. */
  subscribePreflight?(listener: () => void): () => void
  stream(request: AiRequest): AsyncIterable<AiEvent>
  cancel(runId: string): Promise<void>
  usage(query?: AiUsageQuery): Promise<AiUsageRecord[]>
}

export type AiProviderRequest = Omit<AiRequest, 'providerId' | 'agentId' | 'effort' | 'input'> & {
  runId: string
  agentId: string
  effort?: AiReasoningEffort
  input: Array<
    | { type: 'text'; text: string }
    | { type: 'localImage'; path: string }
    | { type: 'localAudio'; path: string }
    | { type: 'localFile'; path: string }
  >
}

export type AiProviderLogin = { url?: string; verificationCode?: string; loginId?: string }

export interface AiProviderAdapter {
  readonly id: string
  readonly authentication?: 'none' | 'account'
  readonly fallbackPolicy?: 'never'
  /** Enforce declared modalities even for file inputs handled specially by older adapters. */
  readonly strictInputModalities?: boolean
  describe(onUpdate?: (provider: Omit<AiProviderDescriptor, 'isDefault'>) => void): Promise<Omit<AiProviderDescriptor, 'isDefault'>>
  stream(request: AiProviderRequest): AsyncIterable<AiEvent>
  cancel(runId: string): Promise<void>
  login?(): Promise<AiProviderLogin>
  /** Cancels only this pending sign-in; it must not log out an existing account. */
  cancelLogin?(loginId: string): Promise<void>
  logout?(): Promise<void>
}
