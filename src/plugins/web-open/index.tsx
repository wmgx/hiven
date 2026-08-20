/**
 * Browser Plugin (quick-open rules + live browser bridge)
 * Allows users to configure URL templates and quickly open web pages
 * via the launcher collect-input flow.
 */

import {
  definePlugin,
  getPluginHostSdk,
  type LauncherDynamicContext,
  type LauncherExecutionContext,
  type LauncherItemContribution,
  type LauncherOutput,
  type LauncherSuggestContext,
} from '@hiven/plugin'
import { learnedOfferToEntry, mergeLearnedEntry } from './learnedRules'
import {
  AUTO_CREATED_TAG,
  buildWebQuickOpenUrl,
  DEFAULT_MAX_QUERY_HISTORY,
  DEFAULT_WEB_QUICK_OPEN_SETTINGS,
  type WebQuickOpenEntry,
  type WebQuickOpenSettings,
} from './settings/model'
import { FaviconCacheModal } from './settings/FaviconCacheModal'
import { QueryHistoryModal } from './settings/QueryHistoryModal'
import {
  extractDomain,
  getCachedFaviconIcon,
  getFaviconIcon,
  getFaviconIconSync,
  resolveFaviconIconForLauncher,
  warmFaviconDomains,
  FALLBACK_ICON,
} from './faviconCache'
import { replaceMatchPatternCache, testMatchPattern } from './matchPatternCache'
import {
  clampMaxQueryHistory,
  filterQueryHistory,
  loadQueryHistory,
  recordQueryHistory,
  removeQueryHistoryEntry,
} from './queryHistory'
import {
  pushChromiumBridgeConfig,
  registerChromiumTabsProvider,
  unregisterChromiumTabsProvider,
} from './browserProvider'
import { normalizeBrowserTabsSettings } from './browserTabsModel'
import { BrowserTabsConnectionModal } from './settings/BrowserTabsConnectionModal'

/**
 * Apply the optional live-browser capability from merged settings: register the
 * Chromium tab/history/focus provider and push extension config. Gated on
 * settings.browser.enabled; a no-op-safe path when no extension/bridge is present
 * (the provider's health() simply reports not-connected).
 */
function applyBrowserCapability(settings: WebQuickOpenSettings): void {
  const browser = normalizeBrowserTabsSettings(settings.browser)
  if (browser.enabled) registerChromiumTabsProvider()
  else unregisterChromiumTabsProvider()
  pushChromiumBridgeConfig(browser)
}

function resolveEntryHistoryLimit(entry: WebQuickOpenEntry): number {
  return clampMaxQueryHistory(entry.maxQueryHistory ?? DEFAULT_MAX_QUERY_HISTORY)
}

function shouldRecordHistory(entry: WebQuickOpenEntry): boolean {
  return entry.recordQueryHistory === true
}

