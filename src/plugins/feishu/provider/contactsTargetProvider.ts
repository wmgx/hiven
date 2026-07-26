/**
 * feishu.contacts — L1 mix-in: search people in Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapUsersToRows, searchUsers } from '../domains/contact'
import { openFeishuTarget } from '../domains/windowFocus'
import { getFeishuRuntime } from '../runtime'

export const FEISHU_CONTACTS_SOURCE_ID = 'feishu.contacts' as const

let listGeneration = 0

export function createFeishuContactsProvider(): DesktopTargetProvider {
  return {
    id: FEISHU_CONTACTS_SOURCE_ID,
    title: 'Feishu Contacts',
    titleI18n: { en: 'Feishu Contacts', zh: '飞书联系人' },
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
        if (settings.enabled === false || settings.contactsMixEnabled === false) return []
        if (!runtime.shell) return []

        const search = await searchUsers({
          shell: runtime.shell,
          query: q,
          binaryPath: settings.binaryPath || undefined,
          signal: ctx.signal,
          timeoutMs: 8000,
        })
        if (generation !== listGeneration || ctx.signal?.aborted) return []
        if (!search.ok) return []

        return mapUsersToRows(search.users)
          .filter((row) => Boolean(row.openUrl))
          .slice(0, 12)
          .map((row) => ({
            id: `feishu.contacts:person:${row.id}`,
            sourceId: FEISHU_CONTACTS_SOURCE_ID,
            kind: 'person' as const,
            title: row.title,
            subtitle: row.subtitle,
            keywords: row.keywords,
            meta: { url: row.openUrl },
            actionClass: 'open' as const,
            icon: 'User',
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

export function registerFeishuContactsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuContactsProvider())
}

export function unregisterFeishuContactsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_CONTACTS_SOURCE_ID)
}
