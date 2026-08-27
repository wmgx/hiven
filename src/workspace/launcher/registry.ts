/**
 * Launcher Registry
 *
 * Collects launcher candidates from three sources and resolves them into
 * system-owned `LauncherItem`s:
 *   1. Host-owned launcher items from registered providers.
 *   2. Plugin static items — from `launcher.items` and adapted from `tools`.
 *   3. Plugin dynamic items — from `launcher.dynamicItems` and tool-less
 *      dynamic providers, guarded by query rules + per-provider error isolation.
 *
 * Launcher hosts never scan commands directly. Launcher
 * entries must be declared as `launcher.items` or `tools`.
 */

import type { Locale } from '../../i18n'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { pluginRegistry } from '../pluginRegistry'
import { requestOpenLauncherPluginSettingsSurface } from '../launcherHostSurfaceBridge'
import type { ContributionSource, PluginDefinition } from '../pluginTypes'
import { resolvePluginSettings } from '../pluginSettingsStore'
import type {
  LauncherDynamicItemProvider,
  LauncherItem,
  LauncherItemContribution,
  LauncherSurfaceId,
  PluginToolContribution,
} from './types'
import { launcherHostHasCapability, normalizeLauncherSurfaceId } from './types'
import {
  getPluginLauncherItemKey,
  getPluginToolItemKey,
  getPluginDynamicItemKey,
  getPluginSurfaceItemKey,
  validateLauncherItemIds,
  findUnknownSurfaces,
} from './identity'
import { createPluginLauncherApi, createPluginLauncherStorage } from './pluginApi'
import { createPluginNetwork } from '../pluginNetwork'
import { createPluginAi } from '../ai/runtime'
import { createPluginShell } from '../pluginShell'
import { getPluginPermissionSnapshot } from '../pluginPermissions'
import { launcherPerfNow, logLauncherPerfDuration, measureLauncherPerf } from './perf'
import { resolvePluginSettingsSource } from './pluginSource'
import { adaptToolToLauncherItem } from './toolAdapter'
import { normalizeContribution } from './normalizeContribution'
import { applyProductProviderToLauncherItem, resolvePluginProductMetadata } from '../pluginProductCatalog'
import { getSavedActionLauncherItems } from '../savedActions/provider'

const DYNAMIC_QUERY_MAX_LENGTH = 500
const DYNAMIC_PROVIDER_TIMEOUT_MS = 1000

// ─── Host-owned items ────────────────────────────────────────────────────────

let hostItemsProvider: (() => LauncherItem[]) | null = null
let hostDynamicItemsProvider: ((ctx: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}) => Promise<LauncherItem[]> | LauncherItem[]) | null = null

/** Register a provider for host-owned launcher items (views/actions). */
export function setHostLauncherItemsProvider(provider: () => LauncherItem[]): void {
  hostItemsProvider = provider
}

/** Register a provider for host-owned dynamic launcher items (apps, system search). */
export function setHostLauncherDynamicItemsProvider(provider: (ctx: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}) => Promise<LauncherItem[]> | LauncherItem[]): void {
  hostDynamicItemsProvider = provider
}

export function getHostLauncherItems(): LauncherItem[] {
  return hostItemsProvider ? hostItemsProvider() : []
}

// ─── Surface filtering ───────────────────────────────────────────────────────

function appearsOnSurface(item: LauncherItem, surfaceId: LauncherSurfaceId): boolean {
  const normalizedSurfaceId = normalizeLauncherSurfaceId(surfaceId)
  const appears = !item.surfaces || item.surfaces.length === 0
    ? true
    : item.surfaces.some((candidate) => normalizeLauncherSurfaceId(candidate) === normalizedSurfaceId)
  if (!appears) return false
  return (item.requiredCapabilities ?? []).every((capability) => launcherHostHasCapability(normalizedSurfaceId, capability))
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
  const productMetadata = resolvePluginProductMetadata(pluginId)
  const normalized = normalizeContribution(contribution, {
    systemKey: getPluginLauncherItemKey(pluginId, contribution.id),
    kind: 'plugin',
    pluginId,
    source,
  })
  return applyProductProviderToLauncherItem({
    ...normalized,
    productProvider: productMetadata.provider,
  })
}

