/**
 * feishu.docs DesktopTargetProvider — L1 document mix-in for Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapSearchResultsToTargets, searchDocs } from '../domains/docs'
import { openFeishuTarget } from '../domains/windowFocus'
import { getFeishuRuntime } from '../runtime'
import {
  beginL1Generation,
  getL1Cache,
  isL1GenerationCurrent,
  isL1QueryReady,
  L1_PAGE_SIZE,
  L1_SEARCH_TIMEOUT_MS,
  setL1Cache,
  type L1Domain,
} from '../search/l1Cache'

export const FEISHU_DOCS_SOURCE_ID = 'feishu.docs' as const
const DOMAIN: L1Domain = 'docs'

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

      const cached = getL1Cache<ReturnType<typeof mapSearchResultsToTargets>>(DOMAIN, q)
      if (cached) return toTargets(cached)

      const generation = beginL1Generation(DOMAIN)
      try {
        const runtime = getFeishuRuntime()
        const settings = runtime.settings
        if (settings.enabled === false || settings.docsMixEnabled === false) return []
        if (!runtime.shell) return []

        const search = await searchDocs({
          shell: runtime.shell,
          query: q,
          binaryPath: settings.binaryPath || undefined,
          signal: ctx.signal,
          timeoutMs: L1_SEARCH_TIMEOUT_MS,
          pageSize: L1_PAGE_SIZE,
        })
        if (!isL1GenerationCurrent(DOMAIN, generation) || ctx.signal?.aborted) return []
        if (!search.ok) return []

        const mapped = mapSearchResultsToTargets(search.results).slice(0, L1_PAGE_SIZE)
        setL1Cache(DOMAIN, q, mapped)
        return toTargets(mapped)
      } catch {
        return []
      }
    },
    async activate(target) {
      const url = target.meta?.url
      if (!url) return
      const runtime = getFeishuRuntime()
      if (!runtime.openUrl) return
      try {
        await openFeishuTarget({
          shell: runtime.shell,
          openUrl: runtime.openUrl,
          url,
          titleHint: target.title,
          preferWindowFocus: runtime.settings.preferWindowFocus !== false,
        })
      } catch {
        // ignore
      }
    },
  }
}

function toTargets(mapped: ReturnType<typeof mapSearchResultsToTargets>) {
  return mapped.map((t) => ({
    id: t.id,
    sourceId: t.sourceId,
    kind: 'document' as const,
    title: t.title,
    subtitle: t.subtitle,
    keywords: t.keywords,
    meta: { url: t.meta.url },
    actionClass: 'open' as const,
    icon: t.icon ?? 'FileText',
    appName: 'Feishu',
    appStableKey: 'feishu',
  }))
}

export function registerFeishuDocsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuDocsProvider())
}

export function unregisterFeishuDocsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_DOCS_SOURCE_ID)
}
