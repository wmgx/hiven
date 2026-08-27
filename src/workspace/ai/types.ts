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
  status: AiProviderStatus
  statusMessage?: string
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
  providerId?: string
  agentId?: string
  effort?: AiReasoningEffort | 'inherit'
  input: AiInput[]
  capabilities?: AiCapability[]
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

export interface AiProviderAdapter {
  readonly id: string
  describe(): Promise<Omit<AiProviderDescriptor, 'isDefault'>>
  stream(request: AiProviderRequest): AsyncIterable<AiEvent>
  cancel(runId: string): Promise<void>
  login?(): Promise<{ url?: string; verificationCode?: string }>
  logout?(): Promise<void>
}
