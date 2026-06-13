import type { PinnedAction } from '../store'
import type { CommandContribution } from './pluginTypes'
import { runTextPluginCommand } from './pluginCommandRunner.ts'
import type { LauncherItem, PluginLauncherApi } from './launcher/types'

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

export type PinnedLauncherItemRunOptions = {
  item: LauncherItem
  pinned: PinnedAction
  settings: unknown
  locale: 'en' | 'zh'
  t: (key: string, vars?: Record<string, string | number>) => string
  now?: () => number
  elapsedMs?: () => number
}

function createPinnedLauncherApi(inputText: string): PluginLauncherApi {
  return {
    getActiveText: () => inputText,
    getSelectionText: () => '',
    getPaneSnapshot: () => ({
      activePaneId: '',
      paneIds: [],
      panes: {},
      renderers: {},
    }),
    isPanePanelOpen: () => false,
    getClipboardText: async () => '',
    replaceActiveText: async () => {},
    insertText: async () => {},
    copyText: async () => {},
    openUrl: async () => {},
    showMainPanel: async () => {},
    dispatchEffects: () => ({ applied: [], errors: [] }),
    showMessage: () => {},
  }
}

export async function runPinnedLauncherItemToPatch(
  options: PinnedLauncherItemRunOptions,
): Promise<Partial<PinnedAction>> {
  const result = await Promise.resolve(options.item.execute({
    input: { text: options.pinned.inputText },
    settings: options.settings,
    locale: options.locale,
    api: createPinnedLauncherApi(options.pinned.inputText),
    t: options.t,
  }))

  if (!result.ok) {
    return {
      outputText: result.message,
      outputKind: 'error',
      lastRunAt: options.now?.() ?? Date.now(),
      lastDurationMs: Math.round(options.elapsedMs?.() ?? 0),
      lastError: result.message,
    }
  }

  const firstChoice = result.output?.choices[0]
  return {
    outputText: firstChoice?.preview ?? firstChoice?.title ?? '',
    outputKind: 'text',
    lastRunAt: options.now?.() ?? Date.now(),
    lastDurationMs: Math.round(options.elapsedMs?.() ?? 0),
    lastError: undefined,
  }
}
