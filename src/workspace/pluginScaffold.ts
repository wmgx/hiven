import type { PluginManifest } from './pluginTypes'

export type PluginScaffoldOptions = {
  pluginId: string
  title: string
}

export type PluginScaffoldFiles = {
  manifest: PluginManifest
  indexSource: string
  readmeSource: string
}

export function createPluginScaffoldFiles(options: PluginScaffoldOptions): PluginScaffoldFiles {
  const { pluginId, title } = options
  return {
    manifest: {
      pluginId,
      displayName: title,
      displayNameI18n: { zh: title },
      version: '1.0.0',
      capabilities: ['command'],
    },
    indexSource: pluginTemplate(pluginId, title),
    readmeSource: `# ${title}

This is a FluxText directory plugin.

- \`manifest.json\` contains package metadata only.
- \`index.js\` is the fixed entry.
- Runtime helpers are injected as \`globalThis.FluxTextPlugin\`; no relative framework import is needed.
- Host UI primitives are injected as \`ui.Button\`, \`ui.TextInput\`, \`ui.Select\`, \`ui.Checkbox\`, \`ui.Stack\`, \`ui.Text\`, \`ui.CodeBlock\`, and \`ui.EmptyState\`.
`,
  }
}

function pluginTemplate(pluginId: string, title: string) {
  return `const { definePlugin, effects, ui } = globalThis.FluxTextPlugin

export default definePlugin({
  id: ${JSON.stringify(pluginId)},
  title: ${JSON.stringify(title)},
  version: '1.0.0',
  commands: [{
    id: ${JSON.stringify(`${pluginId}.run`)},
    title: ${JSON.stringify(title)},
    titleI18n: { zh: ${JSON.stringify(title)} },
    description: 'Transform input text and write the result only when the command is run.',
    descriptionI18n: { zh: '运行命令时处理输入文本。' },
    tags: ['text'],
    optionalParams: true,
    inputs: [{ key: 'input', label: 'Input', labelI18n: { zh: '输入' }, kind: 'text', required: true }],
    inputResolution: { strategy: 'use-active', fallback: 'fail' },
    params: [{
      key: 'prefix',
      label: 'Prefix',
      labelI18n: { zh: '前缀' },
      type: 'text',
      default: '',
    }],
    run(ctx) {
      const input = ctx.inputs.input
      const text = input?.kind === 'text' ? input.text : ''
      const prefix = String(ctx.params.prefix ?? '')
      return { effects: [effects.replaceActiveText(prefix + text)] }
    },
  }],
  panels: [{
    id: ${JSON.stringify(`${pluginId}.panel`)},
    title: ${JSON.stringify(`${title} Panel`)},
    titleI18n: { zh: ${JSON.stringify(`${title} 面板`)} },
    component() {
      return ui.EmptyState({ children: 'Build plugin UI with host-injected ui primitives.' })
    },
  }],
})
`
}
