/**
 * First-party Text Diff plugin.
 */

import { definePlugin, type PaneInput } from '@fluxtext/plugin'
import { TextDiffRenderer } from './TextDiffRenderer'

export const textDiffPlugin = definePlugin({
  commands: [
    {
      id: 'text-diff.compare',
      title: 'command.compare.title',
      description: 'command.compare.description',
      icon: 'git-compare',
      live: { pinnable: false },
      inputs: [
        { key: 'original', label: 'input.original.label', kind: 'pane', required: true },
        { key: 'modified', label: 'input.modified.label', kind: 'pane', required: true },
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
      title: 'renderer.title',
      surface: 'workspace',
      inputKinds: ['pane', 'pane'],
      component: TextDiffRenderer,
    },
  ],
})

export default textDiffPlugin
