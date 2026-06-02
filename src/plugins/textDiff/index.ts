/**
 * First-party Text Diff plugin.
 */

import { pluginRegistry } from '../../workspace/pluginRegistry'
import { definePlugin } from '../../workspace/definePlugin'
import type { PaneInput } from '../../workspace/pluginTypes'
import { TextDiffRenderer } from './TextDiffRenderer'

const textDiffPlugin = definePlugin({
  id: 'text-diff',
  title: 'Text Diff',
  version: '1.0.0',

  commands: [
    {
      id: 'text-diff.compare',
      title: 'Text Diff',
      titleI18n: { zh: '文本对比' },
      description: 'Compare two text panes',
      descriptionI18n: { zh: '对比两个文本面板' },
      tags: ['diff', 'text', 'compare'],
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
            renderer: 'text-diff.renderer',
            inputs: {
              original: { kind: 'pane' as const, paneId: originalPaneId },
              modified: { kind: 'pane' as const, paneId: modifiedPaneId },
            },
            ownerPluginId: 'text-diff',
            ownerContributionId: 'text-diff.compare',
          }],
        }
      },
    },
  ],

  renderers: [
    {
      id: 'text-diff.renderer',
      title: 'Text Diff Renderer',
      titleI18n: { zh: '文本对比渲染器' },
      surface: 'workspace',
      inputKinds: ['pane', 'pane'],
      component: TextDiffRenderer,
    },
  ],
})

pluginRegistry.registerProductionPlugin(
  'text-diff',
  textDiffPlugin.commands ?? [],
  textDiffPlugin.renderers ?? [],
  textDiffPlugin.panels ?? [],
)

export { textDiffPlugin }
