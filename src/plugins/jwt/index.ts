/**
 * First-party JWT Decode plugin (migrated from legacy builtin action).
 */

import { definePlugin, textOutput, textError, type TextInput } from '@hiven/plugin'

function runJwt(text: string): string {
  const parts = text.trim().split('.')
  if (parts.length !== 3) throw new Error('Invalid JWT (expected 3 parts)')
  const decode = (s: string) => {
    const pad = s + '='.repeat((4 - s.length % 4) % 4)
    return JSON.parse(decodeURIComponent(escape(atob(pad.replace(/-/g, '+').replace(/_/g, '/')))))
  }
  const header = decode(parts[0])
  const payload = decode(parts[1])
  return `// Header\n${JSON.stringify(header, null, 2)}\n\n// Payload\n${JSON.stringify(payload, null, 2)}`
}

export const jwtPlugin = definePlugin({
  tools: [
    {
      id: 'jwt.run',
      title: 'command.run.title',
      icon: 'Key',
      aliases: ['jwt-decode', 'json-web-token'],
      inputPolicy: { mode: 'auto' },
      run(ctx) {
        try {
          return ctx.output.replaceActiveText(runJwt(ctx.input.text))
        } catch (e: any) {
          return ctx.output.error(`Error: ${e.message}`)
        }
      },
      surfaces: { launcher: true, panel: true, pinnable: true },
    },
  ],
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
          return textOutput(runJwt(text))
        } catch (e: any) {
          return textError(`Error: ${e.message}`)
        }
      },
    },
  ],
})

export default jwtPlugin
