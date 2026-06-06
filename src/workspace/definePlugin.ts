/**
 * FluxText Plugin System - definePlugin
 * The public API for plugin authors to declare their plugin.
 *
 * Package identity/metadata (pluginId, displayName, version) live in
 * manifest.json — the single source of truth. The definition only declares
 * runtime contributions.
 *
 * Usage:
 *   export default definePlugin({
 *     commands: [...],
 *     renderers: [...],
 *     panels: [...],
 *   })
 */

import type { PluginDefinition } from './pluginTypes'

/**
 * Define a plugin. Returns the definition object unchanged.
 * This function mainly exists to provide TypeScript type checking
 * and serves as a marker for plugin entry points.
 *
 * Example:
 * ```ts
 * export default definePlugin({
 *   commands: [{
 *     id: 'trim.run',
 *     title: 'Trim Whitespace',
 *     inputs: [{ key: 'input', label: 'Input', kind: 'text', required: true }],
 *     inputResolution: { strategy: 'use-active', fallback: 'fail' },
 *     run(ctx) {
 *       return {
 *         effects: [{
 *           type: 'text.replace',
 *           target: 'active-input',
 *           text: ctx.inputs.input.text.trim(),
 *         }],
 *       }
 *     },
 *   }],
 * })
 * ```
 */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  const hasContributions =
    Array.isArray(definition.commands) ||
    Array.isArray(definition.renderers) ||
    Array.isArray(definition.panels) ||
    Array.isArray(definition.toolbar)
  if (!hasContributions) {
    throw new Error('[definePlugin] Plugin must declare at least one of commands/renderers/panels/toolbar')
  }

  return definition
}
