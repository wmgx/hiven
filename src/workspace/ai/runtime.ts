import { invoke } from '@tauri-apps/api/core'
import { translate } from '../../i18n'
import { useAppStore } from '../../store'
import { getPluginPermissionSnapshot, requirePluginPermissions, usePluginPermissionStore } from '../pluginPermissions'
import { pluginRegistry } from '../pluginRegistry'
import type { PluginPermissionSnapshot } from '../pluginTypes'
import { measureLatency } from '../telemetry'
import { codexChatGptProvider } from './codexProvider'
import { xaiGrokProvider } from './xaiProvider'
import { ollamaLocalProvider } from './ollamaProvider'
import type {
  AiEvent,
  AiPreflightRequest,
  AiPreflightResult,
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
  [ollamaLocalProvider.id, ollamaLocalProvider],
])
type ProviderBoundary = Pick<AiProviderAdapter, 'authentication' | 'fallbackPolicy' | 'strictInputModalities'>
// Built-in local-routing intent outlives a replaceable adapter or its registration.
const builtinProviderBoundaries = new Map<string, Readonly<ProviderBoundary>>(
  [...providers.values()].filter((provider) => provider.fallbackPolicy === 'never').map((provider) => [provider.id, Object.freeze({
    authentication: provider.authentication,
    fallbackPolicy: provider.fallbackPolicy,
    strictInputModalities: provider.strictInputModalities,
  })] as const),
)

function providerBoundary(providerId: string, adapter: ProviderBoundary | undefined = providers.get(providerId)): ProviderBoundary {
  return builtinProviderBoundaries.get(providerId) ?? {
    authentication: adapter?.authentication,
    fallbackPolicy: adapter?.fallbackPolicy,
    strictInputModalities: adapter?.strictInputModalities,
  }
}

function neverFallback(providerId: string | undefined, adapter?: ProviderBoundary): boolean {
  return providerId != null && providerBoundary(providerId, adapter).fallbackPolicy === 'never'
}

function providerDescriptor(adapter: AiProviderAdapter, value: Omit<AiProviderDescriptor, 'isDefault'>): AiProviderDescriptor {
  const boundary = providerBoundary(adapter.id, adapter)
  return {
    ...value, id: adapter.id, isDefault: false,
    ...(boundary.authentication != null ? { authentication: boundary.authentication } : {}),
    ...(boundary.fallbackPolicy != null ? { fallbackPolicy: boundary.fallbackPolicy } : {}),
  }
}
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
type PreflightMetadata = { value: AiProviderDescriptor; checkedAt: number; timedOut?: boolean }
const preflightCache = new Map<string, PreflightMetadata>()
const preflightInFlight = new Map<string, Promise<PreflightMetadata>>()
const providerRevisions = new Map<string, number>()
const preflightListeners = new Set<() => void>()

function diagnostic(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function unavailableProvider(adapter: ProviderBoundary & { id: string }, error: unknown): AiProviderDescriptor {
  const message = diagnostic(error)
  const providerId = adapter.id
  const boundary = providerBoundary(providerId, adapter)
  return {
    id: providerId, kind: providerId, name: providerId, status: 'unavailable',
    authentication: boundary.authentication, fallbackPolicy: boundary.fallbackPolicy,
    // Native startup failures can mix missing files, permission failures and other causes.
    // Preserve the diagnostic, but only classify evidence with an unambiguous meaning.
    statusReason: message === 'Codex App Server requires the desktop app' ? 'desktop_required' : 'metadata_unavailable',
    statusMessage: boundary.authentication === 'none'
      ? translate(useAppStore.getState().locale, 'settings', 'aiProviderUnavailable') : message,
    capabilities: [], agents: [], isDefault: false,
  }
}

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
  preflightCache.delete(providerId)
  preflightInFlight.delete(providerId)
  providerRevisions.set(providerId, (providerRevisions.get(providerId) ?? 0) + 1)
  for (const listener of preflightListeners) listener()
}

