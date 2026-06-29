/**
 * Plugin Action Manifest — Phase R4
 *
 * Plugins declare what object types they can process and what output targets
 * they support. This allows the recommendation system to dynamically discover
 * and route actions to real plugins instead of hardcoded action catalogs.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §14 Phase R4
 */

import type { ObjectBlockKind } from './objectBlock'
import type { RecommendedOutputTarget } from './actionRecommendation'

// ─── Types ─────────────────────────────────────────────────────────────────────

/** What object types a plugin action can process. */
export type PluginActionAccepts = {
  /** Object block kinds this action can handle. */
  kinds: ObjectBlockKind[]
  /** Object block sources this action can handle. Empty = all sources. */
  sources?: ('clipboard' | 'editor-selection' | 'editor-document')[]
  /** Minimum text length required. */
  minLength?: number
  /** Maximum text length supported. */
  maxLength?: number
}

/** How the plugin action presents its results. */
export type PluginActionPresentation =
  | 'inline'           // Result shown in launcher
  | 'surface'          // Opens a plugin surface
  | 'editor-replace'   // Replaces editor selection
  | 'background'       // Runs silently

/** A single action capability declared by a plugin. */
export type PluginActionManifestEntry = {
  id: string
  title: string
  titleZh: string
  icon?: string
  accepts: PluginActionAccepts
  outputTargets: RecommendedOutputTarget[]
  defaultOutput: RecommendedOutputTarget
  presentation: PluginActionPresentation
  /** Whether this action requires network (affects secret content). */
  requiresNetwork?: boolean
}

/** Top-level action manifest for a plugin. */
export type PluginActionManifest = {
  pluginId: string
  actions: PluginActionManifestEntry[]
}

// ─── Registry ──────────────────────────────────────────────────────────────────

const manifestRegistry = new Map<string, PluginActionManifest>()

export function registerPluginActionManifest(manifest: PluginActionManifest): void {
  manifestRegistry.set(manifest.pluginId, manifest)
}

export function unregisterPluginActionManifest(pluginId: string): void {
  manifestRegistry.delete(pluginId)
}

export function getPluginActionManifest(pluginId: string): PluginActionManifest | undefined {
  return manifestRegistry.get(pluginId)
}

export function getAllPluginActionManifests(): PluginActionManifest[] {
  return [...manifestRegistry.values()]
}

export function clearPluginActionManifests(): void {
  manifestRegistry.clear()
}

// ─── Discovery ─────────────────────────────────────────────────────────────────

export type DiscoveredPluginAction = PluginActionManifestEntry & {
  pluginId: string
}

/**
 * Discover plugin actions that can handle the given object block kind and source.
 * Filters out network-requiring actions for secret content.
 */
export function discoverActionsForBlock(params: {
  kind: ObjectBlockKind
  source: 'clipboard' | 'editor-selection' | 'editor-document'
  textLength: number
  isSecret: boolean
}): DiscoveredPluginAction[] {
  const { kind, source, textLength, isSecret } = params
  const results: DiscoveredPluginAction[] = []

  for (const manifest of manifestRegistry.values()) {
    for (const action of manifest.actions) {
      // Check kind match
      if (!action.accepts.kinds.includes(kind)) continue

      // Check source match (empty = all sources)
      if (action.accepts.sources && action.accepts.sources.length > 0) {
        if (!action.accepts.sources.includes(source)) continue
      }

      // Check length constraints
      if (action.accepts.minLength !== undefined && textLength < action.accepts.minLength) continue
      if (action.accepts.maxLength !== undefined && textLength > action.accepts.maxLength) continue

      // Suppress network actions for secrets
      if (isSecret && action.requiresNetwork) continue

      results.push({ ...action, pluginId: manifest.pluginId })
    }
  }

  return results
}
