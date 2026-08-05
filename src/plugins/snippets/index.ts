/**
 * First-party Snippets plugin — template expand via launcher tools.
 * Keyword expansion is settings-flagged but not wired (v1).
 */

import { definePlugin, type PluginToolContribution } from '@hiven/plugin'
import { expandSnippetTemplate } from './expand'
import {
  DEFAULT_SNIPPETS_SETTINGS,
  enabledSnippets,
  normalizeSnippetsSettings,
  type SnippetEntry,
  type SnippetsSettings,
} from './model'

function buildSnippetTools(settings: SnippetsSettings): PluginToolContribution<SnippetsSettings>[] {
  return enabledSnippets(settings).map((snippet: SnippetEntry): PluginToolContribution<SnippetsSettings> => ({
    id: 'snippets.expand.' + snippet.id,
    title: snippet.title,
    subtitle: 'tool.expand.subtitle',
    icon: 'FileText',
    aliases: [
      snippet.title,
      ...(snippet.aliases ?? []),
      ...(snippet.keyword ? [snippet.keyword] : []),
      'snippet',
      '片段',
    ].filter(Boolean),
    inputPolicy: { mode: 'auto' },
    async run(ctx) {
      const body = snippet.body?.trim()
      if (!body) return ctx.output.error(ctx.t('tool.expand.empty'))
      let clipboard = ''
      try {
        clipboard = (await ctx.api.getClipboardText()) ?? ''
      } catch {
        clipboard = ''
      }
      const selection = ctx.input?.text ?? ''
      const expanded = expandSnippetTemplate(body, {
        clipboard,
        selection,
        query: selection,
      })
      return ctx.output.text(expanded)
    },
    surfaces: { launcher: true, panel: false },
  }))
}

export default definePlugin<SnippetsSettings>({
  settings: {
    title: 'settings.title',
    titleI18n: { zh: '文本片段' },
    version: 1,
    defaultValue: DEFAULT_SNIPPETS_SETTINGS,
    migrate: (raw) => normalizeSnippetsSettings(raw),
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
              label: 'settings.enabled',
              labelI18n: { zh: '启用片段' },
              description: 'settings.enabled.desc',
              descriptionI18n: { zh: '关闭后片段命令不再出现在 Launcher。' },
            },
            {
              kind: 'switch',
              key: 'keywordExpansionEnabled',
              icon: 'Keyboard',
              label: 'settings.keywordExpansion',
              labelI18n: { zh: '关键词展开（后续版本）' },
              description: 'settings.keywordExpansion.desc',
              descriptionI18n: {
                zh: 'v1 故意不做后台击键展开。请在此管理片段，并从 Launcher 运行。',
              },
            },
          ],
        },
        {
          id: 'library',
          title: 'Library',
          titleI18n: { zh: '片段库' },
          fields: [
            {
              kind: 'object-list',
              key: 'snippets',
              label: 'settings.list',
              labelI18n: { zh: '片段库' },
              itemTitleKey: 'title',
              addLabel: 'settings.add',
              addLabelI18n: { zh: '添加片段' },
              itemLabel: 'settings.item',
              itemLabelI18n: { zh: '片段' },
              emptyText: 'settings.empty',
              emptyTextI18n: { zh: '还没有片段。' },
              itemDefaults: {
                id: 'snip-new',
                title: 'New snippet',
                body: '{clipboard}',
                aliases: [],
                keyword: '',
                enabled: true,
              },
              fields: [
                {
                  kind: 'text',
                  key: 'title',
                  label: 'field.title',
                  labelI18n: { zh: '名称' },
                },
                {
                  kind: 'textarea',
                  key: 'body',
                  label: 'field.body',
                  labelI18n: { zh: '模板正文' },
                  description: 'field.body.desc',
                  descriptionI18n: {
                    zh: '占位符：{clipboard} {selection} {query} {date} {time} {datetime}',
                  },
                },
                {
                  kind: 'string-list',
                  key: 'aliases',
                  label: 'field.aliases',
                  labelI18n: { zh: '别名' },
                  description: 'field.aliases.desc',
                  descriptionI18n: { zh: '回车添加。任一别名可在 Launcher 搜到该片段。' },
                },
                {
                  kind: 'text',
                  key: 'keyword',
                  label: 'field.keyword',
                  labelI18n: { zh: '关键词（预留）' },
                },
                {
                  kind: 'switch',
                  key: 'enabled',
                  label: 'field.enabled',
                  labelI18n: { zh: '启用' },
                },
              ],
            },
          ],
        },
      ],
    },
  },
  // Full catalog is dynamic per settings; toolsFor rebuilds from snippet library.
  tools: [],
  toolsFor(settings) {
    return buildSnippetTools(normalizeSnippetsSettings(settings))
  },
})

// Re-export for unit tests
export { expandSnippetTemplate } from './expand'
export { DEFAULT_SNIPPETS_SETTINGS, normalizeSnippetsSettings, enabledSnippets } from './model'