async function openAndMaybeRecord(
  ctx: Pick<LauncherExecutionContext<WebQuickOpenSettings>, 'api' | 'storage'>,
  entry: WebQuickOpenEntry,
  query: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = buildWebQuickOpenUrl(entry.urlTemplate, query, entry.encodeQuery)
  try {
    await ctx.api.openUrl(url)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
  if (shouldRecordHistory(entry)) {
    void recordQueryHistory(ctx.storage, entry.id, query, resolveEntryHistoryLimit(entry))
  }
  return { ok: true }
}

/**
 * Resolve entry favicon as plugin-blob only (or Globe fallback).
 * Host never receives raw site URLs — multi-source fetch stays inside the plugin cache.
 */
async function resolveEntryFavicon(
  entry: WebQuickOpenEntry,
  ctx: Pick<LauncherSuggestContext<WebQuickOpenSettings>, 'storage' | 'network' | 'pluginId' | 'source'>,
): Promise<string> {
  const domain = extractDomain(entry.urlTemplate)
  if (!domain) return FALLBACK_ICON

  const source = ctx.source ?? 'builtin'
  const pluginId = ctx.pluginId ?? 'web-open'

  try {
    const cached = await getCachedFaviconIcon(domain, ctx.storage, source, pluginId)
    if (cached) return cached
    return await getFaviconIcon(domain, ctx.storage, source, pluginId, ctx.network)
  } catch {
    return resolveFaviconIconForLauncher(domain, ctx.storage, source, pluginId, ctx.network)
  }
}

async function buildHistoryOutput(
  entry: WebQuickOpenEntry,
  items: Awaited<ReturnType<typeof loadQueryHistory>>,
  ctx: Pick<LauncherSuggestContext<WebQuickOpenSettings>, 'api' | 'storage' | 'network' | 't' | 'pluginId' | 'source'>,
): Promise<LauncherOutput> {
  const icon = await resolveEntryFavicon(entry, ctx)
  return {
    choices: items.map((item) => {
      const url = buildWebQuickOpenUrl(entry.urlTemplate, item.text, entry.encodeQuery)
      return {
        id: `history:${entry.id}:${encodeURIComponent(item.text)}`,
        title: item.text,
        subtitle: url,
        icon,
        primaryAction: async () => {
          try {
            await ctx.api.openUrl(url)
          } catch (error) {
            return { ok: false as const, message: error instanceof Error ? error.message : String(error) }
          }
          void recordQueryHistory(ctx.storage, entry.id, item.text, resolveEntryHistoryLimit(entry))
          return { ok: true as const }
        },
        secondaryActions: [
          {
            id: 'delete',
            title: ctx.t('queryHistory.delete'),
            run: async () => {
              await removeQueryHistoryEntry(ctx.storage, entry.id, item.text)
              return { ok: true as const, keepOpen: true as const }
            },
          },
        ],
      }
    }),
  }
}

async function suggestHistoryForEntry(
  ctx: LauncherSuggestContext<WebQuickOpenSettings>,
  entry: WebQuickOpenEntry,
): Promise<LauncherOutput | null> {
  const runtimeEntry =
    ctx.settings?.entries?.find((candidate) => candidate.id === entry.id) ?? entry
  if (!shouldRecordHistory(runtimeEntry)) return null
  const all = await loadQueryHistory(ctx.storage, runtimeEntry.id)
  const filtered = filterQueryHistory(all, ctx.inputText)
  if (filtered.length === 0) return null
  return await buildHistoryOutput(runtimeEntry, filtered, ctx)
}

/**
 * Prefer in-memory plugin-blob after warm (settings save / startup).
 * Otherwise Globe until cache is ready.
 */
function entrySiteIcon(entry: WebQuickOpenEntry): string {
  const domain = extractDomain(entry.urlTemplate)
  if (!domain) return FALLBACK_ICON
  const cached = getFaviconIconSync(domain)
  return cached !== FALLBACK_ICON ? cached : FALLBACK_ICON
}

function domainsFromSettings(settings: WebQuickOpenSettings): string[] {
  const domains: string[] = []
  for (const entry of settings.entries ?? []) {
    const domain = extractDomain(entry.urlTemplate)
    if (domain) domains.push(domain)
  }
  return domains
}

/** Debounce: object-list fields fire onChange per keystroke while editing URL. */
let faviconWarmTimer: ReturnType<typeof setTimeout> | undefined

function scheduleWarmFavicons(
  settings: WebQuickOpenSettings,
  storage: Parameters<typeof warmFaviconDomains>[1],
  source: string,
  pluginId: string,
  network: Parameters<typeof warmFaviconDomains>[4],
): void {
  if (typeof faviconWarmTimer !== 'undefined') clearTimeout(faviconWarmTimer)
  faviconWarmTimer = setTimeout(() => {
    warmFaviconDomains(domainsFromSettings(settings), storage, source, pluginId, network)
  }, 350)
}

function buildEntryLauncherItem(
  entry: WebQuickOpenSettings['entries'][number],
  icon?: string,
): LauncherItemContribution<WebQuickOpenSettings> {
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  return {
    id: entry.id,
    // Stable site/action id — safe to learn frequency when used as dynamic.
    recordUsage: true,
    display: {
      title: entry.title || entry.urlTemplate,
      icon: icon ?? entrySiteIcon(entry),
      aliases: [
        ...aliases,
        entry.placeholder,
        entry.urlTemplate,
      ].filter(Boolean),
    },
    behavior: {
      type: 'collect-input' as const,
      input: {
        placeholder: entry.placeholder,
        allowEmptyInput: entry.emptyQueryBehavior !== 'block',
        emptyInputMessage: entry.emptyQueryBehavior === 'block' ? 'Please enter content' : undefined,
        emptyInputMessageI18n: entry.emptyQueryBehavior === 'block'
          ? { zh: '请输入内容', en: 'Please enter content' }
          : undefined,
      },
    },
    suggest: (ctx) => suggestHistoryForEntry(ctx, entry),
    async execute(ctx) {
      if (ctx.settings?.enabled === false) {
        const message = ctx.t('disabledMessage')
        ctx.api.showMessage(message, 'warning')
        return { ok: false, message }
      }
      const runtimeEntry = ctx.settings?.entries?.find((candidate) => candidate.id === entry.id) ?? entry
      return openAndMaybeRecord(ctx, runtimeEntry, ctx.input?.text ?? '')
    },
  }
}

/** Rebuilt each static collect so icons pick up memory blob after warm. */
function buildLauncherItems(): LauncherItemContribution<WebQuickOpenSettings>[] {
  return DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries.map((entry) => buildEntryLauncherItem(entry))
}

function entryMatchesQuery(entry: WebQuickOpenSettings['entries'][number], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  return [
    entry.title,
    entry.placeholder,
    entry.urlTemplate,
    ...aliases,
  ].some((value) => String(value ?? '').toLowerCase().includes(q))
}

function isUnchangedDefaultEntry(entry: WebQuickOpenSettings['entries'][number]): boolean {
  const defaultEntry = DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries.find((candidate) => candidate.id === entry.id)
  if (!defaultEntry) return false
  return (
    entry.title === defaultEntry.title &&
    entry.placeholder === defaultEntry.placeholder &&
    entry.urlTemplate === defaultEntry.urlTemplate &&
    entry.encodeQuery === defaultEntry.encodeQuery &&
    entry.emptyQueryBehavior === defaultEntry.emptyQueryBehavior &&
    (Array.isArray(entry.aliases) ? entry.aliases : []).join('\n') === defaultEntry.aliases.join('\n')
  )
}

function isValidUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim())
}

