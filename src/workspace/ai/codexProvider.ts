import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type {
  AiAgent,
  AiCapability,
  AiEvent,
  AiProviderAdapter,
  AiProviderDescriptor,
  AiProviderRequest,
  AiQuotaBucket,
  AiReasoningEffort,
  AiUsageMetric,
} from './types'

type RpcEvent = { method: string; params?: Record<string, unknown> }
type RpcResult = Record<string, unknown>

const subscribers = new Set<(event: RpcEvent) => void>()
const activeTurns = new Map<string, { threadId: string; turnId: string }>()
let listenerPromise: Promise<void> | undefined
let bridgePromise: Promise<void> | undefined
let initialized = false

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

async function ensureBridge(): Promise<void> {
  if (!isTauri()) throw new Error('Codex App Server requires the desktop app')
  bridgePromise ??= (async () => {
    listenerPromise ??= listen<RpcEvent>('hiven://ai-codex-event', ({ payload }) => {
      for (const subscriber of subscribers) subscriber(payload)
    }).then(() => undefined)
    await listenerPromise
    await rpc('initialize', {
      clientInfo: { name: 'hiven', title: 'Hiven', version: '0.2.57' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    }, false)
    await invoke('ai_codex_notify', { method: 'initialized', params: {} })
    initialized = true
  })().catch((error) => {
    bridgePromise = undefined
    initialized = false
    throw error
  })
  await bridgePromise
}

async function rpc(method: string, params?: unknown, initialize = true): Promise<RpcResult> {
  if (initialize && !initialized) await ensureBridge()
  try {
    return await invoke<RpcResult>('ai_codex_rpc', { method, params: params ?? null })
  } catch (error) {
    if (!initialize || !String(error).includes('HIVEN_CODEX_INITIALIZATION_REQUIRED')) throw error
    initialized = false
    bridgePromise = undefined
    await ensureBridge()
    return invoke<RpcResult>('ai_codex_rpc', { method, params: params ?? null })
  }
}

function subscribe(subscriber: (event: RpcEvent) => void): () => void {
  subscribers.add(subscriber)
  return () => subscribers.delete(subscriber)
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function modelCapabilities(inputModalities: string[]): AiCapability[] {
  const capabilities: AiCapability[] = ['text.generate', 'web.search', 'tool.call', 'image.generate']
  if (inputModalities.includes('image')) capabilities.push('image.understand', 'image.edit')
  if (inputModalities.includes('audio')) capabilities.push('audio.transcribe')
  return capabilities
}

function toEffort(value: unknown): AiReasoningEffort | undefined {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ? value : undefined
}

function mapAgent(value: unknown): AiAgent | undefined {
  const model = asRecord(value)
  const id = typeof model.id === 'string' ? model.id : typeof model.model === 'string' ? model.model : undefined
  if (!id) return undefined
  const inputModalities = Array.isArray(model.inputModalities)
    ? model.inputModalities.filter((item): item is string => typeof item === 'string')
    : ['text', 'image']
  const supportedEfforts = Array.isArray(model.supportedReasoningEfforts)
    ? model.supportedReasoningEfforts
      .map((item) => toEffort(asRecord(item).reasoningEffort))
      .filter((item): item is AiReasoningEffort => item != null)
    : []
  return {
    id,
    name: typeof model.displayName === 'string' ? model.displayName : id,
    inputModalities,
    capabilities: modelCapabilities(inputModalities),
    supportedEfforts,
    contextWindow: asNumber(model.contextWindow),
    maxOutputTokens: asNumber(model.maxOutputTokens),
    defaultEffort: toEffort(model.defaultReasoningEffort),
    isDefault: model.isDefault === true,
  }
}

function mapQuotaWindow(value: unknown) {
  const window = asRecord(value)
  const usedPercent = asNumber(window.usedPercent)
  if (usedPercent == null) return undefined
  return {
    usedPercent,
    windowDurationMinutes: asNumber(window.windowDurationMins),
    resetsAt: asNumber(window.resetsAt),
  }
}

function mapQuotaBucket(value: unknown, fallbackId?: string): AiQuotaBucket | undefined {
  const bucket = asRecord(value)
  const id = typeof bucket.limitId === 'string' ? bucket.limitId : fallbackId
  if (!id) return undefined
  return {
    id,
    name: typeof bucket.limitName === 'string' ? bucket.limitName : undefined,
    primary: mapQuotaWindow(bucket.primary),
    secondary: mapQuotaWindow(bucket.secondary),
  }
}

async function readQuota(): Promise<AiProviderDescriptor['quota'] | undefined> {
  try {
    const result = await rpc('account/rateLimits/read')
    const byId = asRecord(result.rateLimitsByLimitId)
    const buckets = Object.entries(byId)
      .map(([id, value]) => mapQuotaBucket(value, id))
      .filter((item): item is AiQuotaBucket => item != null)
    if (buckets.length === 0) {
      const fallback = mapQuotaBucket(result.rateLimits)
      if (fallback) buckets.push(fallback)
    }
    const credits = asRecord(result.credits)
    return {
      buckets,
      creditsRemaining: asNumber(credits.balance) ?? asNumber(credits.remaining),
    }
  } catch {
    return undefined
  }
}

function usageMetrics(params: Record<string, unknown>): AiUsageMetric[] {
  const last = asRecord(asRecord(params.tokenUsage).last)
  const fields: Array<[string, unknown]> = [
    ['input_tokens', last.inputTokens],
    ['cached_input_tokens', last.cachedInputTokens],
    ['cache_write_input_tokens', last.cacheWriteInputTokens],
    ['output_tokens', last.outputTokens],
    ['reasoning_tokens', last.reasoningOutputTokens],
  ]
  return fields.flatMap(([kind, value]) => {
    const amount = asNumber(value)
    return amount == null ? [] : [{ kind, amount, unit: 'token' as const }]
  })
}

async function* streamCodex(request: AiProviderRequest): AsyncIterable<AiEvent> {
  await ensureBridge()
  let finish!: () => void
  const finished = new Promise<void>((resolve) => { finish = resolve })
  const queue: AiEvent[] = []
  let wake: (() => void) | undefined
  let threadId = ''
  let turnId = ''
  const push = (event: AiEvent) => {
    queue.push(event)
    wake?.()
    wake = undefined
  }
  const unsubscribe = subscribe((event) => {
    const params = asRecord(event.params)
    if (!threadId || params.threadId !== threadId) return
    if (turnId && params.turnId && params.turnId !== turnId) return
    if (event.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      push({ type: 'text.delta', runId: request.runId, delta: params.delta })
    } else if ((event.method === 'item/reasoning/summaryTextDelta' || event.method === 'item/reasoning/textDelta') && typeof params.delta === 'string') {
      push({ type: 'reasoning.delta', runId: request.runId, delta: params.delta })
    } else if (event.method === 'item/started' || event.method === 'item/completed') {
      const item = asRecord(params.item)
      push({ type: event.method === 'item/started' ? 'item.started' : 'item.completed', runId: request.runId, item: params.item })
      if (event.method === 'item/completed' && item.type === 'imageGeneration') {
        push({
          type: 'image.completed',
          runId: request.runId,
          base64: typeof item.result === 'string' ? item.result : undefined,
          path: typeof item.savedPath === 'string' ? item.savedPath : undefined,
          revisedPrompt: typeof item.revisedPrompt === 'string' ? item.revisedPrompt : undefined,
        })
      }
    } else if (event.method === 'thread/tokenUsage/updated') {
      push({ type: 'usage.updated', runId: request.runId, metrics: usageMetrics(params) })
    } else if (event.method === 'error') {
      const error = asRecord(params.error)
      push({ type: 'error', runId: request.runId, code: 'codex_error', message: String(error.message ?? 'Codex request failed') })
    } else if (event.method === 'turn/completed') {
      const turn = asRecord(params.turn)
      if (turn.status === 'failed') {
        const error = asRecord(turn.error)
        push({ type: 'error', runId: request.runId, code: 'codex_turn_failed', message: String(error.message ?? 'Codex turn failed') })
      } else {
        push({ type: 'completed', runId: request.runId, status: turn.status === 'interrupted' ? 'cancelled' : 'completed' })
      }
      finish()
    }
  })

  try {
    const unsupported = request.input.find((item) => item.type === 'localFile')
    if (unsupported) throw new Error('The Codex subscription provider does not support generic file inputs')
    const threadResult = await rpc('thread/start', {
      model: request.agentId,
      approvalPolicy: 'never',
      permissions: ':read-only',
      ephemeral: true,
      serviceName: 'hiven',
      baseInstructions: 'Follow the user request as a general AI assistant. Do not inspect files or run commands.',
    })
    threadId = String(asRecord(threadResult.thread).id ?? '')
    if (!threadId) throw new Error('Codex did not return a thread id')
    const input = request.input.map((item) => item.type === 'text' ? { ...item, text_elements: [] } : item)
    const turnResult = await rpc('turn/start', {
      threadId,
      input,
      model: request.agentId,
      effort: request.effort,
      approvalPolicy: 'never',
    })
    turnId = String(asRecord(turnResult.turn).id ?? '')
    if (!turnId) throw new Error('Codex did not return a turn id')
    activeTurns.set(request.runId, { threadId, turnId })
    yield { type: 'run.started', runId: request.runId, providerId: codexChatGptProvider.id, agentId: request.agentId }

    while (true) {
      while (queue.length > 0) yield queue.shift()!
      if (await Promise.race([finished.then(() => true), new Promise<false>((resolve) => {
        wake = () => resolve(false)
      })])) {
        while (queue.length > 0) yield queue.shift()!
        break
      }
    }
  } finally {
    activeTurns.delete(request.runId)
    unsubscribe()
  }
}

export const codexChatGptProvider: AiProviderAdapter = {
  id: 'openai-chatgpt',

  async describe(onUpdate) {
    await ensureBridge()
    const [accountResult, modelResult] = await Promise.all([
      rpc('account/read', { refreshToken: false }),
      rpc('model/list', { limit: 100, includeHidden: false }),
    ])
    const account = asRecord(accountResult.account)
    const agents = Array.isArray(modelResult.data)
      ? modelResult.data.map(mapAgent).filter((item): item is AiAgent => item != null)
      : []
    const isChatGpt = account.type === 'chatgpt'
    const capabilities = [...new Set(agents.flatMap((agent) => agent.capabilities))]
    const description = {
      id: this.id,
      kind: 'openai-chatgpt-subscription',
      name: 'OpenAI ChatGPT',
      status: isChatGpt ? 'ready' as const : 'login_required' as const,
      capabilities,
      agents,
      subscription: isChatGpt ? {
        accountName: typeof account.email === 'string' ? account.email : undefined,
        plan: typeof account.planType === 'string' ? account.planType : undefined,
      } : undefined,
    }
    onUpdate?.(description)
    return isChatGpt ? { ...description, quota: await readQuota() } : description
  },

  stream: streamCodex,

  async cancel(runId) {
    const active = activeTurns.get(runId)
    if (active) await rpc('turn/interrupt', active)
  },

  async login() {
    await ensureBridge()
    const result = await rpc('account/login/start', {
      type: 'chatgpt',
      useHostedLoginSuccessPage: true,
      appBrand: 'chatgpt',
    })
    return { url: typeof result.authUrl === 'string' ? result.authUrl : undefined }
  },

  async logout() {
    await rpc('account/logout')
  },
}
