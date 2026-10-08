import { Channel, invoke } from '@tauri-apps/api/core'
import { translate } from '../../i18n'
import { useAppStore } from '../../store'
import type { AiEvent, AiProviderAdapter, AiProviderDescriptor, AiProviderRequest, AiUsageMetric } from './types'

type OllamaStatusReason = 'service_unreachable' | 'metadata_timeout' | 'metadata_invalid' | 'models_empty' | 'models_unsupported'
type OllamaDescription = {
  models: Array<{ id: string; digest: string }>
  statusReason: OllamaStatusReason | null
  complete: boolean
}

const activeRuns = new Map<string, () => Promise<void>>()
const errorKeys: Record<string, string> = {
  OLLAMA_SERVICE_UNREACHABLE: 'ollamaStatus_service_unreachable',
  OLLAMA_METADATA_TIMEOUT: 'ollamaStatus_metadata_timeout',
  OLLAMA_METADATA_INVALID: 'ollamaStatus_metadata_invalid',
  OLLAMA_MODEL_UNAVAILABLE: 'ollamaErrorModelUnavailable',
  OLLAMA_INPUT_UNSUPPORTED: 'ollamaErrorInputUnsupported',
  OLLAMA_INPUT_TOO_LARGE: 'ollamaErrorInputTooLarge',
  OLLAMA_TIMEOUT: 'ollamaErrorTimeout',
  OLLAMA_HTTP_ERROR: 'ollamaErrorHttp',
  OLLAMA_STREAM_INVALID: 'ollamaErrorStreamInvalid',
  OLLAMA_STREAM_INCOMPLETE: 'ollamaErrorStreamIncomplete',
  OLLAMA_STREAM_TOO_LARGE: 'ollamaErrorStreamTooLarge',
  OLLAMA_TOOL_CALL_UNSUPPORTED: 'ollamaErrorToolCallUnsupported',
  OLLAMA_OUTPUT_TRUNCATED: 'ollamaErrorOutputTruncated',
  OLLAMA_CHANNEL_CLOSED: 'ollamaErrorChannelClosed',
}

function message(key: string): string {
  return translate(useAppStore.getState().locale, 'settings', key)
}

function streamError(runId: string, error: unknown): Extract<AiEvent, { type: 'error' }> {
  const candidate = error instanceof Error ? error.message : error
  // Never expose an arbitrary native exception or a local server's response body.
  const code = typeof candidate === 'string' && Object.hasOwn(errorKeys, candidate) ? candidate : 'OLLAMA_ERROR'
  return { type: 'error', runId, code, message: message(errorKeys[code] ?? 'ollamaErrorGeneric') }
}

function mapEvent(raw: unknown, runId: string): AiEvent {
  if (raw && typeof raw === 'object') {
    const event = raw as Record<string, unknown>
    if ((event.type === 'text.delta' || event.type === 'reasoning.delta') && typeof event.delta === 'string') {
      return { type: event.type, runId, delta: event.delta }
    }
    if (event.type === 'completed' && (event.status === 'completed' || event.status === 'cancelled')) {
      return { type: 'completed', runId, status: event.status }
    }
    if (event.type === 'usage.updated' && Array.isArray(event.metrics) && event.metrics.every((value) => {
      if (!value || typeof value !== 'object') return false
      const metric = value as AiUsageMetric
      return (metric.kind === 'input_tokens' || metric.kind === 'output_tokens')
        && Number.isSafeInteger(metric.amount) && metric.amount >= 0 && metric.unit === 'token'
    })) {
      return { type: 'usage.updated', runId, metrics: event.metrics.map(({ kind, amount, unit }) => ({ kind, amount, unit })) }
    }
  }
  return streamError(runId, 'OLLAMA_STREAM_INVALID')
}

