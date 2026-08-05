/**
 * Browser Tabs — first-party product shell for D3.
 * Registers browser.chromium via host Desktop Target protocol (not dynamicItems).
 */

import { definePlugin } from '@hiven/plugin'
import type { BrowserTabsSettings } from './settings/model'
import { DEFAULT_BROWSER_TABS_SETTINGS } from './settings/model'
import { BrowserTabsSettingsBody } from './settings/BrowserTabsSettingsBody'
import {
  registerChromiumTabsProvider,
  unregisterChromiumTabsProvider,
} from './provider'

function applyProviderRegistration(enabled: boolean): void {
  if (enabled) registerChromiumTabsProvider()
  else unregisterChromiumTabsProvider()
}

export default definePlugin<BrowserTabsSettings>({
  settings: {
    title: 'Browser Tabs',
    titleI18n: { zh: '浏览器标签' },
    version: 1,
    defaultValue: DEFAULT_BROWSER_TABS_SETTINGS,
    // Minimal schema so hosts that gate on schema still show a settings entry;
    // the real UI is the custom component (install guide + connection status).
    schema: {
      sections: [
        {
          id: 'browser-tabs',
          title: 'Browser Tabs',
          titleI18n: { zh: '浏览器标签' },
          description: 'Search open Chromium tabs from Global Launcher. Install the browser extension from this page.',
          descriptionI18n: {
            zh: '在 Global Launcher 中搜索已打开的浏览器标签。请在本页安装浏览器扩展。',
          },
          fields: [],
        },
      ],
    },
    component: BrowserTabsSettingsBody,
    onChange: ({ value }) => {
      applyProviderRegistration(value.enabled !== false)
    },
  },
  hooks: {
    startup(ctx) {
      const settings = (ctx.settings ?? DEFAULT_BROWSER_TABS_SETTINGS) as BrowserTabsSettings
      applyProviderRegistration(settings.enabled !== false)
    },
  },
})
