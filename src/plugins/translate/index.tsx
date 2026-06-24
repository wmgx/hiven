import { definePlugin } from '@hiven/plugin'
import type { TranslateSettings } from './settings/model'
import { DEFAULT_TRANSLATE_SETTINGS } from './settings/model'
import { TranslateSettingsPanel } from './settings/TranslateSettingsPanel'
import { TranslateSurface } from './surfaces/TranslateSurface'
import './style.css'

export default definePlugin<TranslateSettings>({
  settings: {
    title: 'Translate',
    titleI18n: { zh: '翻译' },
    version: 1,
    defaultValue: DEFAULT_TRANSLATE_SETTINGS,
    component: TranslateSettingsPanel,
  },
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Translate',
        titleI18n: { zh: '翻译' },
        icon: 'Languages',
        aliases: ['translate', 'translation', '翻译', 'fanyi'],
        component: TranslateSurface,
        entry: {
          launcher: true,
          shortcutBindable: true,
          recommendedShortcut: 'CmdOrCtrl+Shift+T',
        },
        shell: {
          defaultWidth: 960,
          defaultHeight: 620,
          minWidth: 760,
          minHeight: 420,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
})
