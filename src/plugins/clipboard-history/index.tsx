/**
 * Clipboard History Plugin — Entry Point
 *
 * Only assembles contributions from local modules.
 * No complex JSX, CSS, or business logic here.
 */

import { definePlugin } from '@hiven/plugin'
import type { ClipboardHistorySettings } from './settings/model'
import { DEFAULT_CLIPBOARD_HISTORY_SETTINGS } from './settings/model'
import { ClipboardHistorySurface } from './surfaces/ClipboardHistorySurface'
import { clipboardHistoryBackground } from './background/clipboardHistoryBackground'

const MB = 1024 * 1024

export default definePlugin<ClipboardHistorySettings>({
  settings: {
    title: 'Clipboard History',
    titleI18n: { zh: '剪贴板历史' },
    version: 1,
    defaultValue: DEFAULT_CLIPBOARD_HISTORY_SETTINGS,
    schema: {
      sections: [
        {
          id: 'recording',
          title: 'Recording',
          titleI18n: { zh: '记录内容' },
          description: 'Choose which clipboard changes hiven should keep.',
          descriptionI18n: { zh: '选择 hiven 要保留哪些剪贴板变化。' },
          fields: [
            {
              kind: 'switch',
              key: 'enabled',
              label: 'Enable clipboard history',
              labelI18n: { zh: '启用剪贴板历史' },
            },
            {
              kind: 'switch',
              key: 'recordText',
              label: 'Record text',
              labelI18n: { zh: '记录文本' },
            },
            {
              kind: 'switch',
              key: 'recordImages',
              label: 'Record images',
              labelI18n: { zh: '记录图片' },
            },
            {
              kind: 'switch',
              key: 'recordFiles',
              label: 'Record file paths',
              labelI18n: { zh: '记录文件路径' },
            },
          ],
        },
        {
          id: 'limits',
          title: 'Limits',
          titleI18n: { zh: '限制' },
          fields: [
            {
              kind: 'number',
              key: 'maxItems',
              label: 'Maximum items',
              labelI18n: { zh: '最大条数' },
              min: 10,
              max: 10000,
              step: 10,
            },
            {
              kind: 'number',
              key: 'retentionDays',
              label: 'Retention days',
              labelI18n: { zh: '保留天数' },
              min: 1,
              max: 365,
              step: 1,
            },
            {
              kind: 'number',
              key: 'maxTextBytes',
              label: 'Max text size',
              labelI18n: { zh: '文本单项大小上限' },
              min: 0.01,
              step: 0.25,
              unit: 'MB',
              storageScale: MB,
            },
            {
              kind: 'number',
              key: 'maxImageBytes',
              label: 'Max image size',
              labelI18n: { zh: '图片单项大小上限' },
              min: 1,
              step: 1,
              unit: 'MB',
              storageScale: MB,
            },
            {
              kind: 'number',
              key: 'maxTotalCacheBytes',
              label: 'Max total cache size',
              labelI18n: { zh: '总缓存容量上限' },
              min: 1,
              step: 10,
              unit: 'MB',
              storageScale: MB,
            },
          ],
        },
        {
          id: 'actions',
          title: 'Behavior',
          titleI18n: { zh: '行为' },
          fields: [
            {
              kind: 'select',
              key: 'defaultAction',
              label: 'Default action',
              labelI18n: { zh: '默认动作' },
              options: [
                { value: 'paste', label: 'Paste', labelI18n: { zh: '粘贴' } },
              ],
            },
            {
              kind: 'select',
              key: 'pasteFailureFallback',
              label: 'Paste failure fallback',
              labelI18n: { zh: '粘贴失败时' },
              options: [
                { value: 'copy-and-notify', label: 'Copy and notify', labelI18n: { zh: '复制并提示' } },
              ],
            },
          ],
        },
      ],
    },
  },

  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Clipboard History',
        titleI18n: { zh: '剪贴板历史' },
        icon: 'Clipboard',
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
          minWidth: 760,
          minHeight: 360,
          closeOnBlur: true,
          resizable: false,
        },
      },
    ],
  },

  background: clipboardHistoryBackground,
})
