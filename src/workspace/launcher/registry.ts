/**
 * Launcher Registry
 *
 * Collects launcher candidates from three sources and resolves them into
 * system-owned `LauncherItem`s:
 *   1. Host-owned launcher items (views/actions).
 *   2. Plugin static items — from `launcher.items` and adapted from `tools`.
 *   3. Plugin dynamic items — from `launcher.dynamicItems` and tool-less
 *      dynamic providers, guarded by query rules + per-provider error isolation.
 *
 * CommandPalette / GlobalLauncher never scan commands directly. Launcher
 * entries must be declared as `launcher.items` or `tools`.
 */

import type { Locale } from '../../i18n'
import { pluginRegistry } from '../pluginRegistry'
import type { ContributionSource, PluginDefinition } from '../pluginTypes'
import type {
  LauncherDynamicItemProvider,
  LauncherItem,
  LauncherItemContribution,
  LauncherSurfaceId,
  PluginToolContribution,
} from './types'
import {
  getPluginLauncherItemKey,
  getPluginToolItemKey,
  getPluginDynamicItemKey,
  getPluginSurfaceItemKey,
  validateLauncherItemIds,
  sanitizeSurfaces,
  findUnknownSurfaces,
} from './identity'
import { resolvePluginSettingsSource } from './pluginSource'
import { adaptToolToLauncherItem } from './toolAdapter'

const DYNAMIC_QUERY_MAX_LENGTH = 500
const DYNAMIC_PROVIDER_TIMEOUT_MS = 1000

// ─── Host-owned items ────────────────────────────────────────────────────────

let hostItemsProvider: (() => LauncherItem[]) | null = null

/** Register a provider for host-owned launcher items (views/actions). */
export function setHostLauncherItemsProvider(provider: () => LauncherItem[]): void {
  hostItemsProvider = provider
}

export function getHostLauncherItems(): LauncherItem[] {
  return hostItemsProvider ? hostItemsProvider() : []
}

// ─── Surface filtering ───────────────────────────────────────────────────────

function appearsOnSurface(item: LauncherItem, surfaceId: LauncherSurfaceId): boolean {
  if (!item.surfaces || item.surfaces.length === 0) return true
  return item.surfaces.includes(surfaceId)
}

// ─── Plugin static items ─────────────────────────────────────────────────────

function resolveStaticItemFromContribution(
  contribution: LauncherItemContribution,
  pluginId: string,
  source: ContributionSource,
): LauncherItem | null {
  const unknownSurfaces = findUnknownSurfaces(contribution.surfaces)
  if (unknownSurfaces.length > 0) {
    console.warn(
      `[launcher] plugin "${pluginId}" item "${contribution.id}" has unknown surfaces: ${unknownSurfaces.join(', ')} (ignored)`,
    )
  }
  return {
    systemKey: getPluginLauncherItemKey(pluginId, contribution.id),
    kind: 'plugin',
    pluginId,
    source: resolvePluginSettingsSource(pluginId, source),
    display: contribution.display,
    behavior: contribution.behavior ?? { type: 'perform' },
    surfaces: sanitizeSurfaces(contribution.surfaces),
    pinnable: contribution.pinnable ?? true,
    inputPolicy: contribution.inputPolicy,
    params: contribution.params,
    defaultParams: contribution.defaultParams,
    requireParamSelection: contribution.requireParamSelection,
    executeWithParams: contribution.executeWithParams,
    // Legacy usage keys: item id may match a command id from old usage data.
    // Prefer matching launcher item ids to old command ids during migration.
    legacyUsageKeys: [contribution.id],
    execute: contribution.execute,
  }
}

function resolveToolItem(
  tool: PluginToolContribution,
  pluginId: string,
  source: ContributionSource,
): LauncherItem | null {
  const launcherOpt = tool.surfaces?.launcher
  if (launcherOpt === false || launcherOpt == null) return null
  return adaptToolToLauncherItem(tool, {
    pluginId,
    source: resolvePluginSettingsSource(pluginId, source),
    systemKey: getPluginToolItemKey(pluginId, tool.id),
  })
}

/**
 * Collect all static plugin launcher items (from launcher.items + tools),
 * validating ids per plugin. Duplicate/invalid ids are skipped with a warning.
 */
