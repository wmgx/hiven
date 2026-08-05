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
import {
  buildChatOpenHttpsUrl,
  buildChatOpenUrl,
  buildUserChatOpenUrl,
  buildUserOpenIdHttpsUrl,
} from '../domains/links'
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
      const openId =
        (typeof target.meta?.openId === 'string' && target.meta.openId.trim()) ||
        target.id.replace(/^feishu\.contacts:person:/, '')
      const openChatId =
        typeof target.meta?.openChatId === 'string' ? target.meta.openChatId.trim() : ''
      // Docs: openChatId / openId mutually exclusive per URL — try separately.
      // Prefer p2p openChatId (most reliable locate), then openId, then HTTPS.
      const candidates = uniqueUrls([
        openChatId ? buildChatOpenUrl(openChatId) : undefined,
        openId ? buildUserChatOpenUrl({ openId }) : undefined,
        typeof target.meta?.url === 'string' ? target.meta.url : undefined,
        openChatId ? buildChatOpenHttpsUrl(openChatId) : undefined,
        openId ? buildUserOpenIdHttpsUrl(openId) : undefined,
      ])
      const url = candidates[0]
      logFeishuOpen('contacts.activate:enter', {
        targetId: target.id,
        title: target.title,
        openId: openId || null,
        openChatId: openChatId || null,
        candidates,
      })
      if (!url) {
        logFeishuOpen('contacts.activate:abort-no-url', { targetId: target.id })
        throw new Error('Contact has no open URL')
      }
      const runtime = getFeishuRuntime()
      logFeishuOpen('contacts.activate:runtime', {
        hasShell: Boolean(runtime.shell),
        hasOpenUrl: Boolean(runtime.openUrl),
        enabled: runtime.settings?.enabled !== false,
      })
      const entityId =
        (typeof target.meta?.entityId === 'string' && target.meta.entityId) || openId
      touchL1EntityAccess(DOMAIN, {
        id: entityId,
        title: target.title,
        subtitle: target.subtitle,
        keywords: target.keywords,
        openUrl: url,
      })
      // open() exit 0 only means delivery accepted — not that Feishu navigated.
      // Fire native candidates in order (p2p openChatId → openId); last successful
      // deep link wins. HTTPS only if every native attempt throws.
      const native = candidates.filter((u) => /^(lark|feishu|x-feishu|x-lark):\/\//i.test(u))
      const https = candidates.filter((u) => /^https?:\/\//i.test(u))
      let lastError: unknown = null
      let anyOk = false
      for (const candidate of native.length > 0 ? native : candidates) {
        try {
          await openFeishuTarget({
            shell: runtime.shell,
            openUrl: runtime.openUrl,
            url: candidate,
            preferWindowFocus: false,
          })
          anyOk = true
          logFeishuOpen('contacts.activate:delivered', { targetId: target.id, url: candidate })
        } catch (error) {
          lastError = error
          logFeishuOpen('contacts.activate:candidate-failed', {
            url: candidate,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (anyOk) {
        logFeishuOpen('contacts.activate:ok', {
          targetId: target.id,
          delivered: native.length > 0 ? native : candidates,
        })
        return
      }
      for (const candidate of https) {
        try {
          await openFeishuTarget({
            shell: runtime.shell,
            openUrl: runtime.openUrl,
            url: candidate,
            preferWindowFocus: false,
          })
          logFeishuOpen('contacts.activate:ok-https', { targetId: target.id, url: candidate })
          return
        } catch (error) {
          lastError = error
          logFeishuOpen('contacts.activate:candidate-failed', {
            url: candidate,
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      logFeishuOpen('contacts.activate:error', {
        targetId: target.id,
        message: lastError instanceof Error ? lastError.message : String(lastError),
      })
      if (lastError) throw lastError
    },
  }
}

function uniqueUrls(urls: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of urls) {
    const u = raw?.trim()
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}

function toTargets(rows: FeishuUserRow[]) {
  return rows.map((row) => ({
    id: `feishu.contacts:person:${row.id}`,
    sourceId: FEISHU_CONTACTS_SOURCE_ID,
    kind: 'person' as const,
    title: row.title,
    subtitle: row.subtitle,
    keywords: row.keywords,
    meta: {
      url: row.openUrl,
      openId: row.id,
      openChatId: row.p2pChatId,
      entityId: row.id,
    },
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
