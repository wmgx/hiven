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

type RpcEvent = { method: string; params?: Record<string, unknown>; _hivenConnectionId: string }
type RpcResult = Record<string, unknown>

const subscribers = new Set<(event: RpcEvent) => void>()
const activeTurns = new Map<string, () => Promise<void>>()
let listenerPromise: Promise<void> | undefined
let bridgePromise: Promise<string> | undefined
let bridgeConnectionId: string | undefined
const closedConnections = new Set<string>()

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('AI request cancelled')
}

function withSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort)
      reject(signal.reason ?? new Error('AI request cancelled'))
    }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value) },
      (error) => { signal.removeEventListener('abort', abort); reject(error) },
    )
    if (signal.aborted) abort()
  })
}

function connectionId(result: RpcResult): string {
  const id = result._hivenConnectionId
  if (typeof id !== 'string' || !id) throw new Error('Codex did not return a connection id')
  return id
}

function invalidateBridge(id?: string): void {
  if (id && bridgeConnectionId !== id) return
  bridgePromise = undefined
  bridgeConnectionId = undefined
}

function checkConnection(id: string): void {
  if (closedConnections.has(id)) throw new Error('HIVEN_CODEX_CONNECTION_CHANGED')
}

async function ensureBridge(signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal)
  if (!isTauri()) throw new Error('Codex App Server requires the desktop app')
  listenerPromise ??= listen<RpcEvent>('hiven://ai-codex-event', ({ payload }) => {
    if (payload.method === 'hiven/transport/closed' && payload._hivenConnectionId) {
      closedConnections.add(payload._hivenConnectionId)
      invalidateBridge(payload._hivenConnectionId)
    }
    for (const subscriber of subscribers) subscriber(payload)
  }).then(() => undefined).catch((error) => {
    listenerPromise = undefined
    throw error
  })
  await withSignal(listenerPromise, signal)
  throwIfAborted(signal)
  // Initialization is shared. Cancelling this waiter must not corrupt other runs' handshake.
  if (!bridgePromise) {
    let initializing!: Promise<string>
    initializing = (async () => {
      const result = await rpc('initialize', {
        clientInfo: { name: 'hiven', title: 'Hiven', version: '0.2.57' },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }, false)
      const id = connectionId(result)
      checkConnection(id)
      if (bridgePromise !== initializing) throw new Error('HIVEN_CODEX_CONNECTION_CHANGED')
      bridgeConnectionId = id
      await invoke('ai_codex_notify', { method: 'initialized', params: {}, expectedConnectionId: id })
      checkConnection(id)
      if (bridgePromise !== initializing) throw new Error('HIVEN_CODEX_CONNECTION_CHANGED')
      return id
    })().catch((error) => {
      // A late failure from an old handshake cannot clear a replacement handshake.
      if (bridgePromise === initializing) invalidateBridge()
      throw error
    })
    bridgePromise = initializing
  }
  const id = await withSignal(bridgePromise, signal)
  throwIfAborted(signal)
  checkConnection(id)
  return id
}

