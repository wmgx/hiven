/**
 * feishu.docs DesktopTargetProvider — L1 document mix-in for Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapSearchResultsToTargets, searchDocs, type FeishuDocsTarget } from '../domains/docs'
import { openFeishuTarget } from '../domains/windowFocus'
import { getFeishuRuntime } from '../runtime'
import {
  beginL1Generation,
  isL1GenerationCurrent,
  isL1QueryReady,
  L1_PAGE_SIZE,
  L1_SEARCH_TIMEOUT_MS,
  resolveL1List,
  touchL1EntityAccess,
  type L1Domain,
  type L1Matchable,
} from '../search/l1Cache'

export const FEISHU_DOCS_SOURCE_ID = 'feishu.docs' as const
const DOMAIN: L1Domain = 'docs'

type DocsCacheRow = FeishuDocsTarget & L1Matchable

export function createFeishuDocsProvider(): DesktopTargetProvider {
  return {
    id: FEISHU_DOCS_SOURCE_ID,
    title: 'Feishu Docs',
    titleI18n: { en: 'Feishu Docs', zh: '飞书文档' },
    priority: 8,
    listTimeoutMs: L1_SEARCH_TIMEOUT_MS + 400,
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      if (!q || !isL1QueryReady(q)) return []
      if (ctx.signal?.aborted) return []

      const generation = beginL1Generation(DOMAIN)
      try {
        const runtime = getFeishuRuntime()
        const settings = runtime.settings
        if (settings.enabled === false || settings.docsMixEnabled === false) return []
        if (!runtime.shell) return []

        const rows = await resolveL1List<DocsCacheRow>({
          domain: DOMAIN,
          query: q,
          limit: L1_PAGE_SIZE,
          signal: ctx.signal,
          fetch: async () => {
            const search = await searchDocs({
              shell: runtime.shell!,
              query: q,
              binaryPath: settings.binaryPath || undefined,
              signal: ctx.signal,
              timeoutMs: L1_SEARCH_TIMEOUT_MS,
              pageSize: L1_PAGE_SIZE,
            })
            if (!search.ok) return []
            return mapSearchResultsToTargets(search.results)
              .slice(0, L1_PAGE_SIZE)
              .map((t) => ({
                ...t,
                // L1Matchable openUrl for entity index / prefix reuse
                openUrl: t.meta?.url,
              }))
          },
        })

        if (!isL1GenerationCurrent(DOMAIN, generation) || ctx.signal?.aborted) return []
        return toTargets(rows)
      } catch {
        return []
      }
    },
    async activate(target) {
      const url = target.meta?.url
      if (!url || typeof url !== 'string') {
        throw new Error('Document has no open URL')
      }
      const runtime = getFeishuRuntime()
      // shell can deliver client schemes even when host openUrl is not bound yet.
      if (!runtime.openUrl && !runtime.shell) {
        throw new Error('Feishu open path is not ready (no shell / openUrl)')
      }
      const entityId =
        (typeof target.meta?.entityId === 'string' && target.meta.entityId) || target.id
      touchL1EntityAccess(DOMAIN, {
        id: entityId,
        title: target.title,
        subtitle: target.subtitle,
        keywords: target.keywords,
        openUrl: url,
        meta: { url },
      })
      await openFeishuTarget({
        shell: runtime.shell,
        openUrl: runtime.openUrl,
        url,
        titleHint: target.title,
        preferWindowFocus: runtime.settings.preferWindowFocus !== false,
      })
    },
  }
}

/**
 * Product: within the same match tier, launcher commands should outrank doc
 * mix-in rows. Host only applies clamped scoreBias — Feishu owns the policy.
 * Magnitude < one match tier (1000) so a stronger doc title match still wins.
 */
const DOCS_MIXIN_SCORE_BIAS = -180

function toTargets(mapped: DocsCacheRow[]) {
  return mapped.map((t) => {
    const url = t.meta?.url ?? t.openUrl ?? ''
    // entity id without prefix for stable persist key
    const persistKey = t.id.replace(/^feishu\.docs:document:/, '') || t.id
    return {
      id: t.id,
      sourceId: t.sourceId,
      kind: 'document' as const,
      title: t.title,
      subtitle: t.subtitle,
      keywords: t.keywords,
      meta: { url, entityId: t.id },
      actionClass: 'open' as const,
      icon: t.icon || 'FileText',
      appName: 'Feishu',
      appStableKey: 'feishu',
      scoreBias: DOCS_MIXIN_SCORE_BIAS,
      // Product kind pill (overrides host protocol default "Document").
      kindLabel: 'Feishu Doc',
      kindLabelI18n: { en: 'Feishu Doc', zh: '飞书文档' },
      // Host may recommend this doc next session after selection.
      persistable: Boolean(url),
      persistKey,
    }
  })
}

export function registerFeishuDocsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuDocsProvider())
}

export function unregisterFeishuDocsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_DOCS_SOURCE_ID)
}
