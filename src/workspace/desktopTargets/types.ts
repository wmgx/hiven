/**
 * Desktop Target protocol (see doc/2026-07-19-desktop-target-provider-design.md).
 * Primary navigation targets only in the first-party registry.
 */

import type { Locale } from '../../i18n'
import type { LauncherSurfaceId } from '../launcher/types'

export type DesktopTargetKind = 'app' | 'window' | 'tab' | 'document' | 'chat' | 'person'

export type DesktopTargetSourceId = string

export type DesktopTargetActionClass = 'focus' | 'open' | 'close' | 'terminate'

export type DesktopTarget = {
  /** Runtime list identity; may include volatile native ids. */
  id: string
  sourceId: DesktopTargetSourceId
  kind: DesktopTargetKind
  title: string
  subtitle?: string
  appName?: string
  /** Stable app identity for usage aggregation (bundle id / stable name). */
  appStableKey?: string
  keywords?: string[]
  meta?: {
    url?: string
    path?: string
    pid?: number
    windowId?: string
    profileId?: string
    faviconKey?: string
    cpuPercent?: number
    memoryBytes?: number
  }
  icon?: string
  /** Primary action; first-level list should be focus|open only. */
  actionClass?: DesktopTargetActionClass
  secondaryActions?: Array<'close'>
  titleI18n?: Partial<Record<Locale, string>>
  subtitleI18n?: Partial<Record<Locale, string>>
}

export type DesktopTargetQueryContext = {
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
  /** Performance short-circuit only — product demotion stays in host ranking. */
  detections?: Array<{ kind: string; confidence: number }>
  signal?: AbortSignal
}

export type DesktopTargetActivateContext = {
  locale: Locale
  surfaceId: LauncherSurfaceId
  signal?: AbortSignal
}

export type DesktopTargetProvider = {
  id: DesktopTargetSourceId
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  /** Source-level score boost, clamped by PROVIDER_PRIORITY_CAP. */
  priority?: number
  /** Soft timeout for this provider's list() only; falls back to collect options / default. */
  listTimeoutMs?: number
  list(ctx: DesktopTargetQueryContext): Promise<DesktopTarget[]> | DesktopTarget[]
  activate?(target: DesktopTarget, ctx: DesktopTargetActivateContext): Promise<void>
  health?(): Promise<{ ok: boolean; reason?: string }>
}

export type DesktopTargetPartialUpdate = {
  sourceId: DesktopTargetSourceId
  targets: DesktopTarget[]
  done: boolean
}

export type CollectDesktopTargetsOptions = {
  signal?: AbortSignal
  onPartial?: (update: DesktopTargetPartialUpdate) => void
  /** Soft timeout per provider (ms). Default 120. */
  timeoutMs?: number
  maxPerSource?: number
  maxGlobal?: number
}
