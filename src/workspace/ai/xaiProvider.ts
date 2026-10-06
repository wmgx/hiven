import { Channel, invoke } from '@tauri-apps/api/core'
import type { AiAgent, AiCapability, AiEvent, AiProviderAdapter, AiProviderRequest, AiQuotaBucket, AiUsageMetric } from './types'

type XaiDescription = { status: 'ready' | 'login_required'; models: unknown[]; user?: unknown; billing?: unknown }

const FALLBACK_MODELS = [
  { id: 'grok-composer-2.5-fast', context_window: 200_000, max_output_tokens: 30_000 },
  { id: 'grok-build', context_window: 500_000, max_output_tokens: 30_000 },
  { id: 'grok-4.6', context_window: 500_000, max_output_tokens: 131_072 },
  { id: 'grok-4.5', context_window: 500_000, max_output_tokens: 131_072 },
  { id: 'grok-4.3', context_window: 1_000_000, max_output_tokens: 131_072 },
  { id: 'grok-4.20-0309-reasoning', context_window: 2_000_000, max_output_tokens: 131_072 },
  { id: 'grok-4.20-0309-non-reasoning', context_window: 2_000_000, max_output_tokens: 131_072 },
  { id: 'grok-4.20-multi-agent-0309', context_window: 2_000_000, max_output_tokens: 131_072 },
]

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function supportsEffort(id: string): boolean {
  return ['grok-3-mini', 'grok-4.20-multi-agent', 'grok-4.3', 'grok-4.5', 'grok-4.6']
    .some((prefix) => id.toLowerCase().startsWith(prefix))
}

export function mapAgent(value: unknown): AiAgent | undefined {
  const model = asRecord(value)
  const id = typeof model.id === 'string' ? model.id : undefined
  if (!id) return undefined
  const inputModalities = Array.isArray(model.input_modalities)
    ? model.input_modalities.filter((item): item is string => item === 'text' || item === 'image')
    : ['text', 'image']
  const capabilities: AiCapability[] = ['text.generate', 'web.search', 'tool.call']
  if (inputModalities.includes('image')) capabilities.push('image.understand')
  return {
    id,
    name: typeof model.name === 'string' ? model.name : id,
    capabilities,
    inputModalities,
    supportedEfforts: supportsEffort(id) ? ['low', 'medium', 'high', 'xhigh'] : [],
    contextWindow: asNumber(model.context_window) ?? asNumber(model.context_length),
    maxOutputTokens: asNumber(model.max_output_tokens),
    defaultEffort: supportsEffort(id) ? 'medium' : undefined,
  }
}

function usageMetrics(value: unknown): AiUsageMetric[] {
  const usage = asRecord(value)
  return ([
    ['input_tokens', usage.input_tokens],
    ['output_tokens', usage.output_tokens],
    ['reasoning_tokens', asRecord(usage.output_tokens_details).reasoning_tokens],
  ] as const).flatMap(([kind, amount]) => typeof amount === 'number'
    ? [{ kind, amount, unit: 'token' as const }]
    : [])
}

export function mapStreamEvent(value: unknown, runId: string): AiEvent[] {
  const event = asRecord(value)
  const type = typeof event.type === 'string' ? event.type : ''
  if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
    return [{ type: 'text.delta', runId, delta: event.delta }]
  }
  if ((type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') && typeof event.delta === 'string') {
    return [{ type: 'reasoning.delta', runId, delta: event.delta }]
  }
  if (type === 'response.output_item.added') return [{ type: 'item.started', runId, item: event.item }]
  if (type === 'response.output_item.done') return [{ type: 'item.completed', runId, item: event.item }]
  if (type === 'hiven.cancelled') return [{ type: 'completed', runId, status: 'cancelled' }]
  if (type === 'response.completed') {
    const metrics = usageMetrics(asRecord(event.response).usage)
    return [
      ...(metrics.length ? [{ type: 'usage.updated' as const, runId, metrics }] : []),
      { type: 'completed', runId, status: 'completed' },
    ]
  }
  if (type === 'response.failed' || type === 'error') {
    const error = asRecord(event.error)
    return [{ type: 'error', runId, code: 'xai_response_failed', message: String(error.message ?? event.message ?? 'Grok request failed') }]
  }
  return []
}

