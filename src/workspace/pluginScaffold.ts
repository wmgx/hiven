import type { PluginManifest } from './pluginTypes'

export type PluginScaffoldOptions = {
  pluginId: string
  title: string
}

export type PluginScaffoldFiles = {
  manifest: PluginManifest
  indexSource: string
  readmeSource: string
  localeEn: string
  localeZh: string
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
    indexSource: pluginTemplate(pluginId),
    readmeSource: `# ${title}

This is a FluxText directory plugin.

- \`manifest.json\` contains package metadata only.
- \`index.js\` is the fixed entry.
- Runtime helpers are injected as \`globalThis.FluxTextPlugin\`; no relative framework import is needed.
- Host UI primitives are injected as \`ui.Button\`, \`ui.TextInput\`, \`ui.Select\`, \`ui.Checkbox\`, \`ui.Stack\`, \`ui.Text\`, \`ui.CodeBlock\`, and \`ui.EmptyState\`.
- Reusable rendering kits are injected as \`kits.DualEditorView\` and \`kits.diff.*\`.
- Read-only store hooks are injected as \`hooks.useSettings\`, \`hooks.useLocale\`, \`hooks.usePaneText\`, and \`hooks.useT(pluginId)\`.
- i18n strings live in \`locales/en.json\` and \`locales/zh.json\`; code writes only keys via \`hooks.useT('${pluginId}')\` or \`i18n.makeT('${pluginId}', locale)\`.
`,
    localeEn: JSON.stringify({
      'command.run.title': title,
      'command.run.description': 'Transform input text and write the result only when the command is run.',
      'input.text.label': 'Input',
      'param.prefix.label': 'Prefix',
      'panel.main.title': `${title} Panel`,
    }, null, 2) + '\n',
    localeZh: JSON.stringify({
      'command.run.title': title,
      'command.run.description': '运行命令时处理输入文本。',
      'input.text.label': '输入',
      'param.prefix.label': '前缀',
      'panel.main.title': `${title} 面板`,
    }, null, 2) + '\n',
  }
}

function pluginTemplate(pluginId: string) {
  return `const { definePlugin, effects, ui } = globalThis.FluxTextPlugin

export default definePlugin({
  commands: [{
    id: ${JSON.stringify(`${pluginId}.run`)},
    title: 'command.run.title',
    description: 'command.run.description',
    optionalParams: true,
    inputs: [{ key: 'input', label: 'input.text.label', kind: 'text', required: true }],
    inputResolution: { strategy: 'use-active', fallback: 'fail' },
    params: [{
      key: 'prefix',
      label: 'param.prefix.label',
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
    title: 'panel.main.title',
    component() {
      return ui.EmptyState({ children: 'Build plugin UI with host-injected ui primitives.' })
    },
  }],
})
`
}
