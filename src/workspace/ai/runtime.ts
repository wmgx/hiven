import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store'
import { requirePluginPermissions } from '../pluginPermissions'
import type { PluginPermissionSnapshot } from '../pluginTypes'
import { measureLatency } from '../telemetry'
import { codexChatGptProvider } from './codexProvider'
import { xaiGrokProvider } from './xaiProvider'
import type {
  AiEvent,
  AiProviderAdapter,
  AiProviderDescriptor,
  AiProviderRequest,
  AiReasoningEffort,
  AiRequest,
  AiUsageQuery,
  AiUsageRecord,
  PluginAiApi,
} from './types'

const providers = new Map<string, AiProviderAdapter>([
  [codexChatGptProvider.id, codexChatGptProvider],
  [xaiGrokProvider.id, xaiGrokProvider],
])
const activeRuns = new Map<string, {
  pluginId: string
  pluginSource: AiUsageRecord['pluginSource']
  cancel: () => Promise<void>
}>()
const BROWSER_USAGE_KEY = 'hiven-ai-usage'
const PROVIDER_TIMEOUT_MS = 10_000
const PROVIDER_CACHE_MS = 60_000
const RUN_CLEANUP_TIMEOUT_MS = 1_000
const providerCache = new Map<string, { value: AiProviderDescriptor; cachedAt: number }>()

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('AI_PROVIDER_TIMEOUT')), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error) },
    )
  })
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('AI request cancelled')
}

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
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

function invalidateProvider(providerId: string): void {
  providerCache.delete(providerId)
}

export function registerAiProvider(provider: AiProviderAdapter): () => void {
  providers.set(provider.id, provider)
  return () => providers.delete(provider.id)
}

