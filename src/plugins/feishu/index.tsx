/**
 * Feishu / Lark first-party plugin (B0 + B1).
 * Controlled shell → lark-cli; L1 docs mix-in + L2 status/login/search tools.
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

function shouldRegisterProvider(settings: FeishuSettings): boolean {
  return settings.enabled !== false && settings.docsMixEnabled !== false
}

export default definePlugin<FeishuSettings>({
  settings: {
    title: 'Feishu',
    titleI18n: { zh: '飞书' },
    version: 1,
    defaultValue: DEFAULT_FEISHU_SETTINGS,
    schema: {
      sections: [
        {
          id: 'feishu',
          title: 'Feishu',
          titleI18n: { zh: '飞书' },
          description: 'Search Feishu docs in Global Launcher via local lark-cli.',
          descriptionI18n: {
            zh: '通过本机 lark-cli 在 Global Launcher 中搜索飞书文档。',
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
      applyFeishuProviderRegistration(shouldRegisterProvider(value))
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
      applyFeishuProviderRegistration(shouldRegisterProvider(settings))
    },
  },
})
