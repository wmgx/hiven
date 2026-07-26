/**
 * Collect D3 desktop bridge targets (browser tabs) → LauncherItem for host dynamic path.
 *
 * IMPORTANT: only runs the browser.chromium provider. Must not call collectDesktopTargets()
 * over *all* providers — slow plugin sources (e.g. feishu.docs CLI search) would block the
 * host dynamic path and then be discarded by the chromium-only filter.
 */

import type { Locale } from '../../i18n'
import type { LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { listDesktopTargetProviders } from './registry'
import { desktopTargetToLauncherItem } from './toLauncherItem'
import type { DesktopTarget, DesktopTargetQueryContext } from './types'

const CHROMIUM_SOURCE_ID = 'browser.chromium'
const BRIDGE_LIST_TIMEOUT_MS = 120

function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(() => reject(new Error('desktop bridge provider timeout')), ms)
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

export async function getDesktopBridgeLauncherDynamicItems(ctx: {
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
  signal?: AbortSignal
}): Promise<LauncherItem[]> {
  if (ctx.surfaceId !== 'global-launcher') return []
  // Empty open: no tabs (design empty-search = 0 for bridge sources).
  if (!ctx.query.trim()) return []
  if (ctx.signal?.aborted) return []

  const provider = listDesktopTargetProviders().find((p) => p.id === CHROMIUM_SOURCE_ID)
  if (!provider) return []

  const queryCtx: DesktopTargetQueryContext = {
    query: ctx.query,
    locale: ctx.locale,
    surfaceId: ctx.surfaceId,
    signal: ctx.signal,
  }

  try {
    if (provider.health) {
      try {
        const h = await provider.health()
        if (!h.ok) return []
      } catch {
        return []
      }
    }

    const raw = await withTimeout(
      Promise.resolve(provider.list(queryCtx)),
      provider.listTimeoutMs ?? BRIDGE_LIST_TIMEOUT_MS,
      ctx.signal,
    )
    if (ctx.signal?.aborted) return []

    const targets = (Array.isArray(raw) ? raw : [])
      .filter((t): t is DesktopTarget => Boolean(t && (t.actionClass ?? 'focus') !== 'close'))
      .filter((t) => t.kind === 'tab' && (t.sourceId === CHROMIUM_SOURCE_ID || !t.sourceId))
      .map((t) => ({ ...t, sourceId: t.sourceId || CHROMIUM_SOURCE_ID }))
      .slice(0, 40)

    return targets.map((target) =>
      desktopTargetToLauncherItem(target, {
        locale: ctx.locale,
        provider,
        activate: provider.activate
          ? (t, c) => provider.activate!(t, c)
          : undefined,
      }),
    )
  } catch {
    return []
  }
}
