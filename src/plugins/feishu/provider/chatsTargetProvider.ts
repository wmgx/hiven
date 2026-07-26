/**
 * feishu.chats — L1 mix-in: search group/p2p chats in Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapChatsToRows, searchChats } from '../domains/im'
import { openFeishuTarget } from '../domains/windowFocus'
import { getFeishuRuntime } from '../runtime'

export const FEISHU_CHATS_SOURCE_ID = 'feishu.chats' as const

let listGeneration = 0

export function createFeishuChatsProvider(): DesktopTargetProvider {
  return {
    id: FEISHU_CHATS_SOURCE_ID,
    title: 'Feishu Chats',
    titleI18n: { en: 'Feishu Chats', zh: '飞书会话' },
    priority: 6,
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
        if (settings.enabled === false || settings.chatsMixEnabled === false) return []
        if (!runtime.shell) return []

        const search = await searchChats({
          shell: runtime.shell,
          query: q,
          binaryPath: settings.binaryPath || undefined,
          signal: ctx.signal,
          timeoutMs: 8000,
        })
        if (generation !== listGeneration || ctx.signal?.aborted) return []
        if (!search.ok) return []

        return mapChatsToRows(search.chats)
          .filter((row) => Boolean(row.openUrl))
          .slice(0, 12)
          .map((row) => ({
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

export function registerFeishuChatsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuChatsProvider())
}

export function unregisterFeishuChatsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_CHATS_SOURCE_ID)
}
