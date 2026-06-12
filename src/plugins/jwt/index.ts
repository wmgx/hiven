/**
 * First-party JWT Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

export const jwtPlugin = definePlugin({
  commands: [
    {
      id: 'jwt.run',
      title: 'command.run.title',
      description: 'command.run.description',
      icon: 'Key',
      aliases: ['jwt-decode', 'json-web-token'],
      params: [],
      inputs: [
        { key: 'input', label: 'input.text.label', kind: 'text', required: true },
      ],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const input = ctx.inputs.input as TextInput
        const text = input?.kind === 'text' ? input.text : ''
        try {
          const parts = text.trim().split('.')
          if (parts.length !== 3) return textError('Error: Invalid JWT (expected 3 parts)')
          const decode = (s: string) => {
            const pad = s + '='.repeat((4 - s.length % 4) % 4)
            return JSON.parse(decodeURIComponent(escape(atob(pad.replace(/-/g, '+').replace(/_/g, '/')))))
          }
          const header = decode(parts[0])
          const payload = decode(parts[1])
          return textOutput(`// Header\n${JSON.stringify(header, null, 2)}\n\n// Payload\n${JSON.stringify(payload, null, 2)}`)
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default jwtPlugin
