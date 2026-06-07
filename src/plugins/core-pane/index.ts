/**
 * First-party Pane Controls plugin.
 *
 * Provides workspace pane operations (split / close) as plugin commands so they
 * appear in the plugin manager alongside other built-in plugins. The commands
 * only emit effects; the effect runner performs the actual workspace mutations.
 */

import { definePlugin, type PaneInput } from '@fluxtext/plugin'

type SplitDirection = 'left' | 'right' | 'top' | 'bottom'

export const corePanePlugin = definePlugin({
  commands: [
    {
      id: 'core-pane.split',
      title: 'command.split.title',
      description: 'command.split.description',
      icon: 'columns',
      aliases: ['split', 'split-pane'],
      live: { pinnable: false },
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
            { label: 'param.direction.option.down.label', value: 'bottom' },
            { label: 'param.direction.option.up.label', value: 'top' },
          ],
          default: 'right',
        },
      ],
      run(ctx) {
        const source = ctx.inputs.source as PaneInput | undefined
        const direction = (ctx.params.direction as SplitDirection) ?? 'right'
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
      live: { pinnable: false },
      run() {
        return {
          effects: [{ type: 'pane.close' as const }],
        }
      },
    },
  ],
  toolbar: [
    {
      id: 'core-pane.split-button',
      title: 'toolbar.split.title',
      icon: 'Plus',
      commandId: 'core-pane.split',
      placement: 'editor-top-right',
      order: 0,
    },
  ],
})

export default corePanePlugin