export function registerAiProvider(provider: AiProviderAdapter): () => void {
  providers.set(provider.id, provider)
  invalidateProvider(provider.id)
  return () => {
    if (providers.get(provider.id) !== provider) return
    providers.delete(provider.id)
    invalidateProvider(provider.id)
  }
}

function preflightSelection(request: AiPreflightRequest) {
  const settings = useAppStore.getState().settings
  const providerId = request.providerId ?? settings.aiDefaultProviderId
  const requiresBinding = neverFallback(providerId)
  const overridesProvider = request.providerId != null && request.providerId !== settings.aiDefaultProviderId
  const agentId = request.agentId ?? (requiresBinding && overridesProvider ? undefined : settings.aiDefaultAgentId)
  const requiresExplicitAgent = requiresBinding && agentId == null
  const effort = request.effort && request.effort !== 'inherit' ? request.effort : settings.aiDefaultEffort
  const key = JSON.stringify([providerId, agentId, effort, providerRevisions.get(providerId ?? '') ?? 0, requiresExplicitAgent])
  return { providerId, agentId, effort, requiresExplicitAgent, key }
}

/** This cache is exclusively for metadata preflight. Running a model always rechecks describe(). */
function describeForPreflight(provider: AiProviderAdapter, forceRefresh: boolean): Promise<PreflightMetadata> {
  const pending = preflightInFlight.get(provider.id)
  if (pending) return pending
  const cached = preflightCache.get(provider.id)
  if (!forceRefresh && cached && Date.now() - cached.checkedAt < PROVIDER_CACHE_MS) return Promise.resolve(cached)
  const revision = providerRevisions.get(provider.id)
  let partial: AiProviderDescriptor | undefined
  let work!: Promise<PreflightMetadata>
  work = (async () => {
    let metadata: PreflightMetadata
    try {
      const value = await withTimeout(measureLatency(
        'latency:ai.provider.preflight',
        () => provider.describe((update) => { partial = providerDescriptor(provider, update) }),
        { providerId: provider.id },
      ), PROVIDER_TIMEOUT_MS)
      metadata = { value: providerDescriptor(provider, value), checkedAt: Date.now() }
    } catch (error) {
      metadata = {
        value: partial ?? unavailableProvider(provider, error), checkedAt: Date.now(),
        timedOut: !partial && diagnostic(error) === 'AI_PROVIDER_TIMEOUT',
      }
    }
    // Login, logout or replacement during an await must not repopulate a newer account's cache.
    if (providers.get(provider.id) === provider && providerRevisions.get(provider.id) === revision) {
      preflightCache.set(provider.id, metadata)
    }
    return metadata
  })().finally(() => {
    if (preflightInFlight.get(provider.id) === work) preflightInFlight.delete(provider.id)
  })
  preflightInFlight.set(provider.id, work)
  return work
}

