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
import {
  AUTO_CREATED_TAG,
  buildWebQuickOpenUrl,
  DEFAULT_MAX_QUERY_HISTORY,
  DEFAULT_WEB_QUICK_OPEN_SETTINGS,
  type WebQuickOpenEntry,
  type WebQuickOpenSettings,
} from './settings/model'
import { isAutoLearnedEntry } from './learnedRules'
import { FaviconCacheModal } from './settings/FaviconCacheModal'
import {
  extractDomain,
  getFaviconIconSync,
  resolveFaviconIconForLauncher,
  warmFaviconDomains,
  FALLBACK_ICON,
} from './faviconCache'
import { replaceMatchPatternCache, testMatchPattern } from './matchPatternCache'
import {
  clampMaxQueryHistory,
  filterQueryHistory,
  importBrowserQueryHistory,
  loadQueryHistory,
  recordQueryHistory,
  removeQueryHistoryEntry,
} from './queryHistory'
import {
  CHROMIUM_SOURCE_ID,
  pushChromiumBridgeConfig,
  refreshChromiumBrowserIndex,
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

function configuredEntries(settings: WebQuickOpenSettings | undefined): WebQuickOpenEntry[] {
  // An explicit empty list means the user removed every rule.
  return settings?.entries ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries
}

type RuleContext = Pick<LauncherExecutionContext<WebQuickOpenSettings>, 'settings' | 't'>

function currentRule(ctx: RuleContext, selected: WebQuickOpenEntry): WebQuickOpenEntry | null {
  if (ctx.settings?.enabled === false) return null
  const current = configuredEntries(ctx.settings).find((entry) => entry.id === selected.id)
  // A retained button must never silently switch targets after a settings edit.
  return current && current.urlTemplate === selected.urlTemplate && current.encodeQuery === selected.encodeQuery
    ? current
    : null
}

function unavailableRule(ctx: RuleContext) {
  return {
    ok: false as const,
    message: ctx.t(ctx.settings?.enabled === false ? 'disabledMessage' : 'ruleChangedMessage'),
  }
}

async function openAndMaybeRecord(
  ctx: Pick<LauncherExecutionContext<WebQuickOpenSettings>, 'api' | 'storage' | 'settings' | 't'>,
  selected: WebQuickOpenEntry,
  query: string,
  requirePattern = false,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const entry = currentRule(ctx, selected)
  if (!entry) return unavailableRule(ctx)
  if (requirePattern && (!entry.matchPattern || !testMatchPattern(entry.matchPattern, query))) {
    return { ok: false, message: ctx.t('ruleChangedMessage') }
  }
  if (entry.emptyQueryBehavior === 'block' && !query.trim()) {
    return { ok: false, message: ctx.t('emptyInputMessage') }
  }
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

function buildHistoryOutput(
  entry: WebQuickOpenEntry,
  items: Awaited<ReturnType<typeof loadQueryHistory>>,
  ctx: Pick<LauncherSuggestContext<WebQuickOpenSettings>, 'api' | 'storage' | 'settings' | 't'>,
): LauncherOutput {
  const icon = entrySiteIcon(entry)
  return {
    choices: items.map((item) => {
      const url = buildWebQuickOpenUrl(entry.urlTemplate, item.text, entry.encodeQuery)
      return {
        id: `history:${entry.id}:${encodeURIComponent(item.text)}`,
        title: item.text,
        subtitle: url,
        icon,
        primaryAction: () => openAndMaybeRecord(ctx, entry, item.text),
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
  const runtimeEntry = currentRule(ctx, entry)
  if (!runtimeEntry || !shouldRecordHistory(runtimeEntry)) return null
  const all = await loadQueryHistory(ctx.storage, runtimeEntry.id)
  const filtered = filterQueryHistory(all, ctx.inputText)
  const current = currentRule(ctx, entry)
  if (!current || !shouldRecordHistory(current) || filtered.length === 0) return null
  return buildHistoryOutput({ ...current }, filtered, ctx)
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

function defaultEntryTextKey(entry: WebQuickOpenEntry, field: 'title' | 'placeholder'): string | undefined {
  const defaults = DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries.find((candidate) => candidate.id === entry.id)
  return defaults && entry[field] === defaults[field] ? `default.${entry.id}.${field}` : undefined
}

function buildEntryLauncherItem(
  entry: WebQuickOpenSettings['entries'][number],
): LauncherItemContribution<WebQuickOpenSettings> {
  // Capture the selected target even if a caller mutates its settings object.
  entry = { ...entry }
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  const titleKey = defaultEntryTextKey(entry, 'title')
  const placeholderKey = defaultEntryTextKey(entry, 'placeholder')
  const title = entry.title || entry.urlTemplate
  return {
    id: entry.id,
    surfaces: ['global-launcher'],
    // Stable site/action id for favorites and existing references.
    recordUsage: true,
    display: {
      title: titleKey ?? title,
      // User text can equal a locale key. Explicit values keep it literal.
      titleI18n: titleKey ? undefined : { en: title, zh: title },
      icon: entrySiteIcon(entry),
      aliases: [
        ...aliases,
        entry.placeholder,
        entry.urlTemplate,
      ].filter(Boolean),
    },
    behavior: {
      type: 'collect-input' as const,
      input: {
        placeholder: placeholderKey ?? entry.placeholder,
        placeholderI18n: placeholderKey ? undefined : { en: entry.placeholder, zh: entry.placeholder },
        allowEmptyInput: entry.emptyQueryBehavior !== 'block',
        emptyInputMessage: entry.emptyQueryBehavior === 'block' ? 'emptyInputMessage' : undefined,
      },
    },
    suggest: (ctx) => suggestHistoryForEntry(ctx, entry),
    execute: (ctx) => openAndMaybeRecord(ctx, entry, ctx.input?.text ?? ''),
  }
}

/** Rebuilt from current settings so browsing, favorites and search share one identity. */
function buildLauncherItems(settings: WebQuickOpenSettings): LauncherItemContribution<WebQuickOpenSettings>[] {
  if (settings?.enabled === false) return []
  return configuredEntries(settings)
    .filter((entry) => !isAutoLearnedEntry(entry))
    .map((entry) => buildEntryLauncherItem(entry))
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
  const entries = configuredEntries(settings)
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
  for (const configuredEntry of entries) {
    const entry = { ...configuredEntry }
    if (!entry.matchPattern) continue
    if (!testMatchPattern(entry.matchPattern, query)) continue

    const url = buildWebQuickOpenUrl(entry.urlTemplate, query, entry.encodeQuery)
    const icon = resolveLauncherIcon(url, ctx)
    const titleKey = defaultEntryTextKey(entry, 'title')

    results.push({
      id: entry.id + '-quick',
      surfaces: ['global-launcher'],
      // Pattern-matched site templates are stable intents (e.g. google-quick).
      recordUsage: true,
      display: {
        title: titleKey ? ctx.t(titleKey) : entry.title || entry.urlTemplate,
        subtitle: url,
        icon,
        // Keep the matched query as an alias so ranking matchScore stays high
        // even if host filters by searchable fields (title-only policy).
        aliases: [query, entry.title, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter(Boolean),
      },
      behavior: { type: 'perform' as const },
      async execute(execCtx) {
        return openAndMaybeRecord(execCtx as LauncherExecutionContext<WebQuickOpenSettings>, entry, query, true)
      },
    })
  }

  // B. Direct URL open
  if (isValidUrl(query)) {
    const icon = resolveLauncherIcon(query, ctx)

    results.push({
      id: 'direct-url-open',
      surfaces: ['global-launcher'],
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
        const current = execCtx as LauncherExecutionContext<WebQuickOpenSettings>
        if (current.settings?.enabled === false) return unavailableRule(current)
        await execCtx.api.openUrl(query)
        return { ok: true }
      },
    })
  }

  return results
}

function migrateWebQuickOpenSettings(stored: unknown): WebQuickOpenSettings {
  const value = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Partial<WebQuickOpenSettings>
    : {}
  const entries = Array.isArray(value.entries) ? value.entries : DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries
  const migrated: WebQuickOpenSettings = {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_WEB_QUICK_OPEN_SETTINGS.enabled,
    entries: entries
      .map((entry, index): WebQuickOpenEntry => {
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
          // Preserve legacy provenance until the cleanup filter below can
          // distinguish automatically learned rules from manual entries.
          learnedFrom: typeof source.learnedFrom === 'string' ? source.learnedFrom : undefined,
          tags: Array.isArray(source.tags) ? source.tags.map(String).filter(Boolean) : undefined,
        }
      })
      // Generic URL-shape learning produced unrelated hard matches (for example
      // a log ID substituted into a ChatGPT checkout URL). Keep manual rules.
      .filter((entry) => !isAutoLearnedEntry(entry)),
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

export default definePlugin<WebQuickOpenSettings>({
  background: {
    async start(ctx) {
      let refreshTimer: ReturnType<typeof setTimeout> | undefined
      const scheduleRefresh = () => {
        if (refreshTimer) clearTimeout(refreshTimer)
        refreshTimer = setTimeout(() => void refreshChromiumBrowserIndex(), 2_000)
      }
      const stopOpened = await getPluginHostSdk().events.subscribe('browser.opened', (event) => {
        if (event.source.channel !== CHROMIUM_SOURCE_ID || !event.payload.url) return
        void importBrowserQueryHistory(ctx.storage, ctx.settings.entries, [{
          url: event.payload.url,
          lastVisitTime: event.payload.ts,
        }])
        scheduleRefresh()
      })
      const stopActivated = await getPluginHostSdk().events.subscribe('browser.activated', (event) => {
        if (event.source.channel === CHROMIUM_SOURCE_ID) scheduleRefresh()
      })
      return () => {
        stopOpened()
        stopActivated()
        if (refreshTimer) clearTimeout(refreshTimer)
      }
    },
  },
  hooks: {
    // App start: warm favicons for current rules so launcher shows site icons after first session.
    startup(ctx) {
      const settings = (ctx.settings as WebQuickOpenSettings | undefined) ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS
      scheduleWarmFavicons(settings, ctx.storage, ctx.source, ctx.pluginId, ctx.network)
      registerWebOpenCoverage(settings)
      applyBrowserCapability(settings)
    },
  },

  settings: {
    // Matches the plugin's displayName (manifest.json) — one identity, one name.
    title: 'Browser',
    titleI18n: { zh: '浏览器' },
    version: 9,
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
          id: 'entries',
          title: 'Quick-open rules',
          titleI18n: { zh: '快开规则' },
          description: 'Open websites or search with trigger words.',
          descriptionI18n: { zh: '用触发词打开网站或搜索内容。' },
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
        {
          id: 'browser',
          title: 'Optional browser connection',
          titleI18n: { zh: '可选浏览器连接' },
          description: 'Quick-open rules work without an extension. Connect the companion extension to search Chromium tabs and history, and focus pages that are already open.',
          descriptionI18n: {
            zh: '快开规则无需扩展。连接配套扩展后，可搜索 Chromium 浏览器的实时标签和历史，并聚焦已打开的页面。',
          },
          fields: [
            {
              kind: 'modal',
              id: 'browser-connection',
              modalId: 'browser-connection',
              icon: 'Globe',
              label: 'Browser connection settings',
              labelI18n: { zh: '浏览器连接设置' },
              description: 'Check connection status, install the extension, and configure tab search, history sharing, and idle tab closing.',
              descriptionI18n: { zh: '查看连接状态、安装扩展，设置标签搜索、历史共享和不活跃标签自动关闭。' },
              buttonLabel: 'Configure',
              buttonLabelI18n: { zh: '设置' },
            },
            {
              kind: 'action',
              id: 'browser-history-learning',
              icon: 'History',
              label: 'Import parameters from browser history',
              labelI18n: { zh: '从浏览历史导入参数' },
              description: 'Read browser history and import matching parameters into rules with query history enabled.',
              descriptionI18n: { zh: '读取浏览历史，为已开启「记录参数历史」的规则导入匹配参数。' },
              buttonLabel: 'Read and import',
              buttonLabelI18n: { zh: '读取并导入' },
              requires: ['storage.private'],
              async run({ value, host, t, reportProgress }) {
                try {
                  let count = 0
                  reportProgress({ current: 0, total: 5_000, label: t('queryHistory.learningProgress', { read: 0, learned: 0 }) })
                  await getPluginHostSdk().desktopTargets.bridge.importHistory(
                    CHROMIUM_SOURCE_ID,
                    async (history, received) => {
                      count += await importBrowserQueryHistory(host.storage, value.entries ?? [], history)
                      reportProgress({
                        current: received,
                        total: 5_000,
                        label: t('queryHistory.learningProgress', { read: received, learned: count }),
                      })
                    },
                  )
                  host.showMessage(
                    count > 0 ? t('queryHistory.learned', { count }) : t('queryHistory.noneLearned'),
                    count > 0 ? 'success' : 'info',
                  )
                } catch (error) {
                  host.showMessage(t('queryHistory.learnFailedDetail', {
                    error: error instanceof Error ? error.message : String(error),
                  }), 'error')
                }
              },
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
          ],
        },
      ],
    },
  },

  launcher: {
    itemsFor: buildLauncherItems,
    dynamicItems: buildDynamicLauncherItems,
  },
})
