/**
 * Clipboard History Plugin — Entry Point
 *
 * Only assembles contributions from local modules.
 * No complex JSX, CSS, or business logic here.
 */

import { definePlugin } from '@hiven/plugin'
import type { ClipboardHistorySettings } from './settings/model'
import { DEFAULT_CLIPBOARD_HISTORY_SETTINGS } from './settings/model'
import { ClipboardHistorySettingsBody } from './settings/ClipboardHistorySettingsBody'
import { ClipboardHistorySurface } from './surfaces/ClipboardHistorySurface'
import { clipboardHistoryBackground } from './background/clipboardHistoryBackground'

export default definePlugin<ClipboardHistorySettings>({
  settings: {
    title: 'Clipboard History',
    titleI18n: { zh: '剪贴板历史' },
    version: 1,
    defaultValue: DEFAULT_CLIPBOARD_HISTORY_SETTINGS,
    component: ClipboardHistorySettingsBody,
  },

  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Clipboard History',
        titleI18n: { zh: '剪贴板历史' },
        icon: 'clipboard',
        aliases: ['clipboard', 'paste', 'history', '剪贴板', '粘贴板', '剪切板'],
        component: ClipboardHistorySurface,
        entry: {
          launcher: true,
          shortcutBindable: true,
          recommendedShortcut: 'CmdOrCtrl+Shift+V',
        },
        shell: {
          defaultWidth: 900,
          defaultHeight: 640,
          minWidth: 500,
          minHeight: 360,
          closeOnBlur: true,
          resizable: false,
        },
      },
    ],
  },

  background: clipboardHistoryBackground,
})
