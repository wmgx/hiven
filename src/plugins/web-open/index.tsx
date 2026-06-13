/**
 * Web Quick Open Plugin
 * Allows users to configure URL templates and quickly open web pages
 * via the launcher collect-input flow.
 */

import {
  definePlugin,
  type LauncherItemContribution,
} from '@hiven/plugin'
import { WebQuickOpenSettingsBody } from './settings/WebQuickOpenSettingsBody'
import {
  buildWebQuickOpenUrl,
  DEFAULT_WEB_QUICK_OPEN_SETTINGS,
  type WebQuickOpenSettings,
} from './settings/model'

/**
 * Build launcher items from the default web search entries.
 * Static items are based on DEFAULT settings; the execute handler reads runtime
 * settings via ctx.settings so URL templates/encode options reflect user changes.
 *
 * Note: User-added entries beyond defaults require a settings-reactive mechanism
 * (future enhancement). For now, only default entries are statically registered.
 */
function buildLauncherItems(): LauncherItemContribution<WebQuickOpenSettings>[] {
  const entries = DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries

  return entries.map((entry) => ({
    id: entry.id,
    display: {
      title: entry.title,
      aliases: entry.aliases,
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
      // Resolve entry from runtime settings (user may have changed URL template)
      const runtimeEntry = ctx.settings?.entries?.find((e) => e.id === entry.id) ?? entry
      const url = buildWebQuickOpenUrl(runtimeEntry.urlTemplate, ctx.input?.text ?? '', runtimeEntry.encodeQuery)
      await ctx.api.openUrl(url)
      return { ok: true }
    },
  }))
}

export default definePlugin<WebQuickOpenSettings>({
  settings: {
    title: 'Web Quick Open',
    titleI18n: { zh: '网页快开' },
    version: 1,
    defaultValue: DEFAULT_WEB_QUICK_OPEN_SETTINGS,
    component: WebQuickOpenSettingsBody,
  },

  launcher: {
    items: buildLauncherItems(),
  },
})
