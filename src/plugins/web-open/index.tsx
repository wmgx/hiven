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
        emptyInputMessage: entry.emptyQueryBehavior === 'block' ? '请输入内容' : undefined,
        emptyInputMessageI18n: entry.emptyQueryBehavior === 'block'
          ? { zh: '请输入内容', en: 'Please enter content' }
          : undefined,
      },
    },
    async execute(ctx) {
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

function buildDynamicLauncherItems(ctx: LauncherDynamicContext): LauncherItemContribution[] {
  const settings = ctx.settings as WebQuickOpenSettings | undefined
  const entries = settings?.entries ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries
  return entries
    .filter((entry) => !isUnchangedDefaultEntry(entry))
    .filter((entry) => entryMatchesQuery(entry, ctx.query))
    .map((entry) => buildEntryLauncherItem(entry) as LauncherItemContribution)
}

export default definePlugin<WebQuickOpenSettings>({
  settings: {
    title: 'Web Quick Open',
    titleI18n: { zh: '网页快开' },
    version: 1,
    defaultValue: DEFAULT_WEB_QUICK_OPEN_SETTINGS,
    schema: {
      sections: [
        {
          id: 'entries',
          title: 'Rules',
          titleI18n: { zh: '规则' },
          description: 'Configure quick-open rules that appear in the launcher.',
          descriptionI18n: { zh: '配置会出现在启动器里的网页快开规则。' },
          fields: [
            {
              kind: 'object-list',
              key: 'entries',
              label: 'Quick-open rules',
              labelI18n: { zh: '网页快开规则' },
              addLabel: 'Add rule',
              addLabelI18n: { zh: '添加规则' },
              itemLabel: 'Rule',
              itemLabelI18n: { zh: '规则' },
              emptyText: 'No quick-open rules yet.',
              emptyTextI18n: { zh: '还没有网页快开规则。' },
              itemDefaults: {
                id: 'web',
                title: '',
                aliases: [],
                placeholder: '',
                urlTemplate: 'https://example.com/search?q={query}',
                encodeQuery: true,
                emptyQueryBehavior: 'block',
              },
              fields: [
                {
                  kind: 'text',
                  key: 'title',
                  label: 'Name',
                  labelI18n: { zh: '名称' },
                  placeholder: 'Google Search',
                  placeholderI18n: { zh: 'Google 搜索' },
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
                },
                {
                  kind: 'text',
                  key: 'placeholder',
                  label: 'Launcher input hint',
                  labelI18n: { zh: '启动器输入提示' },
                  placeholder: 'Search keyword',
                  placeholderI18n: { zh: '输入搜索关键词' },
                },
                {
                  kind: 'textarea',
                  key: 'urlTemplate',
                  label: 'Address template',
                  labelI18n: { zh: '地址模板' },
                  description: 'Use {query} as the input placeholder.',
                  descriptionI18n: { zh: '{query} 会被命令面板中输入的查询内容替换。' },
                  placeholder: 'https://www.google.com/search?q={query}',
                  placeholderI18n: { zh: 'https://www.google.com/search?q={query}' },
                  rows: 2,
                  mono: true,
                },
                {
                  kind: 'switch',
                  key: 'encodeQuery',
                  label: 'Encode query',
                  labelI18n: { zh: '自动编码输入内容' },
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