export function collectStaticPluginItems(): LauncherItem[] {
  const items: LauncherItem[] = []
  for (const { definition, pluginId, source } of pluginRegistry.getAllPluginDefinitions()) {
    const def = definition as PluginDefinition<unknown>

    // launcher.items
    const contributions = def.launcher?.items ?? []
    const launcherIds = contributions.map((c) => c.id)
    const idErrors = validateLauncherItemIds(launcherIds)
    const badIds = new Set(idErrors.map((e) => e.itemId))
    for (const error of idErrors) {
      console.warn(`[launcher] plugin "${pluginId}" launcher item id "${error.itemId}": ${error.reason}`)
    }
    for (const contribution of contributions) {
      if (badIds.has(contribution.id)) continue
      const item = resolveStaticItemFromContribution(contribution, pluginId, source)
      if (item) {
        items.push(item)
      }
    }

    // tools (adapted)
    const tools = def.tools ?? []
    const toolIds = tools.map((t) => t.id)
    const toolIdErrors = validateLauncherItemIds(toolIds)
    const badToolIds = new Set(toolIdErrors.map((e) => e.itemId))
    for (const error of toolIdErrors) {
      console.warn(`[launcher] plugin "${pluginId}" tool id "${error.itemId}": ${error.reason}`)
    }
    for (const tool of tools) {
      if (badToolIds.has(tool.id)) continue
      const item = resolveToolItem(tool, pluginId, source)
      if (item) {
        items.push(item)
      }
    }

    // ui.surfaces (adapted to launcher items for search/open)
    const surfaces = def.ui?.surfaces ?? []
    for (const surface of surfaces) {
      if (surface.entry?.launcher === false) continue
      const settingsSource = resolvePluginSettingsSource(pluginId, source)
      const item: LauncherItem = {
        systemKey: getPluginSurfaceItemKey(settingsSource, pluginId, surface.id),
        kind: 'plugin',
        pluginId,
        source: settingsSource,
        display: {
          title: surface.title,
          titleI18n: surface.titleI18n,
          icon: surface.icon,
          aliases: surface.aliases,
        },
        behavior: { type: 'perform' },
        surfaces: ['global-launcher'],
        pinnable: false,
        execute: async () => {
          // Surface opening is handled by the host when this item is selected.
          // The launcher controller will detect the plugin-surface systemKey
          // and render the surface component directly.
          return { ok: true }
        },
      }
      items.push(item)
    }
  }
  return items
}

// ─── Dynamic items ───────────────────────────────────────────────────────────

type DynamicProviderEntry = {
  provider: LauncherDynamicItemProvider
  pluginId: string
  source: ContributionSource
}

function collectDynamicProviders(): DynamicProviderEntry[] {
  const entries: DynamicProviderEntry[] = []
  for (const { definition, pluginId, source } of pluginRegistry.getAllPluginDefinitions()) {
    const provider = (definition as PluginDefinition<unknown>).launcher?.dynamicItems
    if (provider) entries.push({ provider, pluginId, source })
  }
  return entries
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('dynamic provider timeout')), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Run dynamic providers for a query. Returns resolved dynamic LauncherItems.
 * Guards:
 *  - Empty query → no providers run.
 *  - Query longer than DYNAMIC_QUERY_MAX_LENGTH → skip.
 *  - Each provider isolated by try/catch + timeout; one failure cannot break
 *    the launcher or other providers.
 */
export async function collectDynamicItems(
  query: string,
  locale: Locale,
  getSettings: (pluginId: string, source: ContributionSource) => unknown,
): Promise<LauncherItem[]> {
  const q = query.trim()
  if (!q) return []
  if (q.length > DYNAMIC_QUERY_MAX_LENGTH) return []

  const providers = collectDynamicProviders()
  const results = await Promise.all(
    providers.map(async ({ provider, pluginId, source }) => {
      try {
        const settings = getSettings(pluginId, source)
        const raw = await withTimeout(
          Promise.resolve(provider({ query: q, locale, settings })),
          DYNAMIC_PROVIDER_TIMEOUT_MS,
        )
        if (!Array.isArray(raw)) return []
        return raw.map((contribution) => resolveDynamicItem(contribution, pluginId, source))
      } catch (error) {
        console.warn(`[launcher] dynamic provider "${pluginId}" failed:`, error)
        return []
      }
    }),
  )
  return results.flat().filter((item): item is LauncherItem => item != null)
}

function resolveDynamicItem(
  contribution: LauncherItemContribution,
  pluginId: string,
  source: ContributionSource,
): LauncherItem | null {
  return {
    systemKey: getPluginDynamicItemKey(pluginId, contribution.id),
    kind: 'dynamic',
    pluginId,
    source: resolvePluginSettingsSource(pluginId, source),
    display: contribution.display,
    behavior: contribution.behavior ?? { type: 'perform' },
    surfaces: sanitizeSurfaces(contribution.surfaces),
    // Dynamic items cannot be pinned in the first version.
    pinnable: false,
    inputPolicy: contribution.inputPolicy,
    execute: contribution.execute,
  }
}

// ─── Combined candidate collection ───────────────────────────────────────────

/**
 * All static candidates for a surface (host + plugin static), surface-filtered.
 * Dynamic items are collected separately (async) and merged by the controller.
 */
export function collectStaticCandidates(surfaceId: LauncherSurfaceId): LauncherItem[] {
  const all = [...getHostLauncherItems(), ...collectStaticPluginItems()]
  return all.filter((item) => appearsOnSurface(item, surfaceId))
}

export function filterDynamicForSurface(
  items: LauncherItem[],
  surfaceId: LauncherSurfaceId,
): LauncherItem[] {
  return items.filter((item) => appearsOnSurface(item, surfaceId))
}
