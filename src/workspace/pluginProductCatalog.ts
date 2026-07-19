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
  product('calculator', 'Calculator', ['calculator']),
  product('date-time-assistant', 'Date Time Assistant', ['date-time-assistant']),
  product('json-tools', 'JSON Tools', ['json', 'js-filter', 'sort-json']),
  product('text-diff', 'Text Diff', ['text-diff']),
  product('regex-tester', 'Regex Tester', ['regex-tester']),
  product('clipboard-history', 'Clipboard History', ['clipboard-history']),
  product('translate', 'Translate', ['translate']),
  product('csv-tools', 'CSV Tools', ['csv']),
  product('encode-decode-tools', 'Encode / Decode Tools', ['base64', 'url', 'html', 'slashes']),
  product('yaml-tools', 'YAML Tools', ['yaml']),
  product('query-string-tools', 'Query String Tools', ['query-string']),
  product('sql-tools', 'SQL Tools', ['sql', 'sqlin']),
  product('css-formatter', 'CSS Formatter', ['css']),
  product('xml-formatter', 'XML Formatter', ['xml']),
  product('text-tools', 'Text Tools', ['case', 'line-tools', 'line-affix', 'mdquote']),
  product('jwt-tools', 'JWT Tools', ['jwt']),
  product('hash-tools', 'Hash Tools', ['hash']),
  product('count', 'Count', ['count']),
  product('web-open', 'Web Open', ['web-open']),
  product('browser-tabs', 'Browser Tabs', ['browser-tabs'], '浏览器标签'),
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
  return {
    ...item,
    display: {
      ...item.display,
      subtitle: item.display.subtitle ?? `来自 ${productProvider}`,
      aliases: [...(item.display.aliases ?? []), productProvider, metadata.productId],
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