function resolveToolItem(
  tool: PluginToolContribution,
  pluginId: string,
  source: ContributionSource,
): LauncherItem | null {
  const launcherOpt = tool.surfaces?.launcher
  if (launcherOpt === false || launcherOpt == null) return null
  return applyProductProviderToLauncherItem(adaptToolToLauncherItem(tool, {
    pluginId,
    source: resolvePluginSettingsSource(pluginId, source),
    systemKey: getPluginToolItemKey(pluginId, tool.id),
  }))
}

function withSettingsSuffix(title: string, suffix: string): string {
  return title.toLowerCase().includes(suffix.toLowerCase()) ? title : `${title} ${suffix}`
}

function withChineseSettingsSuffix(title: string): string {
  return title.includes('设置') ? title : `${title} 设置`
}

function resolvePluginSettingsItem(
  definition: PluginDefinition<unknown>,
  pluginId: string,
  source: ContributionSource,
): LauncherItem | null {
  const settings = definition.settings
  if (!settings) return null

  const settingsSource = resolvePluginSettingsSource(pluginId, source)
  const baseTitle = settings.title ?? pluginId
  const titleI18n = { ...settings.titleI18n }
  titleI18n.zh = withChineseSettingsSuffix(titleI18n.zh ?? baseTitle)

  return {
    systemKey: `plugin-settings:${settingsSource}:${pluginId}`,
    kind: 'host',
    pluginId,
    source: settingsSource,
    display: {
      title: withSettingsSuffix(baseTitle, 'Settings'),
      titleI18n,
      icon: 'Settings',
      aliases: ['settings', 'preferences', 'extension settings', 'plugin settings', '设置', '偏好设置', pluginId],
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['settings'],
    execute: async (ctx) => {
      await requestOpenLauncherPluginSettingsSurface(settingsSource, pluginId)
      return { ok: true, keepOpen: ctx.surfaceId === 'global-launcher' }
    },
  }
}

function shouldExposePluginSettingsLauncherItem(definition: PluginDefinition<unknown>): boolean {
  return definition.launcher?.items?.some((item) => item.hostEntry === 'plugin-settings') ?? false
}

/**
 * Resolve the tool list for a plugin definition.
 * Prefer settings-aware `toolsFor` when present; fall back to static `tools`.
 */
export function resolvePluginTools(
  def: PluginDefinition<unknown>,
  settings: unknown,
): PluginToolContribution[] {
  if (typeof def.toolsFor === 'function') {
    try {
      const selected = def.toolsFor(settings)
      if (Array.isArray(selected)) return selected as PluginToolContribution[]
    } catch (error) {
      console.warn('[launcher] toolsFor failed; falling back to static tools:', error)
    }
  }
  return (def.tools ?? []) as PluginToolContribution[]
}

/**
 * Collect all static plugin launcher items (from launcher.items + tools),
 * validating ids per plugin. Duplicate/invalid ids are skipped with a warning.
 */
export function collectStaticPluginItems(): LauncherItem[] {
  const items: LauncherItem[] = []
  for (const { definition, pluginId, source } of pluginRegistry.getAllPluginDefinitions()) {
    const def = definition as PluginDefinition<unknown>
    const settingsSource = resolvePluginSettingsSource(pluginId, source)
    const settings = def.settings
      ? resolvePluginSettings(settingsSource, pluginId, def.settings).value
      : {}

    // launcher.items
    const contributions = def.launcher?.items ?? []
    const launcherIds = contributions.map((c) => c.id)
    const idErrors = validateLauncherItemIds(launcherIds)
    const badIds = new Set(idErrors.map((e) => e.itemId))
    for (const error of idErrors) {
      console.warn(`[launcher] plugin "${pluginId}" launcher item id "${error.itemId}": ${error.reason}`)
    }
    for (const contribution of contributions) {
      if (contribution.hostEntry === 'plugin-settings') continue
      if (badIds.has(contribution.id)) continue
      const item = resolveStaticItemFromContribution(contribution, pluginId, source)
      if (item) {
        items.push(item)
      }
    }

    // tools (adapted) — settings-aware via toolsFor when declared
    const tools = resolvePluginTools(def, settings)
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
      const item: LauncherItem = applyProductProviderToLauncherItem({
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
        requiredCapabilities: ['plugin-surfaces'],
        // Clipboard / Object Block content boost (e.g. CSV path → CSV Tools)
        textMatch: typeof surface.textMatch === 'function' ? surface.textMatch : undefined,
        execute: async () => {
          // Surface opening is handled by the host when this item is selected.
          // The launcher controller will detect the plugin-surface systemKey
          // and render the surface component directly.
          return { ok: true }
        },
      })
      items.push(item)
    }

    if (shouldExposePluginSettingsLauncherItem(def)) {
      const settingsItem = resolvePluginSettingsItem(def, pluginId, source)
      if (settingsItem) {
        items.push(settingsItem)
      }
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

/** Progressive update emitted as each dynamic source finishes. */
export type DynamicItemsPartialUpdate = {
  kind: 'host' | 'plugin'
  /** Present when kind === 'plugin'. */
  pluginId?: string
  items: LauncherItem[]
}

export type CollectDynamicItemsOptions = {
  /**
   * Called as soon as one host/plugin source resolves so the session can paint
   * fast compute results without waiting for slower providers (favicon, apps).
   */
  onPartial?: (update: DynamicItemsPartialUpdate) => void
  /** Abort in-flight work when the query changes. */
  signal?: AbortSignal
  /** Collect host dynamic items (apps / workflow). Default true. */
  includeHost?: boolean
  /** Collect plugin dynamicItems providers. Default true. */
  includePlugins?: boolean
}

/**
 * Run dynamic providers for a query. Returns resolved dynamic LauncherItems.
 * Guards:
 *  - Empty resolved input text → host dynamic providers only; plugin providers skip.
 *  - Query longer than DYNAMIC_QUERY_MAX_LENGTH → skip.
 *  - Each provider isolated by try/catch + timeout; one failure cannot break
 *    the launcher or other providers.
 *  - onPartial streams per-provider results so fast plugins are not gated by
 *    Promise.all of the slowest peer (progressive results).
 */
export async function collectDynamicItems(
  query: string,
  surfaceId: LauncherSurfaceId,
  locale: Locale,
  getSettings: (pluginId: string, source: ContributionSource) => unknown,
  inputText?: string,
  options: CollectDynamicItemsOptions = {},
): Promise<LauncherItem[]> {
  const includeHost = options.includeHost !== false
  const includePlugins = options.includePlugins !== false
  const onPartial = options.onPartial
  const signal = options.signal

  const q = query.trim()
  const resolvedInputText = (q || inputText?.trim() || '')
  if (resolvedInputText.length > DYNAMIC_QUERY_MAX_LENGTH) return []

  const hostPromise: Promise<LauncherItem[]> = includeHost && hostDynamicItemsProvider
    ? measureLauncherPerf(
      'registry:host-dynamic-items',
      () => Promise.resolve(hostDynamicItemsProvider!({ query: q, surfaceId, locale })),
      (items) => ({
        surfaceId,
        queryLength: q.length,
        itemCount: items.length,
      }),
    ).then((items) => {
      if (signal?.aborted) return []
      onPartial?.({ kind: 'host', items })
      return items
    }).catch((error) => {
      console.warn('[launcher] host dynamic provider failed:', error)
      if (!signal?.aborted) onPartial?.({ kind: 'host', items: [] })
      return [] as LauncherItem[]
    })
    : Promise.resolve([])

  if (!includePlugins || !resolvedInputText) {
    return await hostPromise
  }

  if (signal?.aborted) return []

  const providers = collectDynamicProviders()
  const results = await Promise.all(
    providers.map(async ({ provider, pluginId, source }) => {
      if (signal?.aborted) return [] as LauncherItem[]
      const startedAt = launcherPerfNow()
      try {
        const settings = getSettings(pluginId, source)
        const settingsSource = resolvePluginSettingsSource(pluginId, source)
        const requestedPermissions = pluginRegistry.getPluginPermissions(pluginId, settingsSource)
        const raw = await withTimeout(
          Promise.resolve(provider({
            query: resolvedInputText,
            surfaceId,
            locale,
            settings,
            source: settingsSource,
            pluginId,
            signal,
            api: createPluginLauncherApi({ pluginId, source: settingsSource, requestedPermissions }),
            storage: createPluginLauncherStorage({ pluginId, source: settingsSource, requestedPermissions }),
            network: createPluginNetwork(getPluginPermissionSnapshot(settingsSource, pluginId, requestedPermissions)),
            ai: createPluginAi(
              pluginId,
              settingsSource,
              getPluginPermissionSnapshot(settingsSource, pluginId, requestedPermissions),
            ),
            shell: createPluginShell(getPluginPermissionSnapshot(settingsSource, pluginId, requestedPermissions)),
            t: makePluginT(pluginId, locale),
          })),
          DYNAMIC_PROVIDER_TIMEOUT_MS,
        )
        if (signal?.aborted) return []
        if (!Array.isArray(raw)) {
          onPartial?.({ kind: 'plugin', pluginId, items: [] })
          return []
        }
        const items = raw
          .map((contribution) => resolveDynamicItem(contribution, pluginId, source))
          .filter((item): item is LauncherItem => item != null)
        logLauncherPerfDuration('registry:plugin-dynamic-provider', startedAt, {
          pluginId,
          source,
          queryLength: q.length,
          rawCount: raw.length,
          itemCount: items.length,
        })
        onPartial?.({ kind: 'plugin', pluginId, items })
        return items
      } catch (error) {
        logLauncherPerfDuration('registry:plugin-dynamic-provider', startedAt, {
          pluginId,
          source,
          queryLength: q.length,
          failed: true,
          message: error instanceof Error ? error.message : String(error),
        })
        console.warn(`[launcher] dynamic provider "${pluginId}" failed:`, error)
        if (!signal?.aborted) onPartial?.({ kind: 'plugin', pluginId, items: [] })
        return []
      }
    }),
  )

  if (signal?.aborted) return []

  const hostDynamicItems = await hostPromise
  return [
    ...hostDynamicItems,
    ...results.flat(),
  ]
}

function resolveDynamicItem(
  contribution: LauncherItemContribution,
  pluginId: string,
  source: ContributionSource,
): LauncherItem | null {
  // Same protocol fields as static items / tools (params, accepts, match, textMatch…).
  return normalizeContribution(contribution, {
    systemKey: getPluginDynamicItemKey(pluginId, contribution.id),
    kind: 'dynamic',
    pluginId,
    source,
  })
}

// ─── Combined candidate collection ───────────────────────────────────────────

/**
 * All static candidates for a surface (host + plugin static), surface-filtered.
 * Dynamic items are collected separately (async) and merged by the controller.
 */
export function collectStaticCandidates(surfaceId: LauncherSurfaceId): LauncherItem[] {
  const baseItems = [...getHostLauncherItems(), ...collectStaticPluginItems()]
  const api = createPluginLauncherApi()
  const all = [...baseItems, ...getSavedActionLauncherItems(baseItems, {
    selection: Boolean(api.getSelectionText()),
    activeText: Boolean(api.getActiveText()),
  })]
  return all.filter((item) => appearsOnSurface(item, surfaceId))
}

export function filterDynamicForSurface(
  items: LauncherItem[],
  surfaceId: LauncherSurfaceId,
): LauncherItem[] {
  return items.filter((item) => appearsOnSurface(item, surfaceId))
}
