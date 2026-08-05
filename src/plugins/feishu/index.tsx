/**
 * Feishu / Lark first-party plugin.
 * L1 mix-in: docs / chats / contacts via Desktop Targets.
 * L2 tools: status, login, search, writes, fetch, etc.
 */

import { definePlugin, getPluginHostSdk } from '@hiven/plugin'
import {
  applyFeishuProviderRegistration,
  bindFeishuRuntime,
} from './runtime'
import type { FeishuSettings } from './settings/model'
import { DEFAULT_FEISHU_SETTINGS } from './settings/model'
import { FeishuSettingsBody } from './settings/FeishuSettingsBody'
import { feishuTools } from './tools'
import { selectVisibleFeishuTools } from './toolVisibility'

/** Client schemes Feishu needs host openUrl to deliver (not Tauri shell scope). */
const FEISHU_OPEN_SCHEMES = ['lark', 'feishu', 'x-feishu', 'x-lark'] as const

function registerFeishuUrlSchemes(): void {
  try {
    getPluginHostSdk().urlSchemes.register('feishu', [...FEISHU_OPEN_SCHEMES])
  } catch {
    // SDK may be unavailable in pure unit tests
  }
}

export default definePlugin<FeishuSettings>({
  settings: {
    title: 'Feishu',
    titleI18n: { zh: '飞书' },
    version: 2,
    defaultValue: DEFAULT_FEISHU_SETTINGS,
    migrate: (stored) => {
      const base = { ...DEFAULT_FEISHU_SETTINGS }
      if (stored && typeof stored === 'object') {
        return { ...base, ...(stored as Partial<FeishuSettings>) }
      }
      return base
    },
    schema: {
      sections: [
        {
          id: 'feishu',
          title: 'Feishu',
          titleI18n: { zh: '飞书' },
          description: 'Search Feishu docs, chats, and people in Global Launcher via local lark-cli.',
          descriptionI18n: {
            zh: '通过本机 lark-cli 在 Global Launcher 中混排飞书文档、会话与联系人。',
          },
          fields: [],
        },
      ],
    },
    component: FeishuSettingsBody,
    onChange: ({ value, shell }) => {
      bindFeishuRuntime({
        shell,
        settings: value,
      })
      applyFeishuProviderRegistration(value)
      registerFeishuUrlSchemes()
    },
  },
  tools: feishuTools,
  toolsFor: (settings: FeishuSettings) =>
    selectVisibleFeishuTools(feishuTools, {
      advancedToolsEnabled: settings?.advancedToolsEnabled === true,
    }),
  hooks: {
    startup(ctx) {
      const settings = (ctx.settings ?? DEFAULT_FEISHU_SETTINGS) as FeishuSettings
      bindFeishuRuntime({
        shell: ctx.shell,
        settings,
        openUrl: (url) => ctx.api.openUrl(url),
        t: ctx.t,
      })
      applyFeishuProviderRegistration(settings)
      // Host openUrl routes lark:// via open_system_url after plugin registration.
      registerFeishuUrlSchemes()
    },
  },
})
