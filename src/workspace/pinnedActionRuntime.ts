import type { PinnedAction } from '../store'

export type Disposable = {
  dispose: () => void
}

export type PinnedRuntimeStatus = 'cold' | 'loading' | 'active' | 'idle' | 'disposing' | 'disposed'

export type PinnedRuntime = {
  pinnedId: string
  status: PinnedRuntimeStatus
  inputModelId?: string
  outputModelId?: string
  inputEditorId?: string
  outputEditorId?: string
  controlPanelInstanceId?: string
  disposables: Disposable[]
  lastActivatedAt: number
  lastInteractedAt: number
  pendingRunId?: string
}

export type PinnedTombstone = {
  pinnedId: string
  actionId: string
  inputText: string
  params: Record<string, unknown>
  autoRun: boolean
  debounceMs: number
  controlsOpen: boolean
  controlPanelState?: Record<string, unknown>
  inputViewState?: unknown
  outputViewState?: unknown
  outputSummary?: {
    kind: 'empty' | 'text' | 'error' | 'stale'
    preview?: string
    hash?: string
    generatedAt?: number
  }
  lastRunAt?: number
  lastDurationMs?: number
  lastError?: string
  disposedAt: number
  reason: 'idle-timeout' | 'memory-pressure' | 'manual' | 'navigation'
}

export type PinnedRuntimeConfig = {
  idleTimeoutMs: number
  maxWarmRuntimes: number
}

export const DEFAULT_PINNED_RUNTIME_CONFIG: PinnedRuntimeConfig = {
  idleTimeoutMs: 5 * 60 * 1000,
  maxWarmRuntimes: 3,
}

export function ensurePinnedRuntime(
  pinned: PinnedAction,
  runtime?: PinnedRuntime,
  tombstone?: PinnedTombstone
): PinnedRuntime {
  return activatePinnedRuntime(pinned, runtime, tombstone)
}

export function activatePinnedRuntime(
  pinned: PinnedAction,
  runtime?: PinnedRuntime,
  tombstone?: PinnedTombstone
): PinnedRuntime {
  const now = Date.now()
  if (runtime && runtime.status !== 'disposed' && runtime.status !== 'disposing') {
    return {
      ...runtime,
      status: 'active',
      lastActivatedAt: now,
      lastInteractedAt: now,
    }
  }
  return {
    pinnedId: pinned.id,
    status: 'active',
    inputModelId: `pinned-input:${pinned.id}`,
    outputModelId: `pinned-output:${pinned.id}`,
    inputEditorId: `pinned-input-editor:${pinned.id}`,
    outputEditorId: `pinned-output-editor:${pinned.id}`,
    controlPanelInstanceId: (pinned.controlsOpen || tombstone?.controlsOpen) ? pinned.controlPanelInstanceId : undefined,
    disposables: [],
    lastActivatedAt: now,
    lastInteractedAt: now,
  }
}

export function restorePinnedFromTombstone(pinned: PinnedAction, tombstone?: PinnedTombstone): PinnedAction {
  if (!tombstone) return pinned
  const stalePreview = tombstone.outputSummary?.preview
  return {
    ...pinned,
    inputText: tombstone.inputText,
    params: tombstone.params,
    autoRun: tombstone.autoRun,
    debounceMs: tombstone.debounceMs,
    controlsOpen: tombstone.controlsOpen,
    outputText: stalePreview ? `Previous result preview (stale): ${stalePreview}` : '',
    outputKind: tombstone.outputSummary?.kind === 'error' ? 'error' : stalePreview ? 'stale' : 'text',
    lastRunAt: tombstone.lastRunAt,
    lastDurationMs: tombstone.lastDurationMs,
    lastError: tombstone.lastError,
  }
}

export function disposePinnedRuntime(runtime: PinnedRuntime): PinnedRuntime {
  for (const disposable of runtime.disposables) {
    try {
      disposable.dispose()
    } catch {
      // Best-effort cleanup; stale runtime state should not block navigation.
    }
  }
  return {
    ...runtime,
    status: 'disposed',
    inputEditorId: undefined,
    outputEditorId: undefined,
    inputModelId: undefined,
    outputModelId: undefined,
    controlPanelInstanceId: undefined,
    disposables: [],
    pendingRunId: undefined,
  }
}

export function releasePinnedRuntime(runtime: PinnedRuntime): PinnedRuntime {
  return disposePinnedRuntime(runtime)
}

export function tombstonePinnedRuntime(
  pinned: PinnedAction,
  runtime: PinnedRuntime,
  reason: PinnedTombstone['reason']
): PinnedTombstone {
  const outputKind = pinned.outputText
    ? pinned.outputKind
    : pinned.lastError
      ? 'error'
      : 'empty'
  return {
    pinnedId: pinned.id,
    actionId: pinned.actionId,
    inputText: pinned.inputText,
    params: pinned.params,
    autoRun: pinned.autoRun,
    debounceMs: pinned.debounceMs,
    controlsOpen: pinned.controlsOpen,
    outputSummary: {
      kind: pinned.lastError ? 'error' : pinned.outputText ? (outputKind === 'presentation' ? 'text' : outputKind) : 'stale',
      preview: pinned.outputText.slice(0, 240),
      generatedAt: pinned.lastRunAt,
    },
    lastRunAt: pinned.lastRunAt,
    lastDurationMs: pinned.lastDurationMs,
    lastError: pinned.lastError,
    disposedAt: Date.now(),
    reason,
  }
}

export function pruneIdlePinnedRuntimes(
  runtimes: Record<string, PinnedRuntime>,
  activePinnedId: string | null,
  config: PinnedRuntimeConfig = DEFAULT_PINNED_RUNTIME_CONFIG,
  now = Date.now()
): string[] {
  const idle = Object.values(runtimes)
    .filter((runtime) => (
      runtime.pinnedId !== activePinnedId &&
      runtime.status === 'idle' &&
      !runtime.pendingRunId
    ))
    .sort((a, b) => a.lastInteractedAt - b.lastInteractedAt)

  const timedOut = idle
    .filter((runtime) => now - runtime.lastInteractedAt > config.idleTimeoutMs)
    .map((runtime) => runtime.pinnedId)

  const warm = Object.values(runtimes)
    .filter((runtime) => runtime.status === 'active' || runtime.status === 'idle')
  const overflowCount = Math.max(0, warm.length - config.maxWarmRuntimes)
  const overflow = idle
    .filter((runtime) => !timedOut.includes(runtime.pinnedId))
    .slice(0, overflowCount)
    .map((runtime) => runtime.pinnedId)

  return [...timedOut, ...overflow]
}
