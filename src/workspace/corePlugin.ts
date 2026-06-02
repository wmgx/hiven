/**
 * FluxText Core Plugin
 * Registers framework-owned core capabilities into the production plugin
 * registry using the standard plugin system.
 *
 * Product tools such as text-diff and json-diff are first-party plugins under
 * src/plugins, not framework core.
 *
 * Imported at app startup (App.tsx) to ensure registration happens before
 * any user interaction.
 */
import { pluginRegistry } from './pluginRegistry'
import { definePlugin } from './definePlugin'
import { CoreRegexPanel } from '../panels/CoreRegexPanel'

const corePlugin = definePlugin({
  id: 'core',
  title: 'FluxText Core',
  version: '1.0.0',

  commands: [
    {
      id: 'core.regex-tester',
      title: 'Regex Tester',
      titleI18n: { zh: '正则测试器' },
      description: 'Open regex tester panel',
      descriptionI18n: { zh: '打开正则测试面板' },
      tags: ['regex', 'search', 'panel'],
      icon: 'regex',
      run() {
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: 'core.regex-tester',
            placement: 'bottom' as const,
            ownerPluginId: 'core',
          }],
        }
      },
    },
  ],

  panels: [
    {
      id: 'core.regex-tester',
      title: 'Regex Tester',
      titleI18n: { zh: '正则测试器' },
      defaultPlacement: 'bottom',
      component: CoreRegexPanel,
    },
  ],
})

// Register to production registry at module load time
pluginRegistry.registerProductionPlugin(
  'core',
  corePlugin.commands ?? [],
  corePlugin.renderers ?? [],
  corePlugin.panels ?? []
)

export { corePlugin }
