/**
 * First-party Base64 Encode/Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'
import { EncodeDecodeSurface } from './EncodeDecodeSurface'

function runBase64(text: string, mode: unknown): string {
  if (mode === 'encode') {
    return btoa(unescape(encodeURIComponent(text)))
  }
  return decodeURIComponent(escape(atob(text.trim())))
}

export const base64Plugin = definePlugin({
  ui: {
    surfaces: [
      {
        id: 'main',
        kind: 'custom-view',
        title: 'Encode / Decode Tools',
        titleI18n: { zh: 'Encode / Decode Tools' },
        icon: 'Binary',
        aliases: [
          'encode',
          'decode',
          'base64',
          'url encode',
          'url decode',
          'html encode',
          'html decode',
          'escape',
          'unescape',
          'slashes',
        ],
        component: EncodeDecodeSurface,
        entry: { launcher: true, shortcutBindable: true },
        shell: {
          defaultWidth: 900,
          defaultHeight: 620,
          minWidth: 680,
          minHeight: 440,
          closeOnBlur: false,
          resizable: true,
        },
      },
    ],
  },
  tools: [
    {
      id: 'base64.run',
      title: 'command.run.title',
      subtitle: 'command.run.description',
      icon: 'Binary',
      aliases: ['encode', 'decode'],
      inputPolicy: { mode: 'auto' },
      requireParamSelection: true,
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.encode.label', value: 'encode' },
            { label: 'param.mode.option.decode.label', value: 'decode' },
          ],
          default: 'encode',
        },
      ],
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runBase64(ctx.input.text, ctx.params.mode))
        } catch (e: any) {
          return ctx.output.error('Error: ' + e.message)
        }
      },
      surfaces: { launcher: false, panel: true, pinnable: false },
    },
  ],
  commands: [
    {
      id: 'base64.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Binary',
      aliases: ['encode', 'decode'],
      live: { live: { enabled: true, trigger: 'on-input', sideEffects: 'none', debounceMs: 250 } },
      params: [
        {
          key: 'mode',
          label: 'param.mode.label',
          type: 'single-select',
          options: [
            { label: 'param.mode.option.encode.label', value: 'encode' },
            { label: 'param.mode.option.decode.label', value: 'decode' },
          ],
          default: 'encode',
        },
      ],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          return textOutput(runBase64(text, ctx.params.mode))
        } catch (e: any) {
          return textError('Error: ' + e.message)
        }
      },
    },
  ],
})

export default base64Plugin
