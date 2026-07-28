/**
 * feishu.contacts — L1 mix-in: search people in Global Launcher.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import {
  hasContactIntersection,
  mapUsersToRows,
  searchUsersWithAvatars,
  sortUsersByIntersection,
  type FeishuUserRow,
} from '../domains/contact'
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

      const generation = beginL1Generation(DOMAIN)
      try {
        const runtime = getFeishuRuntime()
        const settings = runtime.settings
        if (settings.enabled === false || settings.contactsMixEnabled === false) return []
        if (!runtime.shell) return []

        const rows = await resolveL1List<FeishuUserRow>({
          domain: DOMAIN,
          query: q,
          limit: L1_PAGE_SIZE,
          signal: ctx.signal,
          fetch: async () => {
            // L1 mix-in: only people with intersection (already chatted).
            // search-user has no avatar field — searchUsersWithAvatars best-effort enriches.
            const search = await searchUsersWithAvatars({
              shell: runtime.shell!,
              query: q,
              binaryPath: settings.binaryPath || undefined,
              signal: ctx.signal,
              timeoutMs: L1_SEARCH_TIMEOUT_MS,
              pageSize: L1_PAGE_SIZE,
              onlyChatted: true,
            })
            if (!search.ok) return []
            return sortUsersByIntersection(
              mapUsersToRows(search.users)
                .filter((row) => Boolean(row.openUrl))
                .filter((row) => hasContactIntersection(row)),
            ).slice(0, L1_PAGE_SIZE)
          },
        })

        if (!isL1GenerationCurrent(DOMAIN, generation) || ctx.signal?.aborted) return []
        // Drop cache hits that predate intersection filter / strangers.
        const visible = rows.filter((row) => hasContactIntersection(row) && row.openUrl)
        return toTargets(visible)
      } catch {
        return []
      }
    },
    async activate(target) {
      const url = target.meta?.url
      logFeishuOpen('contacts.activate:enter', {
        targetId: target.id,
        title: target.title,
        url: url ?? null,
        metaKeys: target.meta ? Object.keys(target.meta) : [],
      })
      if (!url) {
        logFeishuOpen('contacts.activate:abort-no-url', { targetId: target.id })
        return
      }
      const runtime = getFeishuRuntime()
      logFeishuOpen('contacts.activate:runtime', {
        hasShell: Boolean(runtime.shell),
        hasOpenUrl: Boolean(runtime.openUrl),
        enabled: runtime.settings?.enabled !== false,
      })
      // Sticky: visited people stay in local index longer and rank higher next time.
      const entityId =
        (typeof target.meta?.entityId === 'string' && target.meta.entityId) ||
        target.id.replace(/^feishu\.contacts:person:/, '')
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
        logFeishuOpen('contacts.activate:ok', { targetId: target.id, url })
      } catch (error) {
        logFeishuOpen('contacts.activate:error', {
          targetId: target.id,
          url,
          message: error instanceof Error ? error.message : String(error),
        })
        throw error
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
    meta: { url: row.openUrl, entityId: row.id },
    actionClass: 'open' as const,
    icon: row.icon || 'User',
    appName: 'Feishu',
    appStableKey: 'feishu',
    kindLabel: 'Feishu Contact',
    kindLabelI18n: { en: 'Feishu Contact', zh: '飞书联系人' },
    // Durable identity for host recents / usage (open_id).
    persistable: Boolean(row.openUrl),
    persistKey: row.id,
  }))
}

export function registerFeishuContactsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createFeishuContactsProvider())
}

export function unregisterFeishuContactsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(FEISHU_CONTACTS_SOURCE_ID)
}