async function describeProviders(
  onProvider?: (provider: AiProviderDescriptor, completed: number, total: number, index: number) => void,
  onlyProviderId?: string,
): Promise<AiProviderDescriptor[]> {
  const settings = useAppStore.getState().settings
  const adapters = [...providers.values()].filter((provider) => onlyProviderId == null || provider.id === onlyProviderId)
  let completed = 0
  const descriptions = await Promise.all(adapters.map(async (provider, index) => {
    const cached = providerCache.get(provider.id)
    if (cached && Date.now() - cached.cachedAt < PROVIDER_CACHE_MS) onProvider?.(cached.value, completed, adapters.length, index)
    let description: AiProviderDescriptor
    let partialDescription: AiProviderDescriptor | undefined
    try {
      const publish = (partial: Omit<AiProviderDescriptor, 'isDefault'>) => {
        const value = { ...partial, isDefault: false }
        partialDescription = value
        providerCache.set(provider.id, { value, cachedAt: Date.now() })
        onProvider?.(value, completed, adapters.length, index)
      }
      description = {
        ...await withTimeout(measureLatency(
          'latency:ai.provider.describe',
          () => provider.describe(publish),
          { providerId: provider.id },
        ), PROVIDER_TIMEOUT_MS),
        isDefault: false,
      }
    } catch (error) {
      description = partialDescription ?? {
        id: provider.id,
        kind: provider.id,
        name: provider.id,
        status: 'unavailable' as const,
        statusMessage: error instanceof Error && error.message !== 'AI_PROVIDER_TIMEOUT' ? error.message : undefined,
        capabilities: [],
        agents: [],
        isDefault: false,
      }
    }
    providerCache.set(provider.id, { value: description, cachedAt: Date.now() })
    completed += 1
    onProvider?.(description, completed, adapters.length, index)
    return description
  }))
  const effectiveDefault = descriptions.find((item) => item.id === settings.aiDefaultProviderId && item.status === 'ready')
    ?? descriptions.find((item) => item.status === 'ready')
    ?? descriptions.find((item) => item.id === settings.aiDefaultProviderId)
  return descriptions.map((item) => ({ ...item, isDefault: item.id === effectiveDefault?.id }))
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

async function blobPath(source: string, pluginId: string, blobId: string): Promise<string> {
  if (!isTauri()) throw new Error('AI blob inputs require the desktop app')
  const path = await invoke<string | null>('plugin_blob_path', { source, pluginId, blobId })
  if (!path) throw new Error(`AI input blob not found: ${blobId}`)
  return path
}

async function persistUsage(record: AiUsageRecord): Promise<void> {
  if (isTauri()) {
    await invoke('ai_usage_record_upsert', { record }).catch((error) => {
      console.warn('[hiven] Failed to persist AI usage:', error)
    })
    return
  }
  try {
    const rows = readBrowserUsage().filter((item) => item.runId !== record.runId)
    localStorage.setItem(BROWSER_USAGE_KEY, JSON.stringify([record, ...rows].slice(0, 1000)))
  } catch (error) {
    console.warn('[hiven] Failed to persist AI usage:', error)
  }
}

function readBrowserUsage(): AiUsageRecord[] {
  try {
    const value = JSON.parse(localStorage.getItem(BROWSER_USAGE_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

async function readUsage(pluginId: string, pluginSource: string, query?: AiUsageQuery): Promise<AiUsageRecord[]> {
  if (isTauri()) {
    return invoke<AiUsageRecord[]>('ai_usage_record_list', {
      pluginId,
      pluginSource,
      providerId: query?.providerId ?? null,
      since: query?.since ?? null,
      limit: query?.limit ?? 100,
    })
  }
  return readBrowserUsage()
    .filter((item) => item.pluginId === pluginId && item.pluginSource === pluginSource)
    .filter((item) => !query?.providerId || item.providerId === query.providerId)
    .filter((item) => !query?.since || item.startedAt >= query.since)
    .slice(0, query?.limit ?? 100)
}

function resolveEffort(
  request: AiRequest,
  agent: AiProviderDescriptor['agents'][number],
): AiReasoningEffort | undefined {
  const configured = useAppStore.getState().settings.aiDefaultEffort
  const requested = request.effort && request.effort !== 'inherit' ? request.effort : configured
  if (requested && agent.supportedEfforts.includes(requested)) return requested
  return agent.defaultEffort
}

export function createPluginAi(
  pluginId: string,
  pluginSource: 'builtin' | 'installed' | 'dev',
  permissions: PluginPermissionSnapshot,
): PluginAiApi {
  const requireAi = () => requirePluginPermissions(permissions, ['ai.use'])

  return {
    async providers() {
      requireAi()
      return describeProviders()
    },

    async *stream(request) {
      requireAi()
      const runId = crypto.randomUUID()
      const controller = new AbortController()
      const signal = controller.signal
      let adapter: AiProviderAdapter | undefined
      let iterator: AsyncIterator<AiEvent> | undefined
      let record: AiUsageRecord | undefined
      let terminal = false
      let providerStarted = false
      let cancellation: Promise<void> | undefined
      let usageWrite = Promise.resolve()
      const persistRecord = () => {
        if (!record) return usageWrite
        const snapshot = { ...record, metrics: record.metrics.map((metric) => ({ ...metric })) }
        // Keep a delayed running upsert from overwriting a newer terminal record.
        usageWrite = usageWrite.then(() => persistUsage(snapshot))
        return usageWrite
      }
      const cancelProvider = () => {
        if (!providerStarted || !adapter) return Promise.resolve()
        cancellation ??= withTimeout(
          Promise.resolve().then(() => adapter!.cancel(runId)), RUN_CLEANUP_TIMEOUT_MS,
        ).catch(() => undefined)
        return cancellation
      }
      const abort = () => {
        if (terminal) return
        controller.abort(request.signal?.reason)
        void cancelProvider()
      }
      request.signal?.addEventListener('abort', abort, { once: true })
      if (request.signal?.aborted) abort()
      const finish = async (status: AiUsageRecord['status']) => {
        terminal = true
        activeRuns.delete(runId)
        if (record) {
          record.status = status
          record.finishedAt = Date.now()
          const writing = persistRecord()
          // Cancellation must not wait for an already pending storage operation.
          if (!signal.aborted) await writing
        }
      }
      try {
        throwIfAborted(signal)
        const available = await withSignal(describeProviders(undefined, request.providerId), signal)
        throwIfAborted(signal)
        const explicitProvider = request.providerId != null
        const descriptor = explicitProvider
          ? available.find((item) => item.id === request.providerId)
          : available.find((item) => item.isDefault && item.status === 'ready')
        if (!descriptor || descriptor.status !== 'ready') {
          await finish('failed')
          yield {
            type: 'error', runId,
            code: descriptor?.status === 'login_required' ? 'provider_login_required' : 'provider_unavailable',
            message: descriptor?.statusMessage ?? (descriptor?.status === 'login_required' ? 'The AI provider requires login' : 'No AI provider is available'),
          }
          return
        }
        const missingCapability = request.capabilities?.find((item) => !descriptor.capabilities.includes(item))
        if (missingCapability) {
          await finish('failed')
          yield { type: 'error', runId, code: 'capability_unavailable', message: `AI capability is not available: ${missingCapability}` }
          return
        }
        const configuredAgent = useAppStore.getState().settings.aiDefaultAgentId
        const agent = request.agentId != null
          ? descriptor.agents.find((item) => item.id === request.agentId)
          : descriptor.agents.find((item) => item.id === configuredAgent)
            ?? descriptor.agents.find((item) => item.isDefault)
            ?? descriptor.agents[0]
        if (!agent) {
          await finish('failed')
          yield { type: 'error', runId, code: 'agent_unavailable', message: 'The requested AI agent is not available' }
          return
        }
        if (request.input.length === 0) {
          await finish('failed')
          yield { type: 'error', runId, code: 'invalid_request', message: 'AI input must not be empty' }
          return
        }
        const unsupportedInput = request.input.find((item) => item.type !== 'file' && !agent.inputModalities.includes(item.type))
        if (unsupportedInput) {
          await finish('failed')
          yield { type: 'error', runId, code: 'input_unavailable', message: `AI input is not supported by this agent: ${unsupportedInput.type}` }
          return
        }
        adapter = providers.get(descriptor.id)
        if (!adapter) throw new Error('The selected AI provider is no longer available')
        const effort = resolveEffort(request, agent)
        record = {
          runId, pluginId, pluginSource, providerId: descriptor.id, agentId: agent.id,
          effort, status: 'running', startedAt: Date.now(), metrics: [],
        }
        activeRuns.set(runId, {
          pluginId, pluginSource,
          cancel: () => {
            abort()
            return cancelProvider()
          },
        })
        await withSignal(persistRecord(), signal)
        const input: AiProviderRequest['input'] = []
        for (const item of request.input) {
          throwIfAborted(signal)
          if (item.type === 'text') input.push(item)
          else input.push({
            type: item.type === 'image' ? 'localImage' : item.type === 'audio' ? 'localAudio' : 'localFile',
            path: await withSignal(blobPath(pluginSource, pluginId, item.blobId), signal),
          })
        }
        throwIfAborted(signal)
        providerStarted = true
        iterator = adapter.stream({ runId, agentId: agent.id, effort, input, capabilities: request.capabilities, signal })[Symbol.asyncIterator]()
        while (true) {
          throwIfAborted(signal)
          const next = await withSignal(Promise.resolve(iterator.next()), signal)
          throwIfAborted(signal)
          if (next.done) {
            await finish('failed')
            void cancelProvider()
            yield { type: 'error', runId, code: 'provider_incomplete', message: 'The AI stream ended without a terminal event' }
            return
          }
          const event = next.value
          if (event.runId !== runId) continue
          if (event.type === 'usage.updated') {
            record.metrics = event.metrics
            await withSignal(persistRecord(), signal)
            throwIfAborted(signal)
          } else if (event.type === 'completed' || event.type === 'error') {
            await finish(event.type === 'error' ? 'failed' : event.status)
            if (record.status !== 'completed') void cancelProvider()
            yield event
            return
          }
          yield event
        }
      } catch (error) {
        if (!terminal) {
          const cancelled = signal.aborted
          await finish(cancelled ? 'cancelled' : 'failed')
          void cancelProvider()
          yield cancelled
            ? { type: 'completed', runId, status: 'cancelled' }
            : { type: 'error', runId, code: 'provider_error', message: error instanceof Error ? error.message : String(error) }
        }
      } finally {
        request.signal?.removeEventListener('abort', abort)
        if (!terminal) await finish('cancelled')
        // Cancel before closing the iterator: return() alone can wait behind a pending next().
        if (record?.status !== 'completed') {
          controller.abort()
          await cancelProvider()
        }
        try {
          if (iterator?.return) await withTimeout(Promise.resolve(iterator.return()), RUN_CLEANUP_TIMEOUT_MS)
        } catch { /* Cleanup must not replace a committed terminal result or block the caller indefinitely. */ }
        activeRuns.delete(runId)
      }
    },

    async cancel(runId) {
      requireAi()
      const active = activeRuns.get(runId)
      if (active?.pluginId === pluginId && active.pluginSource === pluginSource) await active.cancel()
    },

    async usage(query) {
      requireAi()
      return readUsage(pluginId, pluginSource, query)
    },
  }
}

export async function loginAiProvider(providerId: string): Promise<{ url?: string; verificationCode?: string }> {
  const adapter = providers.get(providerId)
  if (!adapter?.login) throw new Error('This provider does not support login')
  invalidateProvider(providerId)
  return adapter.login()
}

export async function logoutAiProvider(providerId: string): Promise<void> {
  const adapter = providers.get(providerId)
  if (!adapter?.logout) throw new Error('This provider does not support logout')
  await adapter.logout()
  invalidateProvider(providerId)
}

export async function listAiProviders(
  onProvider?: (provider: AiProviderDescriptor, completed: number, total: number, index: number) => void,
): Promise<AiProviderDescriptor[]> {
  return describeProviders(onProvider)
}

export async function refreshAiProvider(
  providerId: string,
  onProvider?: (provider: AiProviderDescriptor, completed: number, total: number, index: number) => void,
): Promise<AiProviderDescriptor | undefined> {
  invalidateProvider(providerId)
  return (await describeProviders(onProvider, providerId))[0]
}
