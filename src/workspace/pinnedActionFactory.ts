import type { PinnedAction, PinnedPluginCommandInput } from '../store'
import type { LiveActionCapability } from './pluginTypes'

function shouldAutoRunLiveAction(live?: LiveActionCapability): boolean {
  return live?.live?.enabled === true &&
    live.live.sideEffects !== 'writes' &&
    live.live.trigger !== 'manual'
}

export function makePinnedId(actionId: string): string {
  return `pinned-${actionId.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
}

export function createPinnedPluginCommandAction(command: PinnedPluginCommandInput): PinnedAction {
  return {
    id: makePinnedId(command.actionId),
    kind: 'plugin-command',
    actionId: command.actionId,
    pluginId: command.pluginId,
    isDev: !!command.isDev,
    title: command.title,
    titleI18n: command.titleI18n,
    icon: command.icon,
    inputText: '',
    outputText: '',
    outputKind: 'text',
    params: command.params ?? {},
    autoRun: shouldAutoRunLiveAction(command.live),
    debounceMs: command.live?.live?.debounceMs ?? 250,
    controlsOpen: command.live?.controls?.defaultOpen ?? false,
  }
}
