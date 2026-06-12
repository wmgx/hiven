import { localized, useAppStore } from '../store'
import { applyEffects } from './effectRunner'
import { pluginRegistry, type CommandEntry } from './pluginRegistry'
import { defaultPluginCommandParams, effectsFromPluginCommandResult } from './pluginCommandRunner'
import type { ResolvedInputs } from './pluginTypes'

export async function runPluginCommandById(
  commandId: string,
  options: {
    isDev?: boolean
    inputs?: ResolvedInputs
    params?: Record<string, unknown>
  } = {},
) {
  const entry = pluginRegistry.resolveCommand(commandId, options.isDev ? 'dev' : 'production')
  if (!entry) {
    const title = commandId
    useAppStore.getState().setLastCommandStatus({
      title,
      status: 'error',
      message: `Command "${commandId}" not found`,
      updatedAt: Date.now(),
    })
    return false
  }
  return runPluginCommandEntry(entry, options)
}

export async function runPluginCommandEntry(
  entry: CommandEntry,
  options: {
    isDev?: boolean
    inputs?: ResolvedInputs
    params?: Record<string, unknown>
  } = {},
) {
  const state = useAppStore.getState()
  const command = entry.contribution
  const title = localized(command.title || command.id, command.titleI18n, state.locale)
  const displayTitle = options.isDev ? `[DEV] ${title}` : title
  state.setLastCommandStatus({ title: displayTitle, status: 'running', updatedAt: Date.now() })

  try {
    const result = await command.run({
      inputs: options.inputs ?? {},
      params: {
        ...defaultPluginCommandParams(command.params),
        ...(options.params ?? {}),
      },
    })
    const effects = effectsFromPluginCommandResult(result, {
      isDev: options.isDev,
      ownerPluginId: entry.meta.pluginId,
    })
    if (effects.length > 0) {
      const runResult = applyEffects(effects)
      if (runResult.errors.length > 0) {
        useAppStore.getState().setLastCommandStatus({
          title: displayTitle,
          status: 'error',
          message: runResult.errors[0],
          updatedAt: Date.now(),
        })
        return false
      }
    }
    useAppStore.getState().setLastCommandStatus({ title: displayTitle, status: 'success', updatedAt: Date.now() })
    return true
  } catch (error: unknown) {
    useAppStore.getState().setLastCommandStatus({
      title: displayTitle,
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      updatedAt: Date.now(),
    })
    return false
  }
}
