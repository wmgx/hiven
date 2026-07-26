/**
 * Feishu / Lark first-party plugin.
 * L1 mix-in: docs / chats / contacts via Desktop Targets.
 * L2 tools: status, login, search, writes, fetch, etc.
 */

import { definePlugin } from '@hiven/plugin'
import {
  applyFeishuProviderRegistration,
  bindFeishuRuntime,
} from './runtime'
import type { FeishuSettings } from './settings/model'
import { DEFAULT_FEISHU_SETTINGS } from './settings/model'
import { FeishuSettingsBody } from './settings/FeishuSettingsBody'
import { feishuTools } from './tools'

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
    },
  },
  tools: feishuTools,
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
    },
  },
})
