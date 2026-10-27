/** Host settings rows found by name, without a "settings" prefix; they open the settings page. */
import type { Locale } from '../../i18n'
import { translate } from '../../i18n'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { searchableFieldsMatch } from '../searchRanking'
import type { LauncherHostSurfaceTarget } from '../../store'
import { launcherHostHasCapability, normalizeLauncherSurfaceId, type LauncherItem, type LauncherSurfaceId } from './types'
import { parseSettingsFieldSearchQuery } from './settingsFieldSearch'

type HostSettingRow = {
  key: string
  group: string
  target: LauncherHostSurfaceTarget
  /** Search words only; never displayed. */
  aliases: string[]
}

const ROWS: HostSettingRow[] = [
  { key: 'language', group: 'general', target: 'system-settings', aliases: ['locale', 'lang', '中文', 'english', '界面语言'] },
  { key: 'darkTheme', group: 'general', target: 'system-settings', aliases: ['theme', 'dark mode', 'light', '主题', '深色', '浅色', '夜间'] },
  { key: 'contextSuggestions', group: 'contextSuggestions', target: 'system-settings', aliases: ['suggestions', '推荐', '建议'] },
  { key: 'pinnedEntries', group: 'hotkeys', target: 'system-settings', aliases: ['pinned', '固定'] },
  { key: 'globalPinnedLauncherShortcut', group: 'hotkeys', target: 'system-settings', aliases: ['launcher shortcut', 'hotkey', '唤起', '快捷键'] },
  { key: 'quickEditorShortcut', group: 'hotkeys', target: 'system-settings', aliases: ['hotkey', '快捷键'] },
  { key: 'pasteQueueShortcut', group: 'hotkeys', target: 'system-settings', aliases: ['paste queue', 'hotkey', '粘贴队列', '快捷键'] },
  { key: 'appHotkeys', group: 'hotkeys', target: 'system-settings', aliases: ['app shortcut', 'alias', '应用快捷键', '别名'] },
  { key: 'fontSize', group: 'editor', target: 'system-settings', aliases: ['font', '字号', '字体'] },
  { key: 'wordWrap', group: 'editor', target: 'system-settings', aliases: ['wrap', '换行'] },
  { key: 'lineNumbers', group: 'editor', target: 'system-settings', aliases: ['line number', '行号'] },
  { key: 'aiSubscriptionManagement', group: 'aiSubscriptionManagement', target: 'system-ai-settings', aliases: ['ai provider', 'chatgpt', 'login', 'AI 登录', 'AI 账号'] },
  { key: 'aiDefaults', group: 'aiDefaults', target: 'system-ai-settings', aliases: ['ai model', 'model', 'AI 模型', '默认模型'] },
]

const text = (key: string) => ({ en: translate('en', 'settings', key), zh: translate('zh', 'settings', key) })

export function collectHostSettingsSearchItems(query: string, surfaceId: LauncherSurfaceId, locale: Locale): LauncherItem[] {
  const term = parseSettingsFieldSearchQuery(query) ?? query.trim().toLowerCase()
  // A bare "settings" query belongs to the settings page row, not every setting.
  if (/^(?:settings|设置)$/u.test(term)) return []
  const hostId = normalizeLauncherSurfaceId(surfaceId)
  if (!term || hostId !== 'global-launcher' || !launcherHostHasCapability(hostId, 'settings')) return []
  const settingsLabel = { en: translate('en', 'palette', 'kindSettings'), zh: translate('zh', 'palette', 'kindSettings') }
  return ROWS.flatMap((row): LauncherItem[] => {
    const title = text(row.key)
    const group = text(row.group)
    const fields = { id: '', title: title[locale] ?? title.en, titleI18n: title, aliases: [title.en, title.zh, ...row.aliases] }
    if (!searchableFieldsMatch(fields, term, locale)) return []
    return [{
      systemKey: `host:setting:${row.key}`,
      kind: 'host',
      display: {
        title: title.en,
        titleI18n: { zh: title.zh },
        subtitle: group.en,
        subtitleI18n: { zh: group.zh },
        kindLabel: settingsLabel.en,
        kindLabelI18n: { zh: settingsLabel.zh },
        icon: 'Settings',
        // Already matched above; the query alias keeps the row through the shared ranker.
        aliases: [query.trim()],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['settings'],
      recordUsage: false,
      ranking: { trailing: true },
      execute: async () => {
        await requestOpenLauncherHostSurface(row.target)
        return { ok: true, keepOpen: true }
      },
    }]
  })
}
