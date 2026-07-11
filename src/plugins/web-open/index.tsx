/**
 * Web Quick Open Plugin
 * Allows users to configure URL templates and quickly open web pages
 * via the launcher collect-input flow.
 */

import {
  definePlugin,
  type LauncherDynamicContext,
  type LauncherItemContribution,
} from '@hiven/plugin'
import {
  buildWebQuickOpenUrl,
  DEFAULT_WEB_QUICK_OPEN_SETTINGS,
  type WebQuickOpenSettings,
} from './settings/model'
import { FaviconCacheModal } from './settings/FaviconCacheModal'
import { extractDomain, resolveFaviconIconForLauncher, FALLBACK_ICON } from './faviconCache'
import { replaceMatchPatternCache, testMatchPattern } from './matchPatternCache'

function buildEntryLauncherItem(entry: WebQuickOpenSettings['entries'][number]): LauncherItemContribution<WebQuickOpenSettings> {
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  return {
    id: entry.id,
    display: {
      title: entry.title || entry.urlTemplate,
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
    async execute(ctx) {
      if (ctx.settings?.enabled === false) {
        const message = ctx.t('disabledMessage')
        ctx.api.showMessage(message, 'warning')
        return { ok: false, message }
      }
      const runtimeEntry = ctx.settings?.entries?.find((candidate) => candidate.id === entry.id) ?? entry
      const url = buildWebQuickOpenUrl(runtimeEntry.urlTemplate, ctx.input?.text ?? '', runtimeEntry.encodeQuery)
      await ctx.api.openUrl(url)
      return { ok: true }
    },
  }
}

function buildLauncherItems(): LauncherItemContribution<WebQuickOpenSettings>[] {
  return DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries.map(buildEntryLauncherItem)
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
  return resolveFaviconIconForLauncher(domain, ctx.storage, ctx.source, ctx.pluginId)
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
      display: {
        title: entry.title || entry.urlTemplate,
        subtitle: url,
        icon,
      },
      behavior: { type: 'perform' as const },
      async execute(execCtx) {
        await execCtx.api.openUrl(url)
        return { ok: true }
      },
    })
  }

  // B. Direct URL open
  if (isValidUrl(query)) {
    const icon = resolveLauncherIcon(query, ctx)

    results.push({
      id: 'direct-url-open',
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
  const keywordMatches = entries
    .filter((entry) => !isUnchangedDefaultEntry(entry))
    .filter((entry) => entryMatchesQuery(entry, ctx.query))
    .map((entry) => buildEntryLauncherItem(entry) as LauncherItemContribution)

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

export default definePlugin<WebQuickOpenSettings>({
  settings: {
    title: 'Web Quick Open',
    titleI18n: { zh: '网页快开' },
    version: 5,
    defaultValue: DEFAULT_WEB_QUICK_OPEN_SETTINGS,
    migrate: migrateWebQuickOpenSettings,
    modals: [
      {
        id: 'favicon-cache',
        title: 'Favicon Cache',
        titleI18n: { zh: '网站图标缓存' },
        component: FaviconCacheModal,
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
          description: 'Plugin-internal favicon cache used by quick-open results.',
          descriptionI18n: { zh: '网页快开结果使用的插件内网站图标缓存。' },
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
              labelI18n: { zh: '网页快开规则' },
              itemTitleKey: 'title',
              addLabel: 'Add rule',
              addLabelI18n: { zh: '添加规则' },
              itemLabel: 'Rule',
              itemLabelI18n: { zh: '规则' },
              emptyText: 'No quick-open rules yet.',
              emptyTextI18n: { zh: '还没有网页快开规则。' },
              itemDefaults: {
                id: 'web',
                title: 'New rule',
                aliases: [],
                placeholder: '',
                urlTemplate: 'https://example.com/search?q={query}',
                encodeQuery: true,
                emptyQueryBehavior: 'block',
                matchPattern: '',
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
                  description: 'Use {query} as the input placeholder.',
                  descriptionI18n: { zh: '{query} 会被命令面板中输入的查询内容替换。' },
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
    items: buildLauncherItems(),
    dynamicItems: buildDynamicLauncherItems,
  },
})