function streamOllama(request: AiProviderRequest): AsyncIterable<AiEvent> {
  return {
    [Symbol.asyncIterator]() {
      const queue: AiEvent[] = []
      let wake: (() => void) | undefined
      let closed = false
      let started = false
      let terminal: 'completed' | 'cancelled' | 'failed' | undefined
      let terminalDelivered = false
      let cancellation: Promise<void> | undefined
      let channel: Channel<unknown> | undefined
      const notify = () => { wake?.(); wake = undefined }
      const cancelNative = () => {
        if (!started) return Promise.resolve()
        cancellation ??= invoke('ai_ollama_cancel', { runId: request.runId }).then(() => undefined, () => undefined)
        return cancellation
      }
      const push = (event: AiEvent) => {
        if (closed || terminal) return
        if (event.type === 'completed') terminal = event.status
        else if (event.type === 'error') terminal = 'failed'
        queue.push(event)
        notify()
      }
      const cancel = () => {
        if (closed || terminalDelivered) return Promise.resolve()
        // Cancellation wins over every buffered event until a terminal event is consumed.
        queue.length = 0
        terminal = 'cancelled'
        queue.push({ type: 'completed', runId: request.runId, status: 'cancelled' })
        detach()
        notify()
        return cancelNative()
      }
      const abort = () => { void cancel() }
      const detach = () => {
        request.signal?.removeEventListener('abort', abort)
        if (activeRuns.get(request.runId) === cancel) activeRuns.delete(request.runId)
        if (channel) channel.onmessage = () => {}
      }
      const close = () => {
        if (!terminalDelivered) void cancel()
        closed = true
        queue.length = 0
        notify()
      }

      const iterate = async function* (): AsyncGenerator<AiEvent> {
        request.signal?.addEventListener('abort', abort, { once: true })
        activeRuns.set(request.runId, cancel)
        if (request.signal?.aborted) abort()
        try {
          if (!terminal) {
            if (!request.input.length || request.input.some((item) => item.type !== 'text')
              || request.capabilities?.some((capability) => capability !== 'text.generate')) {
              push(streamError(request.runId, 'OLLAMA_INPUT_UNSUPPORTED'))
            } else {
              yield { type: 'run.started', runId: request.runId, providerId: ollamaLocalProvider.id, agentId: request.agentId }
            }
          }
          // The consumer can return or abort while suspended at run.started.
          if (!terminal && !closed) {
            channel = new Channel<unknown>()
            channel.onmessage = (raw) => {
              if (!closed && !terminal) push(mapEvent(raw, request.runId))
            }
            started = true
            // Set started before invoke: cancellation can race the native run registration.
            void invoke('ai_ollama_chat_stream', {
              runId: request.runId, model: request.agentId, input: request.input, onEvent: channel,
            }).catch((error) => {
              push(streamError(request.runId, error))
            }).finally(() => {
              if (!terminal) push(streamError(request.runId, 'OLLAMA_STREAM_INCOMPLETE'))
              notify()
            })
          }
          while (!closed) {
            while (queue.length && !closed) {
              const event = queue.shift()!
              if (event.type === 'completed' || event.type === 'error') terminalDelivered = true
              yield event
            }
            if (terminal || closed) break
            await new Promise<void>((resolve) => { wake = resolve })
          }
        } catch (error) {
          if (!closed && !terminalDelivered) {
            terminal = 'failed'
            terminalDelivered = true
            yield streamError(request.runId, error)
          }
        } finally {
          closed = true
          detach()
          if (terminal !== 'completed') void cancelNative()
        }
      }
      const iterator = iterate()
      return {
        next: () => iterator.next(),
        // Wake a pending next() before calling return(), which otherwise queues behind it.
        return: () => { close(); return iterator.return(undefined) },
        throw: (error: unknown) => { close(); return iterator.throw(error) },
      }
    },
  }
}

export const ollamaLocalProvider: AiProviderAdapter = {
  id: 'ollama-local',
  authentication: 'none',
  fallbackPolicy: 'never',
  strictInputModalities: true,

  async describe() {
    const base = {
      id: this.id, kind: 'ollama-local', name: 'Ollama',
      authentication: 'none' as const, fallbackPolicy: 'never' as const,
      capabilities: ['text.generate'] as const,
    }
    if (typeof window === 'undefined' || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      return {
        ...base, capabilities: [...base.capabilities], status: 'unavailable', agents: [], modelCatalog: 'unknown',
        statusReason: 'desktop_required', statusMessage: message('ollamaStatus_desktop_required'),
      }
    }
    let description: OllamaDescription
    try {
      description = await invoke<OllamaDescription>('ai_ollama_describe')
    } catch (error) {
      const failure = streamError('', error)
      return {
        ...base, capabilities: [...base.capabilities], status: 'unavailable', agents: [], modelCatalog: 'unknown',
        statusReason: 'metadata_unavailable', statusMessage: failure.message,
      }
    }
    const reason = description.statusReason ?? (description.models.length ? undefined : 'models_empty')
    const result: Omit<AiProviderDescriptor, 'isDefault'> = {
      ...base, capabilities: [...base.capabilities],
      status: description.models.length ? 'ready' : 'unavailable',
      modelCatalog: description.complete ? 'complete' : description.models.length ? 'partial' : 'unknown',
      statusReason: reason,
      statusMessage: reason ? message(`ollamaStatus_${reason}`) : message('ollamaStatus_ready'),
      agents: description.models.map(({ id }) => ({
        id, name: id, capabilities: ['text.generate'], inputModalities: ['text'], supportedEfforts: [],
      })),
    }
    return result
  },

  stream: streamOllama,

  async cancel(runId) {
    await activeRuns.get(runId)?.()
  },
}
