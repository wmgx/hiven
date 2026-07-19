import type { PluginManifest } from './pluginTypes'

export type PluginScaffoldTemplate = 'default' | 'script-command'

export type PluginScaffoldOptions = {
  pluginId: string
  title: string
  /** Scaffold flavor. `script-command` requests `shell.run` (L3, default denied). */
  template?: PluginScaffoldTemplate
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
  const template: PluginScaffoldTemplate = options.template ?? 'default'

  if (template === 'script-command') {
    return scriptCommandScaffold(pluginId, title)
  }
  return defaultScaffold(pluginId, title)
}

function defaultScaffold(pluginId: string, title: string): PluginScaffoldFiles {
  return {
    manifest: {
      pluginId,
      displayName: title,
      displayNameI18n: { zh: title },
      version: '1.0.0',
      capabilities: ['command'],
    },
    indexSource: defaultPluginTemplate(pluginId),
    readmeSource: `# ${title}

This is a hiven directory plugin.

- \`manifest.json\` contains package metadata only.
- \`index.js\` is the fixed entry.
- Runtime helpers are injected as \`globalThis.HivenPlugin\`; no relative framework import is needed.
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

function scriptCommandScaffold(pluginId: string, title: string): PluginScaffoldFiles {
  return {
    manifest: {
      pluginId,
      displayName: title,
      displayNameI18n: { zh: title },
      version: '1.0.0',
      capabilities: ['command'],
      // L3 permission — never granted by default; user must authorize in Plugins UI.
      permissions: ['shell.run'],
    },
    indexSource: scriptCommandTemplate(pluginId),
    readmeSource: `# ${title}

Script-command plugin template for hiven.

- Declares \`shell.run\` (L3). Host does **not** grant this by default.
- Entry uses the tools API. The sample \`run\` handler does **not** execute a real shell —
  wire host shell runtime (see \`doc/future/shell-effect-runtime-design.md\`) before enabling.
- i18n strings live in \`locales/en.json\` and \`locales/zh.json\`.
`,
    localeEn: JSON.stringify({
      'tool.script.title': title,
      'tool.script.subtitle': 'Script command template (shell runtime not wired)',
      'tool.script.placeholder':
        'Script command template — wire shell runtime to enable',
    }, null, 2) + '\n',
    localeZh: JSON.stringify({
      'tool.script.title': title,
      'tool.script.subtitle': '脚本命令模板（尚未接入 Shell 运行时）',
      'tool.script.placeholder':
        '脚本命令模板 — 接入 Shell 运行时后即可使用',
    }, null, 2) + '\n',
  }
}

function defaultPluginTemplate(pluginId: string) {
  return `const { definePlugin, effects, ui } = globalThis.HivenPlugin

export default definePlugin({
  commands: [{
    id: ${JSON.stringify(`${pluginId}.run`)},
    title: 'command.run.title',
    description: 'command.run.description',
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

function scriptCommandTemplate(pluginId: string) {
  // Intentionally does not call shell — host shell API is not productized yet.
  // See doc/future/shell-effect-runtime-design.md. Template returns explanatory text.
  return `const { definePlugin } = globalThis.HivenPlugin

/**
 * Script-command scaffold.
 * Manifest requests permissions: ['shell.run'] (L3, default denied).
 * Do not execute real shell here until the host exposes a shell runtime API.
 * When available, call it only after requirePluginPermissions(permissions, ['shell.run']).
 */
export default definePlugin({
  tools: [{
    id: ${JSON.stringify(`${pluginId}.script`)},
    title: 'tool.script.title',
    subtitle: 'tool.script.subtitle',
    icon: 'Terminal',
    aliases: ['script', 'shell', '脚本'],
    inputPolicy: { mode: 'auto' },
    run(ctx) {
      // Placeholder only — real shell execution is intentionally not wired.
      return ctx.output.text(
        ctx.t('tool.script.placeholder') ||
          'Script command template — wire shell runtime to enable',
      )
    },
    surfaces: { launcher: true, panel: false },
  }],
})
`
}
