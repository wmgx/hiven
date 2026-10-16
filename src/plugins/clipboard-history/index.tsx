/**
 * Clipboard History Plugin — Entry Point
 *
 * Only assembles contributions from local modules.
 * No complex JSX, CSS, or business logic here.
 */

import { definePlugin } from '@hiven/plugin'
import type { ClipboardHistorySettings } from './settings/model'
import { DEFAULT_CLIPBOARD_HISTORY_SETTINGS, migrateClipboardHistorySettings } from './settings/model'
import { ClipboardHistorySurface } from './surfaces/ClipboardHistorySurface'
import { clipboardHistoryBackground } from './background/clipboardHistoryBackground'
import { createClipboardHistoryRepository } from './storage/clipboardHistoryRepository'
import { getCachedIndex } from './storage/clipboardHistoryCache'

const MB = 1024 * 1024

const FILTER_ROUTES = [
  {
    id: 'favorite',
    title: 'Clipboard Favorites',
    titleZh: '剪贴板收藏',
    titleKey: 'route.favorite',
    aliases: ['clipboard favorites', 'clipboard favorite', 'favorite clipboard', '剪贴板收藏', '收藏剪贴板'],
  },
  {
    id: 'frequent',
    title: 'Frequently Used Clipboard',
    titleZh: '常用剪贴板',
    titleKey: 'route.frequent',
    aliases: ['clipboard frequent', 'frequent clipboard', 'frequently used clipboard', '常用剪贴板', '剪贴板常用'],
  },
  {
    id: 'text',
    title: 'Clipboard Text',
    titleZh: '剪贴板文本',
    titleKey: 'route.text',
    aliases: ['clipboard text', 'text clipboard', '剪贴板文本', '文本剪贴板'],
  },
  {
    id: 'image',
    title: 'Clipboard Images',
    titleZh: '剪贴板图片',
    titleKey: 'route.image',
    aliases: ['clipboard images', 'clipboard image', 'image clipboard', '剪贴板图片', '图片剪贴板'],
  },
  {
    id: 'files',
    title: 'Clipboard Files',
    titleZh: '剪贴板文件',
    titleKey: 'route.files',
    aliases: ['clipboard files', 'clipboard file', 'file clipboard', '剪贴板文件', '文件剪贴板'],
  },
] as const

const CLIPBOARD_HISTORY_SHELL = {
  defaultWidth: 900,
  defaultHeight: 640,
  minWidth: 760,
  minHeight: 360,
  closeOnBlur: true,
  resizable: false,
  rendersTitlebar: true,
  // 默认 2 分钟销毁对高频剪贴板场景太短，冷启动会反复加载 webview。
  // 30 分钟内热开：原生 show() 复用已存活 webview，接近瞬时。
  destroyTimeout: 30 * 60 * 1000,
}

export default definePlugin<ClipboardHistorySettings>({
  settings: {
    title: 'Clipboard History',
    titleI18n: { zh: '剪贴板历史' },
    version: 2,
    defaultValue: DEFAULT_CLIPBOARD_HISTORY_SETTINGS,
    migrate: migrateClipboardHistorySettings,
    schema: {
      sections: [
        {
          id: 'recording',
          title: 'Recording',
          titleI18n: { zh: '记录设置' },
          description: 'Choose which clipboard changes hiven should keep.',
          descriptionI18n: { zh: '选择 hiven 要保留哪些剪贴板变化。' },
          fields: [
            {
              kind: 'switch',
              key: 'enabled',
              icon: 'Power',
              label: 'Enable clipboard history',
              labelI18n: { zh: '启用剪贴板历史' },
              requires: ['clipboard.watch', 'storage.private'],
              description: 'Starts background recording when permissions are ready.',
              descriptionI18n: { zh: '权限齐全后启动后台记录。' },
            },
            {
              kind: 'switch',
              key: 'recordText',
              icon: 'FileText',
              label: 'Record text',
              labelI18n: { zh: '记录文本' },
              requires: ['clipboard.read', 'clipboard.watch', 'storage.private'],
            },
            {
              kind: 'switch',
              key: 'recordImages',
              icon: 'Image',
              label: 'Record images',
              labelI18n: { zh: '记录图片' },
              requires: ['clipboard.image', 'clipboard.watch', 'storage.blob'],
            },
            {
              kind: 'switch',
              key: 'recordFiles',
              icon: 'Folder',
              label: 'Record file paths',
              labelI18n: { zh: '记录文件路径' },
              requires: ['clipboard.files', 'clipboard.watch'],
            },
            {
              kind: 'number',
              key: 'retentionMonths',
              label: 'Retention months',
              labelI18n: { zh: '保留月数' },
              description: '1–12 UTC calendar months, default 3; no item-count limit. Favorites are exempt from automatic expiry. Earlier history stays protected until explicitly included. Expired or manually deleted items are recoverable for 30 days, then permanently deleted automatically. Turning off recording does not pause cleanup.',
              descriptionI18n: { zh: '1–12 个 UTC 日历月，默认 3 个月，不限制条数。固定（收藏）项免自动过期；旧历史在明确纳入前受保护。过期或手动删除的条目可恢复 30 天，之后自动永久删除。停用记录不会暂停清理。' },
              icon: 'CalendarDays',
              min: 1,
              max: 12,
              step: 1,
              unit: 'months',
              unitI18n: { zh: '个月' },
            },
            {
              kind: 'number',
              key: 'frequentPasteThreshold',
              label: 'Frequent paste threshold',
              labelI18n: { zh: '常用粘贴次数门槛' },
              icon: 'ListOrdered',
              min: 2,
              max: 20,
              step: 1,
            },
          ],
        },
        {
          id: 'limits',
          title: 'Limits',
          titleI18n: { zh: '容量限制' },
          fields: [
            {
              kind: 'number',
              key: 'maxTextBytes',
              label: 'Max text size',
              labelI18n: { zh: '文本单项大小上限' },
              icon: 'FileText',
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
              icon: 'Image',
              requires: ['storage.blob'],
              min: 1,
              step: 1,
              unit: 'MB',
              storageScale: MB,
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
        async beforeOpen(ctx) {
          // 同进程内 background 已预热时跳过 IPC。独立 webview 冷启动时缓存必空：
          // 不 await，让 Surface 先挂载（骨架屏），后台写缓存后通过 subscribe 刷新。
          // 仍调用 getFreshListItems，满足预热契约并与 Surface 自身加载路径共享结果。
          if (getCachedIndex()) return
          void createClipboardHistoryRepository(ctx.storage).getFreshListItems()
        },
        entry: {
          launcher: { surfaces: ['global-launcher'] },
          shortcutBindable: true,
          recommendedShortcut: 'CmdOrCtrl+Shift+V',
          shortcutPresentation: 'window',
        },
        shell: CLIPBOARD_HISTORY_SHELL,
      },
      ...FILTER_ROUTES.map((route) => ({
        id: route.id,
        kind: 'custom-view' as const,
        title: route.title,
        titleI18n: { zh: route.titleZh },
        component: ClipboardHistorySurface,
        entry: { launcher: false },
        shell: CLIPBOARD_HISTORY_SHELL,
      })),
    ],
  },

  launcher: {
    items: FILTER_ROUTES.map((route) => ({
      id: `open-${route.id}`,
      display: {
        title: route.titleKey,
        subtitle: 'route.open',
        icon: 'Clipboard',
        aliases: [...route.aliases],
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      execute(execution) {
        execution.api.openSurface(route.id)
        return { ok: true as const, keepOpen: true }
      },
    })),
  },

  background: clipboardHistoryBackground,
})
