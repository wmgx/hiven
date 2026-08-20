/**
 * Client for the native desktop bridge (D3 Chromium tabs).
 * Extensions push snapshots to 127.0.0.1:19246; launcher lists via Tauri.
 */

import { invoke } from '@tauri-apps/api/core'
import type { Locale } from '../../i18n'
import { searchableFieldsMatch } from '../searchRanking'
import type { DesktopTarget } from '../desktopTargets/types'

export const DESKTOP_BRIDGE_PORT = 19246

export type DesktopBridgeTargetDto = {
  id: string
  sourceId: string
  kind: string
  title: string
  subtitle?: string | null
  url?: string | null
  path?: string | null
  windowId?: string | null
  appName?: string | null
  active?: boolean | null
  /** Page favicon URL (https / data) when the extension provided one. */
  faviconUrl?: string | null
}

export type DesktopBridgeStatus = {
  running: boolean
  port: number
  sources: Array<{
    sourceId: string
    fresh: boolean
    targetCount: number
    historyCount?: number
    eventCount?: number
    appName?: string | null
  }>
}

export type DesktopBridgeHistoryDto = {
  id: string
  sourceId: string
  title: string
  url: string
  lastVisitTime?: number | null
  visitCount?: number | null
  typedCount?: number | null
  /**
   * Individual visit timestamps when the extension can supply them
   * (chrome.history.getVisits), newest last. Absent on older extensions — the
   * summary fields above are the fallback.
   */
  visits?: number[] | null
  faviconUrl?: string | null
  appName?: string | null
}

export type DesktopBridgeEventDto = {
  type: string
  ts: number
  sourceId: string
  tabId?: string | null
  windowId?: string | null
  title?: string | null
  url?: string | null
  faviconUrl?: string | null
  appName?: string | null
}

export type DesktopBridgeSourceConfig = {
  historyEnabled: boolean
  autoCloseIdleTabs: boolean
  idleTimeoutMinutes: number
}

const LIST_TTL_MS = 1500
let listCache: { fetchedAt: number; sourceId: string | null; targets: DesktopBridgeTargetDto[] } | null = null

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export async function desktopBridgeStatus(): Promise<DesktopBridgeStatus | null> {
  if (!isTauriRuntime()) return null
  try {
    return await invoke<DesktopBridgeStatus>('desktop_bridge_status')
  } catch {
    return null
  }
}

export async function listDesktopBridgeTargets(sourceId?: string): Promise<DesktopBridgeTargetDto[]> {
  if (!isTauriRuntime()) return []
  const key = sourceId ?? null
  const now = Date.now()
  if (listCache && listCache.sourceId === key && now - listCache.fetchedAt < LIST_TTL_MS) {
    return listCache.targets
  }
  try {
    const targets = await invoke<DesktopBridgeTargetDto[]>('list_desktop_bridge_targets', {
      sourceId: sourceId ?? null,
    })
    listCache = { fetchedAt: now, sourceId: key, targets }
    return targets
  } catch {
    return []
  }
}

export async function focusDesktopBridgeTarget(
  sourceId: string,
  id: string,
  windowId?: string | null,
): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Desktop bridge only available in desktop app')
  }
  await invoke('focus_desktop_bridge_target', {
    sourceId,
    id,
    windowId: windowId ?? null,
  })
}

export async function listDesktopBridgeHistory(sourceId?: string): Promise<DesktopBridgeHistoryDto[]> {
  if (!isTauriRuntime()) return []
  try {
    return await invoke<DesktopBridgeHistoryDto[]>('list_desktop_bridge_history', {
      sourceId: sourceId ?? null,
    })
  } catch {
    return []
  }
}

export async function listDesktopBridgeEvents(
  sourceId?: string,
  sinceTs?: number,
): Promise<DesktopBridgeEventDto[]> {
  if (!isTauriRuntime()) return []
  try {
    return await invoke<DesktopBridgeEventDto[]>('list_desktop_bridge_events', {
      sourceId: sourceId ?? null,
      sinceTs: sinceTs ?? null,
    })
  } catch {
    return []
  }
}

export async function openDesktopBridgeUrl(sourceId: string, url: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error('Desktop bridge only available in desktop app')
  }
  await invoke('open_desktop_bridge_url', { sourceId, url })
}

export async function setDesktopBridgeSourceConfig(
  sourceId: string,
  config: DesktopBridgeSourceConfig,
): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('set_desktop_bridge_source_config', {
    sourceId,
    historyEnabled: config.historyEnabled,
    autoCloseIdleTabs: config.autoCloseIdleTabs,
    idleTimeoutMinutes: config.idleTimeoutMinutes,
  })
}

function isRenderableIconUrl(url: string | null | undefined): url is string {
  if (!url) return false
  return (
    url.startsWith('https://') ||
    url.startsWith('http://') ||
    url.startsWith('data:image/')
  )
}

export function bridgeDtoToDesktopTarget(dto: DesktopBridgeTargetDto): DesktopTarget {
  const kind = dto.kind === 'document' ? 'document' : 'tab'
  const favicon = isRenderableIconUrl(dto.faviconUrl) ? dto.faviconUrl : undefined
  return {
    id: `${dto.sourceId}:${kind}:${dto.id}`,
    sourceId: dto.sourceId,
    kind,
    title: dto.title,
    subtitle: dto.subtitle ?? dto.appName ?? undefined,
    appName: dto.appName ?? undefined,
    appStableKey: dto.appName ?? dto.sourceId,
    keywords: [dto.title, dto.url ?? '', dto.path ?? '', dto.appName ?? ''].filter(Boolean),
    meta: {
      url: dto.url ?? undefined,
      path: dto.path ?? undefined,
      windowId: dto.windowId ?? undefined,
      faviconKey: favicon,
    },
    icon: favicon ?? (kind === 'tab' ? 'Globe' : undefined),
    actionClass: 'focus',
  }
}

export function filterBridgeTargets(
  targets: DesktopBridgeTargetDto[],
  query: string,
  locale: Locale,
): DesktopBridgeTargetDto[] {
  const q = query.trim()
  if (!q) return targets
  return targets.filter((t) =>
    searchableFieldsMatch(
      {
        id: t.id,
        title: t.title,
        aliases: [t.subtitle, t.url, t.path, t.appName].filter(Boolean) as string[],
      },
      q.toLowerCase(),
      locale,
    ),
  )
}

/** Invalidate list cache (e.g. after activate). */
export function invalidateDesktopBridgeListCache(): void {
  listCache = null
}
