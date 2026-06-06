/**
 * First-party Pane Controls plugin.
 *
 * Provides workspace pane operations (split / close) as plugin commands so they
 * appear in the plugin manager alongside other built-in plugins. The commands
 * only emit effects; the effect runner performs the actual workspace mutations.
 */

import { definePlugin, type PaneInput } from '@fluxtext/plugin'

type SplitDirection = 'right' | 'left' | 'down' | 'up'

function toPaneDirection(value: unknown): 'left' | 'right' | 'top' | 'bottom' {
  switch (value) {
    case 'down': return 'bottom'
    case 'up': return 'top'
    case 'left': return 'left'
    default: return 'right'
  }
}

export const corePanePlugin = definePlugin({
  commands: [
    {
      id: 'core-pane.split',
      title: 'command.split.title',
      description: 'command.split.description',
      icon: 'columns',
      aliases: ['split', 'split-pane'],
      inputs: [
        { key: 'source', label: 'input.source.label', kind: 'pane', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      params: [
        {
          key: 'direction',
          label: 'param.direction.label',
          type: 'single-select',
          options: [
            { label: 'param.direction.option.right.label', value: 'right' },
            { label: 'param.direction.option.left.label', value: 'left' },
            { label: 'param.direction.option.down.label', value: 'down' },
            { label: 'param.direction.option.up.label', value: 'up' },
          ],
          default: 'right',
        },
      ],
      run(ctx) {
        const source = ctx.inputs.source as PaneInput | undefined
        const direction = toPaneDirection(ctx.params.direction as SplitDirection)
        return {
          effects: [{
            type: 'pane.create' as const,
            pane: { text: '', language: source?.language || 'plaintext' },
            focus: true,
            direction,
          }],
        }
      },
    },
    {
      id: 'core-pane.close',
      title: 'command.close.title',
      description: 'command.close.description',
      icon: 'x',
      aliases: ['close-pane', 'close'],
      run() {
        return {
          effects: [{ type: 'pane.close' as const }],
        }
      },
    },
  ],
})

export default corePanePlugin
