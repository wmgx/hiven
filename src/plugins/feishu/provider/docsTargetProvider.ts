/**
 * feishu.docs DesktopTargetProvider — L1 document mix-in for Global Launcher.
 * Host SDK only (no workspace deep imports).
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapSearchResultsToTargets, searchDocs } from '../domains/docs'
import { openFeishuTarget } from '../domains/windowFocus'
import { getFeishuRuntime } from '../runtime'

export const FEISHU_DOCS_SOURCE_ID = 'feishu.docs' as const

/** Ignore stale CLI results when a newer list() superseded this call. */
let listGeneration = 0

export function createFeishuDocsProvider(): DesktopTargetProvider {
  return {
    id: FEISHU_DOCS_SOURCE_ID,
    title: 'Feishu Docs',
    titleI18n: { en: 'Feishu Docs', zh: '飞书文档' },
    priority: 8,
    listTimeoutMs: 8000,
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      if (!q) return []
      if (ctx.signal?.aborted) return []

      const generation = ++listGeneration

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
          timeoutMs: 8000,
        })
        // Newer keystroke / aborted request: drop late results.
        if (generation !== listGeneration || ctx.signal?.aborted) return []
        if (!search.ok) return []

        return mapSearchResultsToTargets(search.results).map((t) => ({
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
        // provider must not throw into host ranking
      }
    },
  }
}

export function registerFeishuDocsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuDocsProvider())
}

export function unregisterFeishuDocsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_DOCS_SOURCE_ID)
}
