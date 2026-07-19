/**
 * First-party DesktopTarget provider registry with progressive collect.
 */

import {
  DESKTOP_TARGET_MAX_GLOBAL,
  DESKTOP_TARGET_MAX_PER_SOURCE,
  DESKTOP_TARGET_PROVIDER_TIMEOUT_MS,
} from './constants'
import type {
  CollectDesktopTargetsOptions,
  DesktopTarget,
  DesktopTargetProvider,
  DesktopTargetQueryContext,
  DesktopTargetSourceId,
} from './types'

const providers = new Map<DesktopTargetSourceId, DesktopTargetProvider>()

export function registerDesktopTargetProvider(provider: DesktopTargetProvider): void {
  providers.set(provider.id, provider)
}

export function unregisterDesktopTargetProvider(id: DesktopTargetSourceId): void {
  providers.delete(id)
}

export function clearDesktopTargetProviders(): void {
  providers.clear()
}

export function listDesktopTargetProviders(): DesktopTargetProvider[] {
  return [...providers.values()]
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => reject(new Error('desktop target provider timeout')), ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function isPrimaryNavAction(target: DesktopTarget): boolean {
  const action = target.actionClass ?? 'focus'
  return action === 'focus' || action === 'open'
}

/**
 * Merge source results: later write wins on same id; cap per source then global.
 */
export function mergeDesktopTargetPartials(
  bySource: Map<DesktopTargetSourceId, DesktopTarget[]>,
  maxPerSource: number,
  maxGlobal: number,
): DesktopTarget[] {
  const merged = new Map<string, DesktopTarget>()
  for (const [, list] of bySource) {
    const capped = list.filter(isPrimaryNavAction).slice(0, maxPerSource)
    for (const t of capped) {
      merged.set(t.id, t)
    }
  }
  return [...merged.values()].slice(0, maxGlobal)
}

/**
 * Collect targets from all registered providers in parallel with soft timeout,
 * failure isolation, and progressive onPartial updates.
 */
export async function collectDesktopTargets(
  ctx: DesktopTargetQueryContext,
  options: CollectDesktopTargetsOptions = {},
): Promise<DesktopTarget[]> {
  const signal = options.signal ?? ctx.signal
  const timeoutMs = options.timeoutMs ?? DESKTOP_TARGET_PROVIDER_TIMEOUT_MS
  const maxPerSource = options.maxPerSource ?? DESKTOP_TARGET_MAX_PER_SOURCE
  const maxGlobal = options.maxGlobal ?? DESKTOP_TARGET_MAX_GLOBAL
  const onPartial = options.onPartial

  const list = listDesktopTargetProviders()
  if (list.length === 0) return []

  const bySource = new Map<DesktopTargetSourceId, DesktopTarget[]>()

  await Promise.all(
    list.map(async (provider) => {
      if (signal?.aborted) {
        onPartial?.({ sourceId: provider.id, targets: [], done: true })
        return
      }

      let healthy = true
      if (provider.health) {
        try {
          const h = await provider.health()
          healthy = h.ok
        } catch {
          healthy = false
        }
      }
      if (!healthy) {
        bySource.set(provider.id, [])
        onPartial?.({ sourceId: provider.id, targets: [], done: true })
        return
      }

      try {
        const raw = await withTimeout(
          Promise.resolve(provider.list({ ...ctx, signal })),
          timeoutMs,
          signal,
        )
        const targets = (Array.isArray(raw) ? raw : [])
          .filter(isPrimaryNavAction)
          .map((t) => ({ ...t, sourceId: t.sourceId || provider.id }))
        bySource.set(provider.id, targets)
        onPartial?.({ sourceId: provider.id, targets, done: true })
      } catch {
        bySource.set(provider.id, [])
        onPartial?.({ sourceId: provider.id, targets: [], done: true })
      }
    }),
  )

  if (signal?.aborted) return []
  return mergeDesktopTargetPartials(bySource, maxPerSource, maxGlobal)
}
