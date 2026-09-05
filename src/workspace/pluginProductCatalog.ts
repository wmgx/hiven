import type { PluginDefinition, PluginManifest } from './pluginTypes'
import type { LauncherItem } from './launcher/types'

export type PluginProductMetadata = {
  productId: string
  provider: string
  providerZh?: string
  mergedPluginIds: string[]
  removed?: boolean
}

const PRODUCT_CATALOG: PluginProductMetadata[] = [
  product('calculator', 'Calculator', ['calculator'], '计算器'),
  product('date-time-assistant', 'Date Time Assistant', ['date-time-assistant'], '日期时间助手'),
  product('json-tools', 'JSON Tools', ['json', 'js-filter', 'sort-json'], 'JSON 工具'),
  product('text-diff', 'Text Diff', ['text-diff'], '文本对比'),
  product('regex-tester', 'Regex Tester', ['regex-tester'], '正则测试器'),
  product('clipboard-history', 'Clipboard History', ['clipboard-history'], '剪贴板历史'),
  product('translate', 'Translate', ['translate'], '翻译'),
  product('csv-tools', 'CSV Tools', ['csv'], 'CSV 工具'),
  product('encode-decode-tools', 'Encode / Decode Tools', ['base64', 'url', 'html', 'slashes'], '编解码工具'),
  product('yaml-tools', 'YAML Tools', ['yaml'], 'YAML 工具'),
  product('query-string-tools', 'Query String Tools', ['query-string'], '查询字符串工具'),
  product('sql-tools', 'SQL Tools', ['sql', 'sqlin'], 'SQL 工具'),
  product('css-formatter', 'CSS Formatter', ['css'], 'CSS 格式化'),
  product('xml-formatter', 'XML Formatter', ['xml'], 'XML 格式化'),
  product('text-tools', 'Text Tools', ['case', 'line-tools', 'line-affix', 'mdquote'], '文本工具'),
  product('jwt-tools', 'JWT Tools', ['jwt'], 'JWT 工具'),
  product('hash-tools', 'Hash Tools', ['hash'], '哈希工具'),
  product('count', 'Count', ['count'], '计数'),
  product('web-open', 'Browser', ['web-open'], '浏览器'),
  product('qr-code', 'QR Code', ['qr-code'], '二维码'),
  product('text-explode', 'Text Explode', ['text-explode'], '大爆炸'),
  product('feishu', 'Feishu', ['feishu'], '飞书'),
]

export const REMOVED_PLUGIN_CAPABILITIES = [
  { id: 'scripts', removed: true, reason: 'removed: Scripts are out of Step 5 scope' },
  { id: 'custom-actions', removed: true, reason: 'removed: Custom Actions are out of Step 5 scope' },
  { id: 'plugin-editor', removed: true, reason: 'removed: Plugin Editor is out of Step 5 scope' },
  { id: 'pinned', removed: true, reason: 'removed: pinned / pin capability is out of Step 5 scope' },
]

const PRODUCT_BY_PLUGIN_ID = new Map<string, PluginProductMetadata>()
for (const entry of PRODUCT_CATALOG) {
  for (const pluginId of entry.mergedPluginIds) {
    PRODUCT_BY_PLUGIN_ID.set(pluginId, entry)
  }
}

export function listPluginProductMetadata(): PluginProductMetadata[] {
  return [...PRODUCT_CATALOG]
}

export function resolvePluginProductMetadata(pluginId: string): PluginProductMetadata {
  return PRODUCT_BY_PLUGIN_ID.get(pluginId) ?? product(pluginId, titleFromPluginId(pluginId), [pluginId])
}

export function applyPluginProductMetadata<T extends PluginDefinition>(
  pluginId: string,
  definition: T,
  manifest?: PluginManifest,
): T {
  const metadata = resolvePluginProductMetadata(pluginId)
  const displayName = metadata.provider
  const displayNameI18n = {
    ...manifest?.displayNameI18n,
    zh: metadata.providerZh ?? manifest?.displayNameI18n?.zh ?? displayName,
  }
  return {
    ...definition,
    launcher: definition.launcher,
    settings: definition.settings ? {
      ...definition.settings,
      title: definition.settings.title ?? displayName,
      titleI18n: { ...displayNameI18n, ...definition.settings.titleI18n },
    } : definition.settings,
  }
}

export function applyProductProviderToLauncherItem(item: LauncherItem): LauncherItem {
  if (!item.pluginId) return item
  const metadata = resolvePluginProductMetadata(item.pluginId)
  const productProvider = metadata.provider
  const hasSubtitle = item.display.subtitle != null || item.display.subtitleI18n != null
  return {
    ...item,
    display: {
      ...item.display,
      subtitle: hasSubtitle ? item.display.subtitle : `From ${productProvider}`,
      subtitleI18n: hasSubtitle ? item.display.subtitleI18n : {
        en: `From ${productProvider}`,
        zh: `来自 ${metadata.providerZh ?? productProvider}`,
      },
      aliases: [...(item.display.aliases ?? []), productProvider, metadata.providerZh ?? productProvider, metadata.productId],
    },
    metadata: item.metadata,
    productProvider,
  } as LauncherItem & { productProvider: string }
}

function product(productId: string, provider: string, mergedPluginIds: string[], providerZh?: string): PluginProductMetadata {
  return { productId, provider, providerZh, mergedPluginIds }
}

function titleFromPluginId(pluginId: string): string {
  return pluginId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
