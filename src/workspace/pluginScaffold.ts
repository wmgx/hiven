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
- Content kits are injected as \`kits.content.detectContent\` (not Diff product kits).
- Diff / DualEditorView are **not** public SDK; only the first-party text-diff plugin uses \`@hiven/plugin-diff\`.
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

- Declares \`shell.run\` (L3). Host does **not** grant this by default — authorize in Plugins UI.
- Entry uses the tools API and calls \`ctx.shell.run\` after an L2 confirm choice.
- Prefer editing command text in the tool \`run\` handler, or use first-party **Custom Commands**.
- i18n strings live in \`locales/en.json\` and \`locales/zh.json\`.
`,
    localeEn: JSON.stringify({
      'tool.script.title': title,
      'tool.script.subtitle': 'Script command (needs shell.run)',
      'confirm.title': 'Run script?',
      'confirm.run': 'Run',
      'confirm.cancel': 'Cancel',
      'error.permission': 'Grant shell.run permission first',
      'error.shell': 'Shell failed: {message}',
    }, null, 2) + '\n',
    localeZh: JSON.stringify({
      'tool.script.title': title,
      'tool.script.subtitle': '脚本命令（需要 shell.run）',
      'confirm.title': '运行脚本？',
      'confirm.run': '运行',
      'confirm.cancel': '取消',
      'error.permission': '请先授予 shell.run 权限',
      'error.shell': 'Shell 失败：{message}',
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
  return `const { definePlugin } = globalThis.HivenPlugin

/**
 * Script-command scaffold.
 * Manifest requests permissions: ['shell.run'] (L3, default denied).
 * Host injects ctx.shell; unauthorized calls throw.
 * Edit COMMAND below (or switch to first-party Custom Commands for a settings UI).
 */
const COMMAND = 'echo "hello from ${pluginId}"'

export default definePlugin({
  tools: [{
    id: ${JSON.stringify(`${pluginId}.script`)},
    title: 'tool.script.title',
    subtitle: 'tool.script.subtitle',
    icon: 'Terminal',
    aliases: ['script', 'shell', '脚本'],
    inputPolicy: { mode: 'auto' },
    async run(ctx) {
      const runLabel = ctx.t('confirm.run')
      const cancelLabel = ctx.t('confirm.cancel')
      return ctx.output.choices([
        {
          id: 'confirm-run-script',
          title: runLabel,
          subtitle: COMMAND,
          icon: 'Terminal',
          tone: 'danger',
          primaryAction: async () => {
            try {
              const result = await ctx.shell.run({ command: COMMAND, timeoutMs: 15000 })
              const out = (result.stdout || result.stderr || '').trim()
              if (result.timedOut || (result.exitCode ?? 0) !== 0) {
                return { ok: false, message: out || 'command failed' }
              }
              if (out) await ctx.api.copyText(out)
              return { ok: true, message: out || 'ok' }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              if (/permission|shell\\.run|not granted/i.test(message)) {
                return { ok: false, message: ctx.t('error.permission') }
              }
              return { ok: false, message: ctx.t('error.shell', { message }) }
            }
          },
        },
        {
          id: 'cancel-run-script',
          title: cancelLabel,
          icon: 'X',
          primaryAction: async () => ({ ok: true }),
        },
      ])
    },
    surfaces: { launcher: true, panel: false },
  }],
})
`
}
