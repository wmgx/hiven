import { listPluginProductMetadata } from '../pluginProductCatalog'
import type { LauncherItem } from './types'

export type LauncherBrowseCategory = 'all' | 'tools' | 'apps' | 'system'
export type LauncherBrowseItemCategory = Exclude<LauncherBrowseCategory, 'all'>

/** Only host-owned identity and metadata participate in browse classification. */
export type LauncherBrowseItem = Pick<LauncherItem, 'systemKey'> & Partial<Pick<
  LauncherItem, 'kind' | 'pluginId' | 'productProvider' | 'behavior' | 'requiredCapabilities'
>>

const SYSTEM_KEYS = new Set([
  'host:view:settings',
  'host:view:plugins',
  'host:view:devtools',
  'host:app-launcher:refresh',
  'host:system:restart',
  'host:system:shutdown',
  'host:system:lock-screen',
  'host:saved-action:save-last',
  'host:saved-action:delete',
])

const DESKTOP_TARGET_PREFIXES = [
  'host:app-launcher:app:',
  'host:window:focus:',
  'host:tab:focus:',
  'host.window:focus:',
  'host.window:close:',
  'host.app:',
  'browser.chromium:tab:',
]

/** Unknown items stay in All; localized names and labels never imply a category. */
export function getLauncherBrowseCategory(item: LauncherBrowseItem): LauncherBrowseItemCategory | null {
  const key = item.systemKey
  if (
    SYSTEM_KEYS.has(key)
    || key.startsWith('plugin-settings:')
    || key.startsWith('host:experience:')
    || key.startsWith('host:saved-action:rename:')
    || key.startsWith('host:saved-action:delete:')
  ) return 'system'

  if (DESKTOP_TARGET_PREFIXES.some((prefix) => key.startsWith(prefix))) return 'apps'
  if (key === 'host:view:quick-editor' || item.pluginId || item.productProvider) return 'tools'

  // DesktopTarget adapters carry host + perform + a navigation capability.
  // A collect-input command such as Switch Window is not a concrete target.
  if (
    item.kind === 'host'
    && item.behavior?.type === 'perform'
    && item.requiredCapabilities?.some((capability) => (
      capability === 'app-search'
      || capability === 'desktop-windows'
      || capability === 'desktop-browser-tabs'
    ))
  ) return 'apps'

  return null
}

type ToolGroup = { key: string; order: number }
const PRODUCT_BY_PLUGIN_ID = new Map<string, ToolGroup>()
const PRODUCT_BY_PROVIDER = new Map<string, ToolGroup>()
for (const [order, product] of listPluginProductMetadata().entries()) {
  const group = { key: `product:${product.productId}`, order }
  for (const pluginId of product.mergedPluginIds) PRODUCT_BY_PLUGIN_ID.set(pluginId, group)
  PRODUCT_BY_PROVIDER.set(product.provider, group)
}

function toolGroup(item: LauncherBrowseItem): ToolGroup {
  const catalogGroup = (item.pluginId ? PRODUCT_BY_PLUGIN_ID.get(item.pluginId) : undefined)
    ?? (item.productProvider ? PRODUCT_BY_PROVIDER.get(item.productProvider) : undefined)
  if (catalogGroup) return catalogGroup
  return {
    key: item.productProvider ? `provider:${item.productProvider}`
      : item.pluginId ? `plugin:${item.pluginId}` : item.systemKey,
    order: Number.POSITIVE_INFINITY,
  }
}

/**
 * Browse only already-available candidates. Preserve each original row so the
 * displayed list and execution/keyboard indexes refer to the same objects.
 */
export function selectLauncherBrowseItems<T>(options: {
  items: readonly T[]
  category?: LauncherBrowseCategory
  keyOf: (item: T) => string
  itemOf?: (item: T) => LauncherBrowseItem
}): T[] {
  const { items, category = 'all', keyOf, itemOf } = options
  const seen = new Set<string>()
  const toolGroups = new Map<string, { order: number; firstIndex: number; items: T[] }>()
  const appItems: T[] = []
  const systemItems: T[] = []
  const unknownItems: T[] = []
  for (const item of items) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    const metadata = itemOf?.(item) ?? { systemKey: key }
    const itemCategory = getLauncherBrowseCategory(metadata)
    if (category !== 'all' && itemCategory !== category) continue
    if (itemCategory !== 'tools') {
      if (itemCategory === 'apps') appItems.push(item)
      else if (itemCategory === 'system') systemItems.push(item)
      else unknownItems.push(item)
      continue
    }
    const group = toolGroup(metadata)
    const existing = toolGroups.get(group.key)
    if (existing) existing.items.push(item)
    else toolGroups.set(group.key, { order: group.order, firstIndex: toolGroups.size, items: [item] })
  }

  const tools = [...toolGroups.values()]
    .sort((a, b) => a.order === b.order ? a.firstIndex - b.firstIndex : a.order - b.order)
    .flatMap((group) => group.items)
  return [...tools, ...appItems, ...systemItems, ...unknownItems]
}
