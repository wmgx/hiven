/**
 * FluxText Plugin System - definePlugin
 * The public API for plugin authors to declare their plugin.
 *
 * Usage:
 *   export default definePlugin({
 *     id: 'my-plugin',
 *     title: 'My Plugin',
 *     version: '1.0.0',
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
 *   id: 'trim',
 *   title: 'Trim',
 *   version: '1.0.0',
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
  // Validate id
  if (!definition.id || typeof definition.id !== 'string') {
    throw new Error('[definePlugin] Plugin id is required and must be a string')
  }
  if (!definition.version || typeof definition.version !== 'string') {
    throw new Error(`[definePlugin] Plugin "${definition.id}" version is required`)
  }

  // Validate contribution IDs use pluginId prefix (warn, don't throw)
  const allIds = [
    ...(definition.commands?.map((c) => c.id) ?? []),
    ...(definition.renderers?.map((r) => r.id) ?? []),
    ...(definition.panels?.map((p) => p.id) ?? []),
  ]
  for (const id of allIds) {
    if (!id.startsWith(definition.id + '.')) {
      console.warn(
        `[definePlugin] Contribution "${id}" in plugin "${definition.id}" should use "${definition.id}." prefix`
      )
    }
  }

  return definition
}