async function rpc(
  method: string,
  params?: unknown,
  initialize = true,
  signal?: AbortSignal,
  expectedConnectionId?: string,
): Promise<RpcResult> {
  throwIfAborted(signal)
  let id = expectedConnectionId ?? (initialize ? await ensureBridge(signal) : undefined)
  const send = async () => {
    throwIfAborted(signal)
    if (id) checkConnection(id)
    const result = await invoke<RpcResult>('ai_codex_rpc', { method, params: params ?? null, expectedConnectionId: id ?? null })
    const returnedId = connectionId(result)
    if (id && returnedId !== id) throw new Error('HIVEN_CODEX_CONNECTION_CHANGED')
    checkConnection(returnedId)
    return result
  }
  try {
    return await send()
  } catch (error) {
    throwIfAborted(signal)
    const changed = String(error).includes('HIVEN_CODEX_INITIALIZATION_REQUIRED') || String(error).includes('HIVEN_CODEX_CONNECTION_CHANGED')
    // A bound thread/turn must never be replayed into a replacement process.
    if (!initialize || expectedConnectionId || !changed) throw error
    invalidateBridge(id)
    id = await ensureBridge(signal)
    throwIfAborted(signal)
    return send()
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
  const controller = new AbortController()
  const signal = controller.signal
  const queue: AiEvent[] = []
  let wake: (() => void) | undefined
  let threadId = ''
  let turnId = ''
  let runConnectionId = ''
  let transportFailure: Extract<AiEvent, { type: 'error' }> | undefined
  let finishStartup!: () => void
  const terminalReady = new Promise<void>((resolve) => { finishStartup = resolve })
  let terminal: 'completed' | 'cancelled' | 'failed' | undefined
  let closed = false
  let interruption: Promise<void> | undefined
  const interrupt = () => {
    if (!threadId || !turnId || !runConnectionId) return Promise.resolve()
    interruption ??= rpc('turn/interrupt', { threadId, turnId }, true, undefined, runConnectionId).then(() => undefined, () => undefined)
    return interruption
  }
  const push = (event: AiEvent) => {
    if (closed || terminal) return
    if (event.type === 'completed') terminal = event.status
    else if (event.type === 'error') terminal = 'failed'
    if (terminal) finishStartup()
    queue.push(event)
    wake?.()
    wake = undefined
  }
  const cancel = () => {
    // A queued terminal is already authoritative, including an error before startup returns.
    if (closed || terminal) return Promise.resolve()
    controller.abort(request.signal?.reason)
    if (!terminal) {
      queue.length = 0
      push({ type: 'completed', runId: request.runId, status: 'cancelled' })
    }
    return interrupt()
  }
  const abort = () => { void cancel() }
  request.signal?.addEventListener('abort', abort, { once: true })
  activeTurns.set(request.runId, cancel)
  if (request.signal?.aborted) abort()
  const unsubscribe = subscribe((event) => {
    if (signal.aborted || closed || terminal) return
    if (!runConnectionId || event._hivenConnectionId !== runConnectionId) return
    const params = asRecord(event.params)
    if (event.method === 'hiven/transport/closed') {
      transportFailure = { type: 'error', runId: request.runId, code: 'codex_transport_closed', message: String(params.message ?? 'Codex App Server stopped') }
      push(transportFailure)
      return
    }
    if (!threadId || params.threadId !== threadId) return
    const eventTurnId = params.turnId ?? asRecord(params.turn).id
    if (turnId && eventTurnId && eventTurnId !== turnId) return
    if (event.method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      push({ type: 'text.delta', runId: request.runId, delta: params.delta })
    } else if ((event.method === 'item/reasoning/summaryTextDelta' || event.method === 'item/reasoning/textDelta') && typeof params.delta === 'string') {
      push({ type: 'reasoning.delta', runId: request.runId, delta: params.delta })
    } else if (event.method === 'item/started' || event.method === 'item/completed') {
      const item = asRecord(params.item)
      push({ type: event.method === 'item/started' ? 'item.started' : 'item.completed', runId: request.runId, item: params.item })
      if (event.method === 'item/completed' && item.type === 'imageGeneration') {
        push({
          type: 'image.completed', runId: request.runId,
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
    }
  })

  try {
    throwIfAborted(signal)
    await ensureBridge(signal)
    throwIfAborted(signal)
    const unsupported = request.input.find((item) => item.type === 'localFile')
    if (unsupported) throw new Error('The Codex subscription provider does not support generic file inputs')
    const threadResult = await withSignal(rpc('thread/start', {
      model: request.agentId,
      approvalPolicy: 'never',
      permissions: ':read-only',
      ephemeral: true,
      serviceName: 'hiven',
      baseInstructions: 'Follow the user request as a general AI assistant. Do not inspect files or run commands.',
    }, true, signal), signal)
    throwIfAborted(signal)
    runConnectionId = connectionId(threadResult)
    checkConnection(runConnectionId)
    threadId = String(asRecord(threadResult.thread).id ?? '')
    if (!threadId) throw new Error('Codex did not return a thread id')
    const input = request.input.map((item) => item.type === 'text' ? { ...item, text_elements: [] } : item)
    const startingTurn = rpc('turn/start', {
      threadId, input, model: request.agentId, effort: request.effort, approvalPolicy: 'never',
    }, true, signal, runConnectionId).then((result) => {
      turnId = String(asRecord(result.turn).id ?? '')
      // The RPC may create a turn after the cancelled caller has already left.
      if ((signal.aborted || closed) && terminal !== 'completed') void interrupt()
      return result
    })
    // Notifications may precede the turn/start RPC response, including its terminal event.
    await Promise.race([withSignal(startingTurn, signal), terminalReady])
    throwIfAborted(signal)
    if (!turnId && !terminal) throw new Error('Codex did not return a turn id')
    if (!transportFailure) yield { type: 'run.started', runId: request.runId, providerId: codexChatGptProvider.id, agentId: request.agentId }
    while (true) {
      while (queue.length > 0) yield queue.shift()!
      if (terminal) break
      await new Promise<void>((resolve) => { wake = resolve })
    }
  } catch (error) {
    if (!signal.aborted) {
      if (!transportFailure) throw error
      yield transportFailure
      return
    }
    // Startup cancellation has no run.started event, but still has one terminal event.
    yield { type: 'completed', runId: request.runId, status: 'cancelled' }
  } finally {
    closed = true
    activeTurns.delete(request.runId)
    request.signal?.removeEventListener('abort', abort)
    unsubscribe()
    if (terminal !== 'completed') {
      controller.abort()
      void interrupt()
    }
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
    await activeTurns.get(runId)?.()
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
