/**
 * FluxText Plugin System - Toolbar Command Runner
 *
 * Executes a plugin command referenced by a toolbar button using default
 * parameters and use-active input resolution. Toolbar buttons are "one-click
 * default action" entry points; commands that need parameter prompts should be
 * invoked from the command palette instead.
 */

import { pluginRegistry } from './pluginRegistry'
import { resolvePluginInputs, buildPluginCommandContext } from './pluginInputResolver'
import { defaultPluginCommandParams, stampPluginCommandEffects } from './pluginCommandRunner'
import { applyEffects } from './effectRunner'
import { showToast } from './toast'

/**
 * Run a registered plugin command with default params and auto-resolved inputs.
 * Returns true when the command executed, false when inputs could not be
 * resolved without prompting (toolbar buttons never prompt).
 */
export async function runToolbarCommand(commandId: string, isDev = false): Promise<boolean> {
  const entry = pluginRegistry.resolveCommand(commandId, isDev ? 'dev' : 'production')
  if (!entry) {
    showToast(`Command "${commandId}" is not registered`, 'error')
    return false
  }

  const command = entry.contribution
  const slots = command.inputs ?? []
  const resolution = command.inputResolution ?? { strategy: 'use-active' as const, fallback: 'fail' as const }
  const resolveResult = resolvePluginInputs(slots, resolution)

  if (!resolveResult.ok) {
    // Toolbar buttons do not prompt; surface a hint and bail.
    if (resolveResult.reason === 'fail') return false
    showToast('This command needs more input. Use the command palette instead.', 'warning')
    return false
  }

  const ctx = buildPluginCommandContext(resolveResult.inputs, defaultPluginCommandParams(command.params))
  const result = await Promise.resolve(command.run(ctx))
  const effects = stampPluginCommandEffects(result.effects ?? [], {
    isDev,
    ownerPluginId: entry.meta.pluginId,
  })
  if (effects.length > 0) {
    applyEffects(effects)
  }
  return true
}
