/**
 * feishu.contacts — L1 mix-in: search people in Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { mapUsersToRows, searchUsers, type FeishuUserRow } from '../domains/contact'
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

export const FEISHU_CONTACTS_SOURCE_ID = 'feishu.contacts' as const
const DOMAIN: L1Domain = 'contacts'

export function createFeishuContactsProvider(): DesktopTargetProvider {
  return {
    id: FEISHU_CONTACTS_SOURCE_ID,
    title: 'Feishu Contacts',
    titleI18n: { en: 'Feishu Contacts', zh: '飞书联系人' },
    priority: 6,
    listTimeoutMs: L1_SEARCH_TIMEOUT_MS + 400,
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      if (!q || !isL1QueryReady(q)) return []
      if (ctx.signal?.aborted) return []

      const cached = getL1Cache<FeishuUserRow[]>(DOMAIN, q)
      if (cached) return toTargets(cached)

      const generation = beginL1Generation(DOMAIN)
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
          timeoutMs: L1_SEARCH_TIMEOUT_MS,
          pageSize: L1_PAGE_SIZE,
        })
        if (!isL1GenerationCurrent(DOMAIN, generation) || ctx.signal?.aborted) return []
        if (!search.ok) return []

        const rows = mapUsersToRows(search.users)
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

function toTargets(rows: FeishuUserRow[]) {
  return rows.map((row) => ({
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
}

export function registerFeishuContactsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuContactsProvider())
}

export function unregisterFeishuContactsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_CONTACTS_SOURCE_ID)
}
