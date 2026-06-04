export type LegacyScriptAction = {
  name: string
  title: string
  description?: string
  tags?: string[]
  params?: unknown[]
  optionalParams?: boolean
  run(ctx: {
    input: { text: string }
    params: Record<string, unknown>
    readClipboard: () => Promise<string>
    loadCDN: (url: string) => Promise<unknown>
    deps: Record<string, unknown>
  }): { text?: string } | Promise<{ text?: string } | void> | void
}

function parseLegacyActionSource(source: string): LegacyScriptAction | null {
  try {
    let code = source
      .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
      .trim()

    let hadDefineAction = false
    if (/export\s+default\s+defineAction\s*\(/.test(code)) {
      code = code.replace(/export\s+default\s+defineAction\s*\(\s*/, '')
      hadDefineAction = true
    } else {
      code = code.replace(/export\s+default\s+/, '')
      code = code.replace(/module\.exports\s*=\s*/, '')
    }

    if (hadDefineAction) {
      code = code.replace(/\)\s*;?\s*$/, '')
    }

    code = code.replace(/<(?:string|number|boolean|any|void|never|unknown|[A-Z]\w*)(?:\s*,\s*(?:string|number|boolean|any|void|never|unknown|[A-Z]\w*))*>/g, '')
    const value = new Function(`return (${code})`)()

    if (!value || typeof value !== 'object' || typeof value.name !== 'string' || typeof value.run !== 'function') {
      return null
    }
    return value as LegacyScriptAction
  } catch {
    return null
  }
}

export function createScriptPluginEntrySource(options: {
  pluginId: string
  fallbackTitle: string
  source: string
}): string {
  const action = parseLegacyActionSource(options.source)
  const title = action?.title || options.fallbackTitle
  const description = action?.description
  const tags = action?.tags ?? []
  const params = action?.params ?? []
  const optionalParams = action?.optionalParams ?? false
  const scriptBody = options.source
    .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
    .replace(/export\s+default\s+defineAction\s*\(/, 'return defineAction(')
    .replace(/export\s+default\s+/, 'return ')
    .replace(/module\.exports\s*=\s*/, 'return ')
  return [
    'const defineAction = (definition) => definition',
    '',
    'const action = (() => {',
    scriptBody,
    '})()',
    '',
    `const pluginId = ${JSON.stringify(options.pluginId)}`,
    `const title = ${JSON.stringify(title)}`,
    `const description = ${JSON.stringify(description)}`,
    `const tags = ${JSON.stringify(tags)}`,
    `const params = ${JSON.stringify(params)}`,
    `const optionalParams = ${JSON.stringify(optionalParams)}`,
    '',
    'export default {',
    '  id: pluginId,',
    '  title,',
    "  version: '1.0.0',",
    '  commands: [{',
    "    id: `${pluginId}.run`,",
    '    title,',
    '    description,',
    '    tags,',
    '    params,',
    '    optionalParams,',
    "    inputs: [{ key: 'input', label: 'Input', kind: 'text', required: true }],",
    "    inputResolution: { strategy: 'use-active', fallback: 'fail' },",
    '    async run(ctx) {',
    '      const input = ctx.inputs.input',
    "      const text = input?.kind === 'text' ? input.text : ''",
    '      const result = await Promise.resolve(action.run({',
    '        input: { text },',
    '        params: ctx.params,',
    "        readClipboard: async () => '',",
    "        loadCDN: async () => { throw new Error('Script package debug cannot load remote CDN dependencies yet') },",
    '        deps: {},',
    '      }))',
    '      if (!result || result.text === undefined) return { effects: [] }',
    "      const target = input?.kind === 'text' && input.paneId ? { paneId: input.paneId } : 'active-input'",
    "      return { effects: [{ type: 'text.replace', target, text: String(result.text) }] }",
    '    },',
    '  }],',
    '}',
    '',
  ].join('\n')
}
