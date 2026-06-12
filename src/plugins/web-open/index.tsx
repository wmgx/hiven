/**
 * Web Quick Open Plugin
 * Allows users to configure URL templates and quickly open web pages
 * via the GlobalLauncher secondary input mode.
 */

import { definePlugin, type LauncherQuickEntry, type PluginCommandResult } from '@hiven/plugin'
import { WebQuickOpenSettingsBody } from './settings/WebQuickOpenSettingsBody'
import {
  buildWebQuickOpenUrl,
  DEFAULT_WEB_QUICK_OPEN_SETTINGS,
  type WebQuickOpenSettings,
} from './settings/model'

export default definePlugin<WebQuickOpenSettings>({
  settings: {
    title: 'Web Quick Open',
    titleI18n: { zh: '网页快开' },
    version: 1,
    defaultValue: DEFAULT_WEB_QUICK_OPEN_SETTINGS,
    component: WebQuickOpenSettingsBody,
  },

  launcherQuickEntries: {
    getEntries(ctx): LauncherQuickEntry[] {
      const settings = ctx.settings as WebQuickOpenSettings | undefined
      const entries = settings?.entries ?? DEFAULT_WEB_QUICK_OPEN_SETTINGS.entries

      return entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        aliases: entry.aliases,
        placeholder: entry.placeholder,
        allowEmptyInput: entry.emptyQueryBehavior !== 'block',
        emptyInputMessage: entry.emptyQueryBehavior === 'block' ? '请输入内容' : undefined,
        emptyInputMessageI18n: entry.emptyQueryBehavior === 'block' ? { zh: '请输入内容', en: 'Please enter content' } : undefined,
        run(input: string): PluginCommandResult {
          const url = buildWebQuickOpenUrl(entry.urlTemplate, input, entry.encodeQuery)
          return {
            effects: [{ type: 'app.openExternal', url }],
          }
        },
      }))
    },
  },
})