async function preflight(request: AiPreflightRequest, signal: AbortSignal): Promise<AiPreflightResult> {
  throwIfAborted(signal)
  const selection = preflightSelection(request)
  const result: AiPreflightResult = {
    status: 'unknown', reason: 'metadata_unavailable', checkedAt: Date.now(),
    providerId: selection.providerId, agentId: selection.agentId, selectionKey: selection.key,
  }
  if (!selection.providerId) return { ...result, status: 'blocked', reason: 'provider_not_configured' }
  const adapter = providers.get(selection.providerId)
  if (!adapter) return { ...result, status: 'blocked', reason: 'provider_not_registered' }
  if (selection.requiresExplicitAgent) {
    return {
      ...result, status: 'blocked', reason: 'agent_unknown',
      message: translate(useAppStore.getState().locale, 'settings', 'aiAgentRequired'),
    }
  }
  let selectionChanged = false
  const unwatchSelection = useAppStore.subscribe(() => {
    if (preflightSelection(request).key !== selection.key) selectionChanged = true
  })
  let metadata: PreflightMetadata
  try {
    metadata = await withSignal(describeForPreflight(adapter, request.forceRefresh === true), signal)
  } finally {
    unwatchSelection()
  }
  result.checkedAt = metadata.checkedAt
  if (selectionChanged || preflightSelection(request).key !== selection.key) return { ...result, reason: 'configuration_changed' }
  const provider = metadata.value
  result.providerName = provider.name
  result.message = provider.statusMessage
  const agent = selection.agentId != null
    ? provider.agents.find((item) => item.id === selection.agentId)
    : provider.agents.find((item) => item.isDefault) ?? provider.agents[0]
  if (agent) {
    result.agentId = agent.id
    result.agentName = agent.name
    result.effort = selection.effort && agent.supportedEfforts.includes(selection.effort)
      ? selection.effort : agent.defaultEffort
  }
  result.selectionKey = JSON.stringify([selection.key, result.agentId, result.effort])
  if (provider.status === 'login_required') return { ...result, status: 'blocked', reason: 'provider_login_required' }
  if (provider.status === 'unavailable') {
    if (provider.statusReason === 'desktop_required' || provider.statusReason === 'cli_missing') {
      return { ...result, status: 'blocked', reason: provider.statusReason }
    }
    return {
      ...result, status: neverFallback(adapter.id, adapter) ? 'blocked' : 'unknown',
      reason: metadata.timedOut || provider.statusReason === 'metadata_timeout' ? 'metadata_timeout' : 'metadata_unavailable',
    }
  }
  if (provider.modelCatalog === 'fallback') return { ...result, reason: 'model_catalog_fallback' }
  if (provider.modelCatalog === 'partial' && !agent) return { ...result, reason: 'model_catalog_incomplete' }
  if (provider.modelCatalog !== 'complete' && provider.modelCatalog !== 'partial') return { ...result, reason: 'model_catalog_unknown' }
  // A missing catalogue entry cannot prove that a selected model is unusable.
  if (!agent) return { ...result, status: neverFallback(adapter.id, adapter) ? 'blocked' : 'unknown', reason: 'agent_unknown' }
  if (request.capabilities?.some((capability) => !provider.capabilities.includes(capability) || !agent.capabilities.includes(capability))) {
    return { ...result, status: 'blocked', reason: 'capability_unavailable' }
  }
  if (request.inputModalities?.some((modality) => !agent.inputModalities.includes(modality))) {
    return { ...result, status: 'blocked', reason: 'input_unavailable' }
  }
  return { ...result, status: 'ready', reason: 'configuration_ready' }
}