async function* streamXai(request: AiProviderRequest): AsyncIterable<AiEvent> {
  const unsupported = request.input.find((item) => item.type !== 'text' && item.type !== 'localImage')
  if (unsupported) throw new Error('The Grok subscription provider supports text and image inputs')
  yield { type: 'run.started', runId: request.runId, providerId: xaiGrokProvider.id, agentId: request.agentId }

  const queue: AiEvent[] = []
  let wake: (() => void) | undefined
  let done = false
  const channel = new Channel<unknown>()
  channel.onmessage = (raw) => {
    for (const event of mapStreamEvent(raw, request.runId)) queue.push(event)
    wake?.()
    wake = undefined
  }
  const invocation = invoke('ai_xai_response_stream', {
    runId: request.runId,
    model: request.agentId,
    input: request.input,
    effort: request.effort ?? null,
    webSearch: request.capabilities?.includes('web.search') ?? false,
    onEvent: channel,
  }).catch((error) => {
    queue.push({ type: 'error', runId: request.runId, code: 'xai_error', message: String(error) })
  }).finally(() => {
    done = true
    wake?.()
  })

  while (!done || queue.length) {
    while (queue.length) yield queue.shift()!
    if (!done) await new Promise<void>((resolve) => { wake = resolve })
  }
  await invocation
}

export function quotaFromBilling(value: unknown): { buckets: AiQuotaBucket[] } | undefined {
  const config = asRecord(asRecord(value).config)
  const overallPercent = asNumber(config.creditUsagePercent)
  const period = asRecord(config.currentPeriod)
  const start = typeof period.start === 'string' ? Date.parse(period.start) : NaN
  const end = typeof period.end === 'string'
    ? Date.parse(period.end)
    : typeof config.billingPeriodEnd === 'string' ? Date.parse(config.billingPeriodEnd) : NaN
  const window = (usedPercent: number) => ({
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: Number.isFinite(end) ? end : undefined,
    windowDurationMinutes: Number.isFinite(start) && Number.isFinite(end) ? Math.round((end - start) / 60_000) : undefined,
  })
  const buckets: AiQuotaBucket[] = overallPercent == null
    ? []
    : [{ id: 'grok-subscription', primary: window(overallPercent) }]
  if (Array.isArray(config.productUsage)) {
    for (const entry of config.productUsage) {
      const product = asRecord(entry)
      const id = typeof product.product === 'string' ? product.product : undefined
      const percent = asNumber(product.usagePercent)
      if (id && percent != null) buckets.push({ id, name: id, primary: window(percent) })
    }
  }
  return buckets.length ? { buckets } : undefined
}

export const xaiGrokProvider: AiProviderAdapter = {
  id: 'xai-grok',

  async describe() {
    const description = await invoke<XaiDescription>('ai_xai_describe')
    const models = description.models.length ? description.models : FALLBACK_MODELS
    const agents = models.map(mapAgent).filter((item): item is AiAgent => item != null)
    const user = asRecord(description.user)
    const billing = asRecord(description.billing)
    return {
      id: this.id,
      kind: 'xai-grok-subscription',
      name: 'xAI Grok',
      status: description.status,
      capabilities: [...new Set(agents.flatMap((agent) => agent.capabilities))],
      agents,
      subscription: description.status === 'ready' ? {
        accountName: typeof user.email === 'string' ? user.email : undefined,
        plan: typeof billing.subscriptionTier === 'string' ? billing.subscriptionTier : 'SuperGrok / X Premium',
      } : undefined,
      quota: quotaFromBilling(description.billing),
    }
  },

  stream: streamXai,

  async cancel(runId) {
    await invoke('ai_xai_cancel', { runId })
  },

  async login() {
    return invoke<{ url?: string; verificationCode?: string }>('ai_xai_login_start')
  },

  async logout() {
    await invoke('ai_xai_logout')
  },
}
