import { invoke } from '@tauri-apps/api/core'
import { useAppStore } from '../../store'
import { requirePluginPermissions } from '../pluginPermissions'
import type { PluginPermissionSnapshot } from '../pluginTypes'
import { codexChatGptProvider } from './codexProvider'
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

const providers = new Map<string, AiProviderAdapter>([[codexChatGptProvider.id, codexChatGptProvider]])
const activeRuns = new Map<string, string>()
const BROWSER_USAGE_KEY = 'hiven-ai-usage'

export function registerAiProvider(provider: AiProviderAdapter): () => void {
  providers.set(provider.id, provider)
  return () => providers.delete(provider.id)
}

async function describeProviders(): Promise<AiProviderDescriptor[]> {
  const settings = useAppStore.getState().settings
  const descriptions = await Promise.all([...providers.values()].map(async (provider) => {
    try {
      return await provider.describe()
    } catch (error) {
      return {
        id: provider.id,
        kind: provider.id,
        name: provider.id,
        status: 'unavailable' as const,
        statusMessage: error instanceof Error ? error.message : String(error),
        capabilities: [],
        agents: [],
      }
    }
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
  const rows = readBrowserUsage().filter((item) => item.runId !== record.runId)
  localStorage.setItem(BROWSER_USAGE_KEY, JSON.stringify([record, ...rows].slice(0, 1000)))
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
      const available = await describeProviders()
      const explicitProvider = request.providerId != null
      const descriptor = explicitProvider
        ? available.find((item) => item.id === request.providerId)
        : available.find((item) => item.isDefault && item.status === 'ready')
      if (!descriptor || descriptor.status !== 'ready') {
        const runId = crypto.randomUUID()
        yield {
          type: 'error',
          runId,
          code: descriptor?.status === 'login_required' ? 'provider_login_required' : 'provider_unavailable',
          message: descriptor?.statusMessage ?? (descriptor?.status === 'login_required' ? 'The AI provider requires login' : 'No AI provider is available'),
        }
        return
      }
      const missingCapability = request.capabilities?.find((item) => !descriptor.capabilities.includes(item))
      if (missingCapability) {
        const runId = crypto.randomUUID()
        yield { type: 'error', runId, code: 'capability_unavailable', message: `AI capability is not available: ${missingCapability}` }
        return
      }
      const explicitAgent = request.agentId != null
      const configuredAgent = useAppStore.getState().settings.aiDefaultAgentId
      const agent = explicitAgent
        ? descriptor.agents.find((item) => item.id === request.agentId)
        : descriptor.agents.find((item) => item.id === configuredAgent)
          ?? descriptor.agents.find((item) => item.isDefault)
          ?? descriptor.agents[0]
      if (!agent) {
        const runId = crypto.randomUUID()
        yield { type: 'error', runId, code: 'agent_unavailable', message: 'The requested AI agent is not available' }
        return
      }
      if (request.input.length === 0) {
        const runId = crypto.randomUUID()
        yield { type: 'error', runId, code: 'invalid_request', message: 'AI input must not be empty' }
        return
      }
      const unsupportedInput = request.input.find((item) => item.type !== 'file' && !agent.inputModalities.includes(item.type))
      if (unsupportedInput) {
        const runId = crypto.randomUUID()
        yield { type: 'error', runId, code: 'input_unavailable', message: `AI input is not supported by this agent: ${unsupportedInput.type}` }
        return
      }

      const adapter = providers.get(descriptor.id)
      if (!adapter) return
      const runId = crypto.randomUUID()
      const effort = resolveEffort(request, agent)
      const input: AiProviderRequest['input'] = []
      for (const item of request.input) {
        if (item.type === 'text') input.push(item)
        else input.push({
          type: item.type === 'image' ? 'localImage' : item.type === 'audio' ? 'localAudio' : 'localFile',
          path: await blobPath(pluginSource, pluginId, item.blobId),
        })
      }
      const record: AiUsageRecord = {
        runId,
        pluginId,
        pluginSource,
        providerId: descriptor.id,
        agentId: agent.id,
        effort,
        status: 'running',
        startedAt: Date.now(),
        metrics: [],
      }
      activeRuns.set(runId, descriptor.id)
      await persistUsage(record)
      try {
        for await (const event of adapter.stream({
          runId,
          agentId: agent.id,
          effort,
          input,
          capabilities: request.capabilities,
        })) {
          if (event.type === 'usage.updated') {
            record.metrics = event.metrics
            await persistUsage(record)
          } else if (event.type === 'completed') {
            record.status = event.status === 'cancelled' ? 'cancelled' : 'completed'
            record.finishedAt = Date.now()
            await persistUsage(record)
          } else if (event.type === 'error') {
            record.status = 'failed'
            record.finishedAt = Date.now()
            await persistUsage(record)
          }
          yield event
        }
      } catch (error) {
        record.status = 'failed'
        record.finishedAt = Date.now()
        await persistUsage(record)
        yield {
          type: 'error',
          runId,
          code: 'provider_error',
          message: error instanceof Error ? error.message : String(error),
        } satisfies AiEvent
      } finally {
        activeRuns.delete(runId)
      }
    },

    async cancel(runId) {
      requireAi()
      const providerId = activeRuns.get(runId)
      if (providerId) await providers.get(providerId)?.cancel(runId)
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
  return adapter.login()
}

export async function logoutAiProvider(providerId: string): Promise<void> {
  const adapter = providers.get(providerId)
  if (!adapter?.logout) throw new Error('This provider does not support logout')
  await adapter.logout()
}

export async function listAiProviders(): Promise<AiProviderDescriptor[]> {
  return describeProviders()
}
