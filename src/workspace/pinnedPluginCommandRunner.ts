import type { PinnedAction } from '../store'
import type { CommandContribution } from './pluginTypes'
import { runTextPluginCommand } from './pluginCommandRunner.ts'

export type PinnedPluginCommandRunOptions = {
  command: CommandContribution
  pinned: PinnedAction
  params: Record<string, unknown>
  ownerPluginId?: string
  now?: () => number
  elapsedMs?: () => number
}

export async function runPinnedPluginCommandToPatch(
  options: PinnedPluginCommandRunOptions,
): Promise<Partial<PinnedAction>> {
  const output = await runTextPluginCommand(options.command, {
    inputText: options.pinned.inputText,
    params: options.params,
    isDev: options.pinned.isDev,
    ownerPluginId: options.ownerPluginId,
  })
  return {
    outputText: output.text,
    outputKind: output.kind,
    lastRunAt: options.now?.() ?? Date.now(),
    lastDurationMs: Math.round(options.elapsedMs?.() ?? 0),
    lastError: undefined,
  }
}
