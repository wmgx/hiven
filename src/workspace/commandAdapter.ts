/**
 * FluxText Workspace Extension - Command Adapter
 * Adapts legacy ActionDef (returning {text}) to new CommandResult (returning effects).
 */

import type { ActionDef, ActionContext } from '../store'
import type { CommandResult, FluxEffect } from './types'

/**
 * Wraps a legacy ActionDef.run result into a CommandResult with effects.
 * - If result is { text }, wraps as text.replace effect targeting active-input
 * - If result is void/undefined, returns empty effects
 */
export function adaptLegacyResult(
  result: { text: string } | void | undefined
): CommandResult {
  if (!result || result.text === undefined) {
    return { effects: [] }
  }

  return {
    effects: [
      {
        type: 'text.replace',
        target: 'active-input',
        text: result.text,
      },
    ],
  }
}

/**
 * Run a legacy ActionDef and return a CommandResult.
 */
export async function runLegacyAction(
  action: ActionDef,
  ctx: ActionContext
): Promise<CommandResult> {
  const result = action.run(ctx)

  if (result && typeof (result as any).then === 'function') {
    const resolved = await (result as Promise<{ text: string }>)
    return adaptLegacyResult(resolved)
  }

  return adaptLegacyResult(result as { text: string } | void)
}
