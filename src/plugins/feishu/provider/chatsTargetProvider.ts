/**
 * feishu.chats — L1 mix-in: search group/p2p chats in Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapChatsToRows, searchChats, type FeishuChatRow } from '../domains/im'
import { logFeishuOpen, openFeishuTarget } from '../domains/windowFocus'
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

      const generation = beginL1Generation(DOMAIN)
      try {
        const runtime = getFeishuRuntime()
        const settings = runtime.settings
        if (settings.enabled === false || settings.chatsMixEnabled === false) return []
        if (!runtime.shell) return []

        const rows = await resolveL1List<FeishuChatRow>({
          domain: DOMAIN,
          query: q,
          limit: L1_PAGE_SIZE,
          signal: ctx.signal,
          fetch: async () => {
            const search = await searchChats({
              shell: runtime.shell!,
              query: q,
              binaryPath: settings.binaryPath || undefined,
              signal: ctx.signal,
              timeoutMs: L1_SEARCH_TIMEOUT_MS,
              pageSize: L1_PAGE_SIZE,
            })
            if (!search.ok) return []
            return mapChatsToRows(search.chats)
              .filter((row) => Boolean(row.openUrl))
              .slice(0, L1_PAGE_SIZE)
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
      logFeishuOpen('chats.activate:enter', {
        targetId: target.id,
        title: target.title,
        url: url ?? null,
      })
      if (!url) {
        logFeishuOpen('chats.activate:abort-no-url', { targetId: target.id })
        return
      }
      const runtime = getFeishuRuntime()
      logFeishuOpen('chats.activate:runtime', {
        hasShell: Boolean(runtime.shell),
        hasOpenUrl: Boolean(runtime.openUrl),
      })
      const entityId =
        (typeof target.meta?.entityId === 'string' && target.meta.entityId) ||
        target.id.replace(/^feishu\.chats:chat:/, '')
      touchL1EntityAccess(DOMAIN, {
        id: entityId,
        title: target.title,
        subtitle: target.subtitle,
        keywords: target.keywords,
        openUrl: url,
      })
      // Chat deep link already routes; skip title AXRaise (wrong window risk).
      try {
        await openFeishuTarget({
          shell: runtime.shell,
          openUrl: runtime.openUrl,
          url,
          preferWindowFocus: false,
        })
        logFeishuOpen('chats.activate:ok', { targetId: target.id, url })
      } catch (error) {
        logFeishuOpen('chats.activate:error', {
          targetId: target.id,
          url,
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
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
    meta: { url: row.openUrl, entityId: row.id },
    actionClass: 'open' as const,
    icon: row.icon || 'MessagesSquare',
    appName: 'Feishu',
    appStableKey: 'feishu',
    kindLabel: 'Feishu Chat',
    kindLabelI18n: { en: 'Feishu Chat', zh: '飞书会话' },
    // Durable identity for host recents / usage (chat_id).
    persistable: Boolean(row.openUrl),
    persistKey: row.id,
  }))
}

export function registerFeishuChatsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuChatsProvider())
}

export function unregisterFeishuChatsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_CHATS_SOURCE_ID)
}