function resolveLauncherIcon(
  url: string,
  ctx: LauncherDynamicContext,
): string {
  const domain = extractDomain(url)
  if (!domain) return FALLBACK_ICON
  return resolveFaviconIconForLauncher(domain, ctx.storage, ctx.source, ctx.pluginId, ctx.network)
}

async function buildDynamicLauncherItems(ctx: LauncherDynamicContext): Promise<LauncherItemContribution[]> {
  const settings = ctx.settings as WebQuickOpenSettings | undefined
  if (settings?.enabled === false) return []
  const entries = settings?.entries ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries
  const query = ctx.query.trim()
  if (!query) return []

  // Replace compiled matchPattern cache with current settings (supports pattern replacement).
  replaceMatchPatternCache(
    entries
      .map((entry) => entry.matchPattern)
      .filter((pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0),
  )

  const results: LauncherItemContribution[] = []

  // A. Pattern-matched entries → perform (one-step open)
  // Favicon uses plugin-internal memory/kv cache; network warm is non-blocking.
  for (const entry of entries) {
    if (!entry.matchPattern) continue
    if (!testMatchPattern(entry.matchPattern, query)) continue

    const url = buildWebQuickOpenUrl(entry.urlTemplate, query, entry.encodeQuery)
    const icon = resolveLauncherIcon(url, ctx)

    results.push({
      id: entry.id + '-quick',
      // Pattern-matched site templates are stable intents (e.g. google-quick).
      recordUsage: true,
      display: {
        title: entry.title || entry.urlTemplate,
        subtitle: url,
        icon,
        // Keep the matched query as an alias so ranking matchScore stays high
        // even if host filters by searchable fields (title-only policy).
        aliases: [query, entry.title, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter(Boolean),
      },
      behavior: { type: 'perform' as const },
      async execute(execCtx) {
        const runtimeEntry =
          (execCtx.settings as WebQuickOpenSettings | undefined)?.entries?.find((candidate) => candidate.id === entry.id)
          ?? entry
        return openAndMaybeRecord(execCtx as LauncherExecutionContext<WebQuickOpenSettings>, runtimeEntry, query)
      },
    })
  }

  // B. Direct URL open
  if (isValidUrl(query)) {
    const icon = resolveLauncherIcon(query, ctx)

    results.push({
      id: 'direct-url-open',
      // Single stable action for "open this as URL", not the URL itself.
      recordUsage: true,
      // Participate in content intent ranking when detections include url.
      accepts: { kinds: ['url'] },
      display: {
        title: ctx.t('directOpenTitle'),
        subtitle: query,
        icon,
      },
      behavior: { type: 'perform' as const },
      async execute(execCtx) {
        await execCtx.api.openUrl(query)
        return { ok: true }
      },
    })
  }

  // C. Existing behavior: user-customized entries matching by keyword
  // Prefer memory/blob favicon when available; otherwise multi-try origin icon.
  const keywordMatches = entries
    .filter((entry) => !isUnchangedDefaultEntry(entry))
    .filter((entry) => entryMatchesQuery(entry, ctx.query))
    .map((entry) => {
      const icon = resolveLauncherIcon(entry.urlTemplate, ctx)
      return buildEntryLauncherItem(entry, icon) as LauncherItemContribution
    })

  results.push(...keywordMatches)

  return results
}

function migrateWebQuickOpenSettings(stored: unknown): WebQuickOpenSettings {
  const value = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Partial<WebQuickOpenSettings>
    : {}
  const entries = Array.isArray(value.entries) ? value.entries : DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries
  const migrated: WebQuickOpenSettings = {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_WEB_QUICK_OPEN_SETTINGS.enabled,
    entries: entries.map((entry, index) => {
      const source = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? entry as Partial<WebQuickOpenSettings['entries'][number]>
        : {}
      return {
        id: String(source.id || 'web-' + (index + 1)),
        title: String(source.title || ''),
        aliases: Array.isArray(source.aliases) ? source.aliases.map(String) : [],
        placeholder: String(source.placeholder || ''),
        urlTemplate: String(source.urlTemplate || 'https://example.com/search?q={query}'),
        encodeQuery: typeof source.encodeQuery === 'boolean' ? source.encodeQuery : true,
        emptyQueryBehavior: source.emptyQueryBehavior === 'open' ? 'open' : 'block',
        matchPattern: typeof source.matchPattern === 'string' ? source.matchPattern : undefined,
        recordQueryHistory: source.recordQueryHistory === true,
        maxQueryHistory: clampMaxQueryHistory(
          typeof source.maxQueryHistory === 'number' ? source.maxQueryHistory : DEFAULT_MAX_QUERY_HISTORY,
        ),
        // Preserved through migration: dropping it would let the learner claim
        // the same cluster again on the next pass, duplicating the rule.
        learnedFrom: typeof source.learnedFrom === 'string' ? source.learnedFrom : undefined,
        tags: Array.isArray(source.tags) ? source.tags.map(String).filter(Boolean) : undefined,
      }
    }),
  }
  // Keep regex cache in sync when settings are loaded/migrated (replace semantics).
  replaceMatchPatternCache(
    migrated.entries
      .map((entry) => entry.matchPattern)
      .filter((pattern): pattern is string => typeof pattern === 'string' && pattern.trim().length > 0),
  )
  return migrated
}

/**
 * Declare this plugin's coverage to the self-learning novelty guard: the learner
 * must never re-propose a rule for inputs an existing quick-open pattern already
 * handles (e.g. a hand-coded logid → log tool). A shape is covered only when an
 * entry's matchPattern matches the token AND that entry opens the SAME host —
 * so a rule for one site never suppresses discovery of a different one.
 * Sync; re-registered on settings change.
 */
function registerWebOpenCoverage(settings: WebQuickOpenSettings): void {
  const rules = (settings.entries ?? [])
    .filter((entry) => typeof entry.matchPattern === 'string' && entry.matchPattern.trim().length > 0)
    .map((entry) => ({ pattern: entry.matchPattern as string, host: extractDomain(entry.urlTemplate) }))
  getPluginHostSdk().coverage.register('web-open', (probe) =>
    rules.some(
      (rule) =>
        testMatchPattern(rule.pattern, probe.token) &&
        (!probe.host || !rule.host || rule.host === probe.host),
    ),
  )
}

/**
 * Claim learned url-templates from the self-learning layer.
 *
 * The learner discovers "type this shape → open that page"; that is precisely
 * what a quick-open rule IS, so it belongs in the same list the user already
 * manages — where it can be renamed, retargeted, or corrected. Left in the
 * learner's private store it could only ever be deleted.
 *
 * The counterpart of registerWebOpenCoverage: coverage stops the learner from
 * re-learning what we already do, this takes ownership of what it does learn.
 */
function registerLearnedRuleClaim(pluginId: string, source: 'builtin' | 'installed' | 'dev'): void {
  getPluginHostSdk().learning.registerSink('web-open', (offer) => {
    const learned = learnedOfferToEntry(offer)
    if (!learned) return false

    let claimed = false
    getPluginHostSdk().settings.update<WebQuickOpenSettings>(pluginId, source, (current) => {
      const settings = current ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS
      const merged = mergeLearnedEntry(settings.entries ?? [], learned)
      // Same array back = already present (or user-edited); nothing to write,
      // but we still claim it so the host doesn't keep a duplicate copy.
      claimed = true
      if (merged === settings.entries) return settings
      return { ...settings, entries: merged as WebQuickOpenEntry[] }
    })
    return claimed
  })
}

export default definePlugin<WebQuickOpenSettings>({
  hooks: {
    // App start: warm favicons for current rules so launcher shows site icons after first session.
    startup(ctx) {
      const settings = (ctx.settings as WebQuickOpenSettings | undefined) ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS
      scheduleWarmFavicons(settings, ctx.storage, ctx.source, ctx.pluginId, ctx.network)
      registerWebOpenCoverage(settings)
      registerLearnedRuleClaim(ctx.pluginId, ctx.source)
      applyBrowserCapability(settings)
    },
  },

  settings: {
    // Matches the plugin's displayName (manifest.json) — one identity, one name.
    title: 'Browser',
    titleI18n: { zh: '浏览器' },
    version: 6,
    defaultValue: DEFAULT_WEB_QUICK_OPEN_SETTINGS,
    migrate: migrateWebQuickOpenSettings,
    // Settings write-through: re-warm domains when rules / URL templates change.
    onChange(ctx) {
      const settings = ctx.value ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS
      scheduleWarmFavicons(settings, ctx.storage, ctx.source, ctx.pluginId, ctx.network)
      registerWebOpenCoverage(settings)
      applyBrowserCapability(settings)
    },
    modals: [
      {
        id: 'favicon-cache',
        title: 'Favicon Cache',
        titleI18n: { zh: '网站图标缓存' },
        component: FaviconCacheModal,
      },
      {
        id: 'query-history',
        title: 'Query History',
        titleI18n: { zh: '参数历史' },
        component: QueryHistoryModal,
      },
      {
        id: 'browser-connection',
        title: 'Browser Connection',
        titleI18n: { zh: '浏览器连接' },
        component: BrowserTabsConnectionModal,
      },
    ],
    schema: {
      sections: [
        {
          id: 'general',
          title: 'General',
          titleI18n: { zh: '通用' },
          fields: [
            {
              kind: 'switch',
              key: 'enabled',
              icon: 'Power',
              label: 'Enable plugin',
              labelI18n: { zh: '启用插件' },
              description: 'When disabled, quick-open trigger words stop opening pages.',
              descriptionI18n: { zh: '关闭后所有触发词不再打开网页。' },
            },
          ],
        },
        {
          id: 'cache',
          title: 'Cache',
          titleI18n: { zh: '缓存' },
          description: 'Plugin-internal caches used by quick-open results.',
          descriptionI18n: { zh: '快开规则使用的插件内缓存。' },
          fields: [
            {
              kind: 'modal',
              id: 'favicon-cache',
              modalId: 'favicon-cache',
              icon: 'Image',
              label: 'Favicon cache',
              labelI18n: { zh: '网站图标缓存' },
              description: 'View, remove, or clear cached site icons stored by this plugin.',
              descriptionI18n: { zh: '查看、删除或清空本插件缓存的网站图标。' },
              buttonLabel: 'Manage',
              buttonLabelI18n: { zh: '管理' },
              requires: ['storage.private', 'storage.blob'],
            },
            {
              kind: 'modal',
              id: 'query-history',
              modalId: 'query-history',
              icon: 'History',
              label: 'Query history',
              labelI18n: { zh: '参数历史' },
              description: 'Clear recorded parameters for rules that keep history.',
              descriptionI18n: { zh: '清空已开启记录的规则参数历史。' },
              buttonLabel: 'Manage',
              buttonLabelI18n: { zh: '管理' },
              requires: ['storage.private'],
            },
          ],
        },
        {
          id: 'browser',
          title: 'Browser',
          titleI18n: { zh: '浏览器' },
          description: 'Optional: connect a live Chromium browser to search tabs / history and focus already-open pages instead of opening duplicates. Works only with the companion extension; quick-open above needs none.',
          descriptionI18n: {
            zh: '可选：连接实时 Chromium 浏览器，搜索标签 / 历史，并对已打开的页面直接聚焦而非重复打开。需配套扩展；上面的快开规则无需扩展。',
          },
          fields: [
            {
              kind: 'modal',
              id: 'browser-connection',
              modalId: 'browser-connection',
              icon: 'Globe',
              label: 'Browser connection & tabs',
              labelI18n: { zh: '浏览器连接与标签' },
              description: 'Connection status, browsing history, idle auto-close, and extension install.',
              descriptionI18n: { zh: '连接状态、浏览历史、不活跃自动关闭、扩展安装。' },
              buttonLabel: 'Open',
              buttonLabelI18n: { zh: '打开' },
            },
          ],
        },
        {
          id: 'entries',
          title: 'Rules',
          titleI18n: { zh: '网址规则' },
          description: 'Configure quick-open rules that appear in the launcher.',
          descriptionI18n: { zh: '每条规则拥有自己的触发词、地址模板和打开方式。' },
          fields: [
            {
              kind: 'object-list',
              key: 'entries',
              label: 'Quick-open rules',
              labelI18n: { zh: '快开规则' },
              itemTitleKey: 'title',
              itemTagsKey: 'tags',
              // Localized at render time; the stored value stays 'auto'.
              itemTagLabelsI18n: {
                [AUTO_CREATED_TAG]: { en: 'Auto', zh: '自动创建' },
              },
              addLabel: 'Add rule',
              addLabelI18n: { zh: '添加规则' },
              itemLabel: 'Rule',
              itemLabelI18n: { zh: '规则' },
              emptyText: 'No quick-open rules yet.',
              emptyTextI18n: { zh: '还没有快开规则。' },
              itemDefaults: {
                id: 'web',
                title: 'New rule',
                aliases: [],
                placeholder: '',
                urlTemplate: 'https://example.com/search?q={query}',
                encodeQuery: true,
                emptyQueryBehavior: 'block',
                matchPattern: '',
                recordQueryHistory: false,
                maxQueryHistory: DEFAULT_MAX_QUERY_HISTORY,
              },
              fields: [
                {
                  kind: 'text',
                  key: 'title',
                  label: 'Name',
                  labelI18n: { zh: '名称' },
                  placeholder: 'Google Search',
                  placeholderI18n: { zh: 'Google 搜索' },
                  group: 'Basic',
                  groupI18n: { zh: '基本' },
                },
                {
                  kind: 'string-list',
                  key: 'aliases',
                  label: 'Trigger words',
                  labelI18n: { zh: '触发词' },
                  description: 'Press Enter to add. Any trigger word can launch this rule.',
                  descriptionI18n: { zh: '输入后回车添加，任一词都可唤起。' },
                  placeholder: 'Add trigger word...',
                  placeholderI18n: { zh: '添加触发词…' },
                  rows: 2,
                  group: 'Basic',
                  groupI18n: { zh: '基本' },
                },
                {
                  kind: 'text',
                  key: 'placeholder',
                  label: 'Input placeholder',
                  labelI18n: { zh: '输入提示' },
                  description: 'Hint shown when collecting query text.',
                  descriptionI18n: { zh: '收集查询内容时的输入提示。' },
                  placeholder: 'Search…',
                  placeholderI18n: { zh: '搜索内容…' },
                  group: 'Basic',
                  groupI18n: { zh: '基本' },
                },
                {
                  kind: 'text',
                  key: 'urlTemplate',
                  label: 'Address template',
                  labelI18n: { zh: '地址模板' },
                  description: 'Use {query} and/or {clipboard} as placeholders.',
                  descriptionI18n: { zh: '{query} / {clipboard} 会被输入或剪贴板内容替换。' },
                  placeholder: 'https://www.google.com/search?q={query}',
                  placeholderI18n: { zh: 'https://www.google.com/search?q={query}' },
                  mono: true,
                  group: 'Open behavior',
                  groupI18n: { zh: '打开行为' },
                },
                {
                  kind: 'switch',
                  key: 'encodeQuery',
                  label: 'Encode query',
                  labelI18n: { zh: '自动编码输入内容' },
                  group: 'Open behavior',
                  groupI18n: { zh: '打开行为' },
                },
                {
                  kind: 'select',
                  key: 'emptyQueryBehavior',
                  label: 'Empty input',
                  labelI18n: { zh: '空输入时' },
                  options: [
                    { value: 'block', label: 'Block', labelI18n: { zh: '阻止打开' } },
                    { value: 'open', label: 'Open anyway', labelI18n: { zh: '仍然打开' } },
                  ],
                  group: 'Open behavior',
                  groupI18n: { zh: '打开行为' },
                },
                {
                  kind: 'switch',
                  key: 'recordQueryHistory',
                  label: 'Remember query history',
                  labelI18n: { zh: '记录参数历史' },
                  description: 'Store successful queries for this rule and suggest them next time.',
                  descriptionI18n: { zh: '成功打开后记住参数，下次可从历史中选择。' },
                  group: 'History',
                  groupI18n: { zh: '历史' },
                },
                {
                  kind: 'number',
                  key: 'maxQueryHistory',
                  label: 'History limit',
                  labelI18n: { zh: '历史条数上限' },
                  description: 'Maximum number of remembered parameters for this rule.',
                  descriptionI18n: { zh: '该规则最多保留的历史参数条数。' },
                  min: 1,
                  step: 1,
                  visibleWhen: { key: 'recordQueryHistory', equals: true },
                  group: 'History',
                  groupI18n: { zh: '历史' },
                },
                {
                  kind: 'text',
                  key: 'matchPattern',
                  label: 'Quick match pattern',
                  labelI18n: { zh: '快捷匹配正则' },
                  description: 'When input matches this regex, open directly without secondary input.',
                  descriptionI18n: { zh: '输入匹配该正则时，跳过二次输入直接打开。' },
                  placeholder: '^\\d{9}$',
                  placeholderI18n: { zh: '^\\d{9}$' },
                  mono: true,
                  group: 'Advanced',
                  groupI18n: { zh: '高级' },
                },
              ],
            },
          ],
        },
      ],
    },
  },

  launcher: {
    // Getter: re-resolve icons from memory cache after settings/startup warm.
    get items() {
      return buildLauncherItems()
    },
    dynamicItems: buildDynamicLauncherItems,
  },
})
