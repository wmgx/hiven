/**
 * FluxText Core Plugin
 * Registers core built-in capabilities (diff, json-diff, regex-tester)
 * into the production plugin registry using the standard plugin system.
 *
 * Imported at app startup (App.tsx) to ensure registration happens before
 * any user interaction.
 */
import { pluginRegistry } from './pluginRegistry'
import { definePlugin } from './definePlugin'
import type { PaneInput } from './pluginTypes'
import { CoreJsonDiffRenderer } from '../presentations/CoreJsonDiffRenderer'
import { CoreRegexPanel } from '../panels/CoreRegexPanel'

const corePlugin = definePlugin({
  id: 'core',
  title: 'FluxText Core',
  version: '1.0.0',

  commands: [
    {
      id: 'core.diff',
      title: 'Diff',
      titleI18n: { zh: '对比' },
      description: 'Compare two panes; JSON supports semantic diff',
      descriptionI18n: { zh: '对比两个面板；JSON 支持语义对比' },
      tags: ['diff', 'json', 'compare'],
      icon: 'git-compare',
      inputs: [
        { key: 'original', label: 'Pane A', labelI18n: { zh: '面板 A' }, kind: 'pane', required: true },
        { key: 'modified', label: 'Pane B', labelI18n: { zh: '面板 B' }, kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'auto-fill', fallback: 'prompt' },
      run(ctx) {
        const originalPaneId = (ctx.inputs.original as PaneInput).paneId
        const modifiedPaneId = (ctx.inputs.modified as PaneInput).paneId
        return {
          effects: [{
            type: 'pane.setRenderer' as const,
            paneId: originalPaneId,
            renderer: 'core.diff',
            inputs: {
              original: { kind: 'pane' as const, paneId: originalPaneId },
              modified: { kind: 'pane' as const, paneId: modifiedPaneId },
            },
            ownerPluginId: 'core',
            ownerContributionId: 'core.diff',
          }],
        }
      },
    },
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

  renderers: [
    {
      id: 'core.diff',
      title: 'Diff',
      titleI18n: { zh: '对比' },
      surface: 'workspace',
      inputKinds: ['pane', 'pane'],
      component: CoreJsonDiffRenderer,
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
