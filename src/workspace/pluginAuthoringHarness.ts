import { pluginRegistry } from './pluginRegistry.ts'
import { createPluginScaffoldFiles } from './pluginScaffold.ts'
import { parsePluginDefinitionSource, runPluginDebugSource } from './pluginDebugRunner.ts'
import { runTextPluginCommand, stampPluginCommandEffects } from './pluginCommandRunner.ts'
import { samePinnedPluginCommandIdentity } from './pinnedActionIdentity.ts'
import { createPinnedPluginCommandAction } from './pinnedActionFactory.ts'

export type PluginAuthoringHarnessOptions = {
  pluginId: string
  title: string
  debugInput: string
  pinnedInput: string
  params?: Record<string, unknown>
}

export async function runPluginAuthoringHarness(options: PluginAuthoringHarnessOptions) {
  const scaffold = createPluginScaffoldFiles({
    pluginId: options.pluginId,
    title: options.title,
  })
  const definition = parsePluginDefinitionSource(scaffold.indexSource)
  if (!definition) throw new Error('Scaffold source did not parse as a plugin definition')
  const command = definition.commands?.[0]
  if (!command) throw new Error('Scaffold source did not define a command')

  const debug = await runPluginDebugSource(scaffold.indexSource, {
    inputText: options.debugInput,
    params: options.params,
  })

  pluginRegistry.unregisterDevPlugin(options.pluginId)
  pluginRegistry.registerDevPlugin(options.pluginId, definition.commands ?? [], definition.renderers ?? [], definition.panels ?? [])
  const resolved = pluginRegistry.resolveCommand(command.id, 'dev')
  if (!resolved) throw new Error(`Dev command "${command.id}" was not registered`)

  const pinnedRun = await runTextPluginCommand(resolved.contribution, {
    inputText: options.pinnedInput,
    params: options.params,
    isDev: true,
    ownerPluginId: options.pluginId,
  })

  const basePinned = {
    kind: 'plugin-command',
    actionId: command.id,
    pluginId: options.pluginId,
    isDev: true,
    params: options.params,
  }
  const pinnedAction = createPinnedPluginCommandAction({
    kind: 'plugin-command',
    actionId: command.id,
    pluginId: options.pluginId,
    title: command.title,
    titleI18n: command.titleI18n,
    icon: command.icon,
    isDev: true,
    params: options.params,
    live: command.live,
  })
  const devEffects = stampPluginCommandEffects([
    { type: 'pane.setRenderer', paneId: 'pane-1', renderer: `${options.pluginId}.renderer`, inputs: {} },
    { type: 'panel.openV2', panelId: `${options.pluginId}.panel` },
  ], { isDev: true, ownerPluginId: options.pluginId })

  pluginRegistry.unregisterDevPlugin(options.pluginId)

  return {
    scaffold: {
      manifestEntry: (scaffold.manifest as { entry?: string }).entry,
      fixedEntry: 'index.js',
      usesInjectedSdk: scaffold.indexSource.includes('globalThis.FluxTextPlugin'),
      usesWorkspaceImport: /\.\.\/workspace|@\/workspace/.test(scaffold.indexSource),
    },
    debug: {
      output: debug.output,
      logs: debug.logs,
    },
    devRegistry: {
      commandSource: resolved.meta.source,
      pluginId: resolved.meta.pluginId,
    },
    pinStore: {
      pinnedAction,
    },
    pinIdentity: {
      sameParamsFocusExisting: samePinnedPluginCommandIdentity(basePinned, { ...basePinned, params: { ...(options.params ?? {}) } }),
      differentParamsCreateNew: !samePinnedPluginCommandIdentity(basePinned, { ...basePinned, params: { ...(options.params ?? {}), __variant: 'other' } }),
    },
    pinnedRun: {
      output: pinnedRun,
      devEffectsKeepContext: devEffects.every((effect) =>
        (effect.type === 'pane.setRenderer' || effect.type === 'panel.openV2') &&
        effect._isDev === true &&
        effect.ownerPluginId === options.pluginId
      ),
    },
  }
}
