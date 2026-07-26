/**
 * feishu.chats — L1 mix-in: search group/p2p chats in Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapChatsToRows, searchChats, type FeishuChatRow } from '../domains/im'
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

export const FEISHU_CHATS_SOURCE_ID = 'feishu.chats' as const
const DOMAIN: L1Domain = 'chats'

export function createFeishuChatsProvider(): DesktopTargetProvider {
  return {
    id: FEISHU_CHATS_SOURCE_ID,
    title: 'Feishu Chats',
    titleI18n: { en: 'Feishu Chats', zh: '飞书会话' },
    priority: 6,
    listTimeoutMs: L1_SEARCH_TIMEOUT_MS + 400,
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      if (!q || !isL1QueryReady(q)) return []
      if (ctx.signal?.aborted) return []

      const cached = getL1Cache<FeishuChatRow[]>(DOMAIN, q)
      if (cached) return toTargets(cached)

      const generation = beginL1Generation(DOMAIN)
      try {
        const runtime = getFeishuRuntime()
        const settings = runtime.settings
        if (settings.enabled === false || settings.chatsMixEnabled === false) return []
        if (!runtime.shell) return []

        const search = await searchChats({
          shell: runtime.shell,
          query: q,
          binaryPath: settings.binaryPath || undefined,
          signal: ctx.signal,
          timeoutMs: L1_SEARCH_TIMEOUT_MS,
          pageSize: L1_PAGE_SIZE,
        })
        if (!isL1GenerationCurrent(DOMAIN, generation) || ctx.signal?.aborted) return []
        if (!search.ok) return []

        const rows = mapChatsToRows(search.chats)
          .filter((row) => Boolean(row.openUrl))
          .slice(0, L1_PAGE_SIZE)
        setL1Cache(DOMAIN, q, rows)
        return toTargets(rows)
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

function toTargets(rows: FeishuChatRow[]) {
  return rows.map((row) => ({
    id: `feishu.chats:chat:${row.id}`,
    sourceId: FEISHU_CHATS_SOURCE_ID,
    kind: 'chat' as const,
    title: row.title,
    subtitle: row.subtitle,
    keywords: row.keywords,
    meta: { url: row.openUrl },
    actionClass: 'open' as const,
    icon: 'MessagesSquare',
    appName: 'Feishu',
    appStableKey: 'feishu',
  }))
}

export function registerFeishuChatsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuChatsProvider())
}

export function unregisterFeishuChatsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_CHATS_SOURCE_ID)
}
