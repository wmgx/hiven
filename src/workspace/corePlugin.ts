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
import { CoreDiffRenderer } from '../presentations/CoreDiffRenderer'
import { CoreJsonDiffRenderer } from '../presentations/CoreJsonDiffRenderer'
import { CoreRegexPanel } from '../panels/CoreRegexPanel'

const corePlugin = definePlugin({
  id: 'core',
  title: 'FluxText Core',
  version: '1.0.0',

  commands: [
    {
      id: 'core.diff',
      title: 'Text Diff',
      titleI18n: { zh: '文本对比' },
      description: 'Compare two text panes',
      descriptionI18n: { zh: '对比两个文本面板' },
      tags: ['diff', 'compare'],
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
      id: 'core.json-diff',
      title: 'JSON Diff',
      titleI18n: { zh: 'JSON 对比' },
      description: 'Compare two JSON panes',
      descriptionI18n: { zh: '对比两个 JSON 面板' },
      tags: ['diff', 'json', 'compare'],
      icon: 'braces',
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
            renderer: 'core.json-diff',
            inputs: {
              original: { kind: 'pane' as const, paneId: originalPaneId },
              modified: { kind: 'pane' as const, paneId: modifiedPaneId },
            },
            ownerPluginId: 'core',
            ownerContributionId: 'core.json-diff',
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
      title: 'Monaco Diff',
      titleI18n: { zh: 'Monaco 对比' },
      surface: 'workspace',
      inputKinds: ['pane', 'pane'],
      component: CoreDiffRenderer,
    },
    {
      id: 'core.json-diff',
      title: 'JSON Object Diff',
      titleI18n: { zh: 'JSON 对象对比' },
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
