/**
 * D4: editor.vscode DesktopTargetProvider.
 * VS Code / Cursor / compatible editors push open documents via the same bridge.
 * Empty query → 0 (same product caution as tabs until focus history exists).
 */

import {
  bridgeDtoToDesktopTarget,
  desktopBridgeStatus,
  filterBridgeTargets,
  focusDesktopBridgeTarget,
  invalidateDesktopBridgeListCache,
  listDesktopBridgeTargets,
} from '../desktopControl/bridgeTargets'
import type { DesktopTarget, DesktopTargetProvider, DesktopTargetQueryContext } from './types'

export const VSCODE_SOURCE_ID = 'editor.vscode' as const

const QUERY_DOC_LIMIT = 40

function nativeIdFromTarget(target: DesktopTarget): string {
  if (target.meta?.path) return target.meta.path
  const prefix = `${target.sourceId}:${target.kind}:`
  if (target.id.startsWith(prefix)) return target.id.slice(prefix.length)
  return target.id
}

export const vscodeDocumentsProvider: DesktopTargetProvider = {
  id: VSCODE_SOURCE_ID,
  title: 'Editor Documents',
  titleI18n: { en: 'Editor Documents', zh: '编辑器文档' },
  priority: 8,
  async health() {
    try {
      const status = await desktopBridgeStatus()
      if (!status?.running) return { ok: false, reason: 'bridge not running' }
      const src = status.sources.find((s) => s.sourceId === VSCODE_SOURCE_ID)
      if (!src?.fresh) return { ok: false, reason: 'editor extension not connected' }
      return { ok: true }
    } catch {
      return { ok: false, reason: 'bridge unavailable' }
    }
  },
  async list(ctx: DesktopTargetQueryContext): Promise<DesktopTarget[]> {
    if (ctx.surfaceId !== 'global-launcher') return []
    const q = ctx.query.trim()
    if (!q) return []

    const raw = await listDesktopBridgeTargets(VSCODE_SOURCE_ID)
    if (raw.length === 0) return []
    const filtered = filterBridgeTargets(raw, q, ctx.locale).slice(0, QUERY_DOC_LIMIT)
    return filtered.map((dto) => {
      const target = bridgeDtoToDesktopTarget({ ...dto, kind: dto.kind || 'document' })
      return {
        ...target,
        kind: 'document' as const,
        appName: target.appName ?? 'VS Code',
        appStableKey: target.appStableKey ?? 'editor.vscode',
      }
    })
  },
  async activate(target) {
    await focusDesktopBridgeTarget(
      VSCODE_SOURCE_ID,
      nativeIdFromTarget(target),
      target.meta?.windowId,
    )
    invalidateDesktopBridgeListCache()
  },
}
