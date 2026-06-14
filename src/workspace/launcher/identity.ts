/**
 * Launcher System Identity
 *
 * The host owns launcher item identity. Plugins never see or supply these keys.
 * Keys are stable across sessions and across plugin versions: they encode only
 * the plugin id and the item id (never version, never dev/source).
 *
 * Identity is launcher-item scoped, not command scoped. If one command backs two
 * launcher items, they get two distinct keys and rank independently. If a plugin
 * changes an item's semantic meaning, it must change the item id.
 */

import type { PluginSettingsSource } from '../pluginSettingsStore'
import type { LauncherSurfaceId, SystemLauncherItemKey } from './types'
import { isLauncherSurfaceId } from './types'

// ─── Key Generation ──────────────────────────────────────────────────────────

/** `plugin:${pluginId}:launcher:${itemId}` */
export function getPluginLauncherItemKey(pluginId: string, itemId: string): SystemLauncherItemKey {
  return `plugin:${pluginId}:launcher:${itemId}`
}

/** `plugin:${pluginId}:tool:${toolId}` — tool-derived launcher item key. */
export function getPluginToolItemKey(pluginId: string, toolId: string): SystemLauncherItemKey {
  return `plugin:${pluginId}:tool:${toolId}`
}

/** `plugin:${pluginId}:dynamic:${itemId}` — dynamic item key (not used for usage/pin). */
export function getPluginDynamicItemKey(pluginId: string, itemId: string): SystemLauncherItemKey {
  return `plugin:${pluginId}:dynamic:${itemId}`
}

/** `plugin-surface:${source}:${pluginId}:${surfaceId}` — plugin UI surface launcher key. */
export function getPluginSurfaceItemKey(source: PluginSettingsSource, pluginId: string, surfaceId: string): SystemLauncherItemKey {
  return `plugin-surface:${source}:${pluginId}:${surfaceId}`
}

/** `host:view:${viewId}` */
export function getHostViewItemKey(viewId: string): SystemLauncherItemKey {
  return `host:view:${viewId}`
}

/** `host:action:${actionId}` */
export function getHostActionItemKey(actionId: string): SystemLauncherItemKey {
  return `host:action:${actionId}`
}

// ─── Key Parsing ───────────────────────────────────────────────────────────

export type ParsedLauncherItemKey =
  | { kind: 'plugin-launcher'; pluginId: string; itemId: string }
  | { kind: 'plugin-tool'; pluginId: string; itemId: string }
  | { kind: 'plugin-dynamic'; pluginId: string; itemId: string }
  | { kind: 'host-view'; viewId: string }
  | { kind: 'host-action'; actionId: string }
  | { kind: 'unknown' }

export function parseLauncherItemKey(key: SystemLauncherItemKey): ParsedLauncherItemKey {
  if (key.startsWith('plugin:')) {
    // plugin:${pluginId}:${segment}:${itemId} — pluginId may not contain ':'
    const rest = key.slice('plugin:'.length)
    const sepIdx = rest.indexOf(':')
    if (sepIdx < 0) return { kind: 'unknown' }
    const pluginId = rest.slice(0, sepIdx)
    const tail = rest.slice(sepIdx + 1)
    if (tail.startsWith('launcher:')) {
      return { kind: 'plugin-launcher', pluginId, itemId: tail.slice('launcher:'.length) }
    }
    if (tail.startsWith('tool:')) {
      return { kind: 'plugin-tool', pluginId, itemId: tail.slice('tool:'.length) }
    }
    if (tail.startsWith('dynamic:')) {
      return { kind: 'plugin-dynamic', pluginId, itemId: tail.slice('dynamic:'.length) }
    }
    return { kind: 'unknown' }
  }
  if (key.startsWith('host:view:')) {
    return { kind: 'host-view', viewId: key.slice('host:view:'.length) }
  }
  if (key.startsWith('host:action:')) {
    return { kind: 'host-action', actionId: key.slice('host:action:'.length) }
  }
  return { kind: 'unknown' }
}

// ─── Validation ──────────────────────────────────────────────────────────────

const ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type ItemIdValidationError = {
  itemId: string
  reason: 'invalid-format' | 'duplicate'
}

/** A plugin/tool item id must be a safe slug. */
export function isValidLauncherItemId(itemId: string): boolean {
  return ITEM_ID_PATTERN.test(itemId)
}

/**
 * Validate a list of launcher item ids inside one plugin. Reports invalid
 * formats and duplicates. Duplicate item ids inside a plugin are rejected.
 */
export function validateLauncherItemIds(itemIds: string[]): ItemIdValidationError[] {
  const errors: ItemIdValidationError[] = []
  const seen = new Set<string>()
  for (const itemId of itemIds) {
    if (!isValidLauncherItemId(itemId)) {
      errors.push({ itemId, reason: 'invalid-format' })
      continue
    }
    if (seen.has(itemId)) {
      errors.push({ itemId, reason: 'duplicate' })
      continue
    }
    seen.add(itemId)
  }
  return errors
}

/**
 * Validate a `surfaces` array from a plugin contribution. Returns the list of
 * unknown surface values; an empty array means all are valid.
 */
export function findUnknownSurfaces(surfaces: unknown): string[] {
  if (surfaces == null) return []
  if (!Array.isArray(surfaces)) return ['<not-an-array>']
  const unknown: string[] = []
  for (const value of surfaces) {
    if (!isLauncherSurfaceId(value)) unknown.push(String(value))
  }
  return unknown
}

/** Filter a `surfaces` array down to valid host surfaces (drops unknowns). */
export function sanitizeSurfaces(surfaces: unknown): LauncherSurfaceId[] | undefined {
  if (surfaces == null) return undefined
  if (!Array.isArray(surfaces)) return undefined
  const valid = surfaces.filter(isLauncherSurfaceId)
  return valid.length > 0 ? valid : undefined
}
