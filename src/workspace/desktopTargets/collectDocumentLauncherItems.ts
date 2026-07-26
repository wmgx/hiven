/**
 * Progressive collect for slow / remote Desktop Target document providers
 * (e.g. feishu.docs via lark-cli). Isolated from bridge tabs and host apps/windows
 * so typing stays responsive.
 */

import type { Locale } from '../../i18n'
import type { LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { launcherPerfNow, logLauncherPerf, logLauncherPerfDuration } from '../launcher/perf'
import { listDesktopTargetProviders } from './registry'
import { desktopTargetToLauncherItem } from './toLauncherItem'
import type { DesktopTarget, DesktopTargetProvider, DesktopTargetQueryContext } from './types'

const EXCLUDED_SOURCE_IDS = new Set(['browser.chromium', 'host.window'])

export type DocumentTargetsPartialUpdate = {
  sourceId: string
  items: LauncherItem[]
  done: boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => reject(new Error('document target provider timeout')), ms)
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

/**
 * Providers that are not host window / browser-tab bridge — typically remote CLI
 * document sources registered by plugins.
 */
export function listDocumentDesktopTargetProviders(): DesktopTargetProvider[] {
  return listDesktopTargetProviders().filter((p) => !EXCLUDED_SOURCE_IDS.has(p.id))
}

function isOpenableTarget(t: DesktopTarget): boolean {
  const action = t.actionClass ?? 'focus'
  return action === 'focus' || action === 'open'
}

/**
 * Collect document Desktop Targets progressively.
 * Each provider is isolated; onPartial fires as soon as one finishes.
 */
export async function getDesktopDocumentLauncherDynamicItems(
  ctx: {
    query: string
    locale: Locale
    surfaceId: LauncherSurfaceId
    signal?: AbortSignal
  },
  options: {
    onPartial?: (update: DocumentTargetsPartialUpdate) => void
    /** Soft timeout fallback when provider does not set listTimeoutMs. */
    defaultTimeoutMs?: number
    maxPerSource?: number
  } = {},
): Promise<LauncherItem[]> {
  if (ctx.surfaceId !== 'global-launcher') return []
  if (!ctx.query.trim()) return []
  if (ctx.signal?.aborted) return []

  const providers = listDocumentDesktopTargetProviders()
  logLauncherPerf('document-target:collect-start', {
    queryLength: ctx.query.trim().length,
    providerCount: providers.length,
    providerIds: providers.map((p) => p.id),
  })
  if (providers.length === 0) return []

  const defaultTimeoutMs = options.defaultTimeoutMs ?? 8000
  const maxPerSource = options.maxPerSource ?? 20
  const queryCtx: DesktopTargetQueryContext = {
    query: ctx.query,
    locale: ctx.locale,
    surfaceId: ctx.surfaceId,
    signal: ctx.signal,
  }

  const bySource = new Map<string, LauncherItem[]>()
  const collectStartedAt = launcherPerfNow()

  await Promise.all(
    providers.map(async (provider) => {
      if (ctx.signal?.aborted) {
        options.onPartial?.({ sourceId: provider.id, items: [], done: true })
        return
      }

      const timeoutMs = provider.listTimeoutMs ?? defaultTimeoutMs
      const providerStartedAt = launcherPerfNow()

      try {
        if (provider.health) {
          const healthStartedAt = launcherPerfNow()
          const h = await provider.health()
          logLauncherPerfDuration('document-target:provider-health', healthStartedAt, {
            sourceId: provider.id,
            ok: h.ok,
          })
          if (!h.ok) {
            bySource.set(provider.id, [])
            options.onPartial?.({ sourceId: provider.id, items: [], done: true })
            return
          }
        }

        const listStartedAt = launcherPerfNow()
        const raw = await withTimeout(
          Promise.resolve(provider.list(queryCtx)),
          timeoutMs,
          ctx.signal,
        )
        logLauncherPerfDuration('document-target:provider-list', listStartedAt, {
          sourceId: provider.id,
          timeoutMs,
          rawCount: Array.isArray(raw) ? raw.length : -1,
        })
        if (ctx.signal?.aborted) {
          logLauncherPerfDuration('document-target:provider-total', providerStartedAt, {
            sourceId: provider.id,
            aborted: true,
          })
          return
        }

        const targets = (Array.isArray(raw) ? raw : [])
          .filter(isOpenableTarget)
          .map((t) => ({ ...t, sourceId: t.sourceId || provider.id }))
          // Prefer document-like nav targets from plugin sources
          .filter((t) => t.kind === 'document' || t.kind === 'tab' || Boolean(t.meta?.url))
          .slice(0, maxPerSource)

        const items = targets.map((target) =>
          desktopTargetToLauncherItem(target, {
            locale: ctx.locale,
            provider,
            activate: provider.activate
              ? (t, c) => provider.activate!(t, c)
              : undefined,
          }),
        )
        bySource.set(provider.id, items)
        logLauncherPerfDuration('document-target:provider-total', providerStartedAt, {
          sourceId: provider.id,
          itemCount: items.length,
        })
        const partialStartedAt = launcherPerfNow()
        options.onPartial?.({ sourceId: provider.id, items, done: true })
        logLauncherPerfDuration('document-target:onPartial', partialStartedAt, {
          sourceId: provider.id,
          itemCount: items.length,
        })
      } catch (error) {
        bySource.set(provider.id, [])
        logLauncherPerfDuration('document-target:provider-total', providerStartedAt, {
          sourceId: provider.id,
          failed: true,
          timedOut: error instanceof Error && /timeout/i.test(error.message),
          aborted: error instanceof DOMException && error.name === 'AbortError',
          message: error instanceof Error ? error.message : String(error),
        })
        if (!ctx.signal?.aborted) {
          options.onPartial?.({ sourceId: provider.id, items: [], done: true })
        }
      }
    }),
  )

  if (ctx.signal?.aborted) {
    logLauncherPerfDuration('document-target:collect-total', collectStartedAt, {
      aborted: true,
      providerCount: providers.length,
    })
    return []
  }
  const all = [...bySource.values()].flat()
  logLauncherPerfDuration('document-target:collect-total', collectStartedAt, {
    providerCount: providers.length,
    itemCount: all.length,
  })
  return all
}