async function describeProviders(
  onProvider?: (provider: AiProviderDescriptor, completed: number, total: number, index: number) => void,
  onlyProviderId?: string,
): Promise<AiProviderDescriptor[]> {
  const configuredProviderId = useAppStore.getState().settings.aiDefaultProviderId
  // Registry changes during discovery cannot erase the selected provider's policy.
  const configuredNeverFallback = neverFallback(configuredProviderId)
  const adapters = [...providers.values()].filter((provider) => onlyProviderId == null || provider.id === onlyProviderId)
  let completed = 0
  const descriptions = await Promise.all(adapters.map(async (provider, index) => {
    const cached = providerCache.get(provider.id)
    if (cached && Date.now() - cached.cachedAt < PROVIDER_CACHE_MS) onProvider?.(cached.value, completed, adapters.length, index)
    let description: AiProviderDescriptor
    let partialDescription: AiProviderDescriptor | undefined
    try {
      const publish = (partial: Omit<AiProviderDescriptor, 'isDefault'>) => {
        const value = providerDescriptor(provider, partial)
        partialDescription = value
        providerCache.set(provider.id, { value, cachedAt: Date.now() })
        onProvider?.(value, completed, adapters.length, index)
      }
      description = providerDescriptor(provider, await withTimeout(measureLatency(
          'latency:ai.provider.describe',
          () => provider.describe(publish),
          { providerId: provider.id },
        ), PROVIDER_TIMEOUT_MS))
    } catch (error) {
      description = partialDescription ?? unavailableProvider(provider, error)
    }
    const current = providers.get(provider.id) === provider
    if (!current && neverFallback(provider.id, provider)) description = unavailableProvider(provider, 'AI_PROVIDER_CHANGED')
    if (current) providerCache.set(provider.id, { value: description, cachedAt: Date.now() })
    completed += 1
    onProvider?.(description, completed, adapters.length, index)
    return description
  }))
  // Keep a removed built-in local provider visible, including its configured selection.
  for (const providerId of builtinProviderBoundaries.keys()) {
    if (descriptions.some((item) => item.id === providerId) || (onlyProviderId != null && providerId !== onlyProviderId)) continue
    const missing = unavailableProvider({ id: providerId }, 'AI_PROVIDER_NOT_REGISTERED')
    descriptions.push(missing)
    onProvider?.(missing, descriptions.length, descriptions.length, descriptions.length - 1)
  }
  const configured = descriptions.find((item) => item.id === configuredProviderId)
  const effectiveDefault = configuredNeverFallback
    ? configured
    : descriptions.find((item) => item.id === configuredProviderId && item.status === 'ready')
      ?? descriptions.find((item) => item.status === 'ready' && !neverFallback(item.id))
      ?? configured
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
  const definition = pluginRegistry.getPluginDefinition(pluginId, pluginSource)
  const requireAi = () => {
    // The captured snapshot is a ceiling; a later grant cannot expand this handle.
    requirePluginPermissions(permissions, ['ai.use'])
    if (definition && pluginRegistry.getPluginDefinition(pluginId, pluginSource) !== definition) {
      throw new Error('Plugin permission required: ai.use')
    }
    const requested = definition ? pluginRegistry.getPluginPermissions(pluginId, pluginSource) : ['ai.use'] as const
    requirePluginPermissions(getPluginPermissionSnapshot(pluginSource, pluginId, requested), ['ai.use'])
  }
  const watchAi = (onRevoked: (reason: unknown) => void) => {
    const check = () => {
      try { requireAi() } catch (error) { onRevoked(error) }
    }
    const unwatchPermissions = usePluginPermissionStore.subscribe(check)
    const unwatchDefinition = definition ? pluginRegistry.subscribe(check) : undefined
    return () => { unwatchPermissions(); unwatchDefinition?.() }
  }
  const withAi = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    requireAi()
    const controller = new AbortController()
    // Abort latches revocation even if permission is granted again before the await settles.
    const unwatch = watchAi((reason) => controller.abort(reason))
    try {
      const result = await withSignal(work(controller.signal), controller.signal)
      throwIfAborted(controller.signal)
      requireAi()
      return result
    } finally {
      unwatch()
    }
  }

  return {
    async providers() {
      return withAi(() => describeProviders())
    },

    async preflight(request = {}) {
      // Copy only metadata fields. Extra JS properties are never forwarded or retained.
      return withAi((signal) => preflight({
        providerId: request.providerId, agentId: request.agentId, effort: request.effort,
        capabilities: request.capabilities?.slice(), inputModalities: request.inputModalities?.slice(),
        forceRefresh: request.forceRefresh,
      }, signal))
    },

    subscribePreflight(listener) {
      const identity = () => {
        let allowed = true
        try { requireAi() } catch { allowed = false }
        const settings = useAppStore.getState().settings
        return JSON.stringify([settings.aiDefaultProviderId, settings.aiDefaultAgentId, settings.aiDefaultEffort, allowed])
      }
      let previous = identity()
      const changed = () => {
        const next = identity()
        if (next === previous) return
        previous = next
        listener()
      }
      const unwatchSettings = useAppStore.subscribe(changed)
      const unwatchPermissions = usePluginPermissionStore.subscribe(changed)
      const unwatchRegistry = pluginRegistry.subscribe(changed)
      preflightListeners.add(listener)
      return () => {
        unwatchSettings(); unwatchPermissions(); unwatchRegistry()
        preflightListeners.delete(listener)
      }
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
      let unwatch = () => {}
      const checkPermission = () => {
        throwIfAborted(signal)
        requireAi()
      }
      const detach = () => {
        unwatch()
        request.signal?.removeEventListener('abort', abortExternal)
        activeRuns.delete(runId)
      }
      const persistRecord = () => {
        if (!record) return usageWrite
        const snapshot = { ...record, metrics: record.metrics.map((metric) => ({ ...metric })) }
        // Keep a delayed running upsert from overwriting a newer terminal record.
        usageWrite = usageWrite.then(() => persistUsage(snapshot))
        return usageWrite
      }
      const finishRecord = (status: AiUsageRecord['status']) => {
        if (!record || record.status !== 'running') return usageWrite
        record.status = status
        record.finishedAt = Date.now()
        return persistRecord()
      }
      const cancelProvider = () => {
        if (!providerStarted || !adapter) return Promise.resolve()
        cancellation ??= withTimeout(
          Promise.resolve().then(() => adapter!.cancel(runId)), RUN_CLEANUP_TIMEOUT_MS,
        ).catch(() => undefined)
        return cancellation
      }
      const abort = (reason?: unknown) => {
        if (terminal) return
        controller.abort(reason)
        detach()
        // A consumer may remain suspended at yield; finalize usage without waiting for its next().
        void finishRecord('cancelled')
        void cancelProvider()
      }
      const abortExternal = () => abort(request.signal?.reason)
      unwatch = watchAi(abort)
      request.signal?.addEventListener('abort', abortExternal, { once: true })
      if (request.signal?.aborted) abortExternal()
      const finish = async (status: AiUsageRecord['status']) => {
        terminal = true
        detach()
        const writing = finishRecord(status)
        // Cancellation must not wait for an already pending storage operation.
        if (!signal.aborted) await writing
      }
      try {
        checkPermission()
        const initialConfiguredProviderId = useAppStore.getState().settings.aiDefaultProviderId
        const selection = preflightSelection(request)
        const initialProviderId = selection.providerId
        const initialAgentId = selection.agentId
        const initialAdapter = providers.get(initialProviderId ?? '')
        // A missing configured provider cannot authorize a different provider.
        if (initialProviderId != null && !initialAdapter) {
          await finish('failed')
          yield { type: 'error', runId, code: 'provider_unavailable', message: translate(useAppStore.getState().locale, 'settings', 'aiProviderUnavailable') }
          return
        }
        const pinnedAdapter = neverFallback(initialProviderId, initialAdapter) ? initialAdapter : undefined
        if (selection.requiresExplicitAgent) {
          await finish('failed')
          yield { type: 'error', runId, code: 'agent_required', message: translate(useAppStore.getState().locale, 'settings', 'aiAgentRequired') }
          return
        }
        const discoveryAdapters = new Map(providers)
        const available = await withSignal(describeProviders(undefined, request.providerId), signal)
        checkPermission()
        if (pinnedAdapter && providers.get(pinnedAdapter.id) !== pinnedAdapter) {
          await finish('failed')
          yield { type: 'error', runId, code: 'provider_unavailable', message: translate(useAppStore.getState().locale, 'settings', 'aiProviderUnavailable') }
          return
        }
        const explicitProvider = request.providerId != null
        const descriptor = pinnedAdapter
          ? available.find((item) => item.id === pinnedAdapter.id)
          : explicitProvider
          ? available.find((item) => item.id === request.providerId)
          : available.find((item) => item.isDefault)
        if (!descriptor || descriptor.status !== 'ready') {
          await finish('failed')
          yield {
            type: 'error', runId,
            code: descriptor?.status === 'login_required' ? 'provider_login_required' : 'provider_unavailable',
            message: descriptor?.statusMessage ?? (descriptor?.status === 'login_required'
              ? 'The AI provider requires login' : translate(useAppStore.getState().locale, 'settings', 'aiProviderUnavailable')),
          }
          return
        }
        adapter = providers.get(descriptor.id)
        if (!adapter) throw new Error('The selected AI provider is no longer available')
        const requiresModelBinding = neverFallback(descriptor.id, adapter)
        if (requiresModelBinding && discoveryAdapters.get(descriptor.id) !== adapter) {
          await finish('failed')
          yield { type: 'error', runId, code: 'provider_unavailable', message: translate(useAppStore.getState().locale, 'settings', 'aiProviderUnavailable') }
          return
        }
        const configuredAgent = requiresModelBinding
          ? descriptor.id === initialConfiguredProviderId ? initialAgentId : undefined
          : useAppStore.getState().settings.aiDefaultAgentId
        const selectedAgent = request.agentId ?? configuredAgent
        if (requiresModelBinding && selectedAgent == null) {
          await finish('failed')
          yield { type: 'error', runId, code: 'agent_required', message: translate(useAppStore.getState().locale, 'settings', 'aiAgentRequired') }
          return
        }
        const agent = request.agentId != null || requiresModelBinding
          ? descriptor.agents.find((item) => item.id === selectedAgent)
          : descriptor.agents.find((item) => item.id === configuredAgent)
            ?? descriptor.agents.find((item) => item.isDefault)
            ?? descriptor.agents[0]
        if (!agent) {
          await finish('failed')
          yield { type: 'error', runId, code: 'agent_unavailable', message: translate(useAppStore.getState().locale, 'settings', 'aiAgentUnavailable') }
          return
        }
        const missingCapability = request.capabilities?.find((item) => !descriptor.capabilities.includes(item) || !agent.capabilities.includes(item))
        if (missingCapability) {
          await finish('failed')
          yield { type: 'error', runId, code: 'capability_unavailable', message: translate(useAppStore.getState().locale, 'settings', 'aiCapabilityUnavailable') }
          return
        }
        if (request.input.length === 0) {
          await finish('failed')
          yield { type: 'error', runId, code: 'invalid_request', message: 'AI input must not be empty' }
          return
        }
        const strictInputModalities = providerBoundary(adapter.id, adapter).strictInputModalities
        const unsupportedInput = request.input.find((item) => (item.type !== 'file' || strictInputModalities)
          && !agent.inputModalities.includes(item.type))
        if (unsupportedInput) {
          await finish('failed')
          yield { type: 'error', runId, code: 'input_unavailable', message: translate(useAppStore.getState().locale, 'settings', 'aiInputUnavailable') }
          return
        }
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
          checkPermission()
          if (item.type === 'text') input.push(item)
          else input.push({
            type: item.type === 'image' ? 'localImage' : item.type === 'audio' ? 'localAudio' : 'localFile',
            path: await withSignal(blobPath(pluginSource, pluginId, item.blobId), signal),
          })
        }
        checkPermission()
        providerStarted = true
        iterator = adapter.stream({ runId, agentId: agent.id, effort, input, capabilities: request.capabilities, signal })[Symbol.asyncIterator]()
        while (true) {
          checkPermission()
          const next = await withSignal(Promise.resolve(iterator.next()), signal)
          checkPermission()
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
            checkPermission()
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
        detach()
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
      return withAi(() => readUsage(pluginId, pluginSource, query))
    },
  }
}

export async function loginAiProvider(providerId: string): Promise<{ url?: string; verificationCode?: string }> {
  const adapter = providers.get(providerId)
  if (!adapter?.login) throw new Error('This provider does not support login')
  invalidateProvider(providerId)
  try { return await adapter.login() } finally { invalidateProvider(providerId) }
}

export async function logoutAiProvider(providerId: string): Promise<void> {
  const adapter = providers.get(providerId)
  if (!adapter?.logout) throw new Error('This provider does not support logout')
  invalidateProvider(providerId)
  try { await adapter.logout() } finally { invalidateProvider(providerId) }
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
