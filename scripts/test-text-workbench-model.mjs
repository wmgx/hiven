#!/usr/bin/env node
// Workbench results and entry compatibility; no rendering or styling assertions.
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value) },
  removeItem: (key) => { values.delete(key) },
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { DEFAULT_WORKBENCH_OPTIONS: defaults, WORKBENCH_OPERATIONS: operations, evaluateWorkbench, getWorkbenchOperation } = await vite.ssrLoadModule('/src/plugins/line-tools/workbenchModel.ts')
  const transforms = await vite.ssrLoadModule('/src/kits/textTransforms/index.ts')
  const { lineOperationRoutes, caseOperationRoutes, statsRoute } = await vite.ssrLoadModule('/src/plugins/line-tools/routes.ts')
  const { TextWorkbenchSurface } = await vite.ssrLoadModule('/src/plugins/line-tools/TextWorkbenchSurface.tsx')
  const { TextToolsSurface } = await vite.ssrLoadModule('/src/plugins/line-tools/TextToolsSurface.tsx')
  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { pluginRegistry } = await vite.ssrLoadModule('/src/workspace/pluginRegistry.ts')
  registerBundledPluginPackages()
  const plugin = pluginRegistry.getPluginDefinition('line-tools', 'production')
  assert.ok(plugin)
  const result = (text, operation, options = {}) => evaluateWorkbench(text, operation, { ...defaults, ...options }, transforms)
  const ready = (text, operation, options = {}) => {
    const output = result(text, operation, options)
    assert.equal(output.status, 'ready')
    return output.text
  }

  const routes = [
    ['line-sort', 'sort', 'line-tools.sort', { direction: 'asc', ignoreCase: false }],
    ['line-dedup', 'dedup', 'line-tools.dedup', { ignoreCase: false }],
    ['line-reverse', 'reverse', 'line-tools.reverse', {}],
    ['text-reverse', 'reverse-text', 'line-tools.reverse-text', {}],
    ['line-remove-blank', 'remove-blank', 'line-tools.remove-blank-lines', {}],
    ['line-trim', 'trim', 'line-tools.trim-whitespace', {}],
    ['line-join', 'join', 'line-tools.join', { separator: ',' }],
    ['line-prepend', 'prepend', 'line-affix.prepend', { prefix: '- ' }],
    ['line-append', 'append', 'line-affix.append', { suffix: ',' }],
    ['line-wrap', 'wrap', 'line-affix.wrap', { left: '"', right: '"' }],
    ['sql-in-string', 'sql-string', 'sqlin.string', {}],
    ['sql-in-number', 'sql-number', 'sqlin.number', {}],
  ]
  assert.deepEqual(lineOperationRoutes.map((route) => route.surfaceId), routes.map(([id]) => id))
  assert.equal(new Set(operations.map(({ value }) => value)).size, 21)
  assert.equal(getWorkbenchOperation('clean-agent-text'), 'clean-agent-text')
  assert.equal(ready('╭─────╮\n│ cat │\n╰─────╯', 'clean-agent-text'), 'cat')
  assert.equal(ready('+-----+\n| cat |\n+-----+', 'clean-agent-text', { cleanAgentAscii: true }), 'cat')
  assert.equal(getWorkbenchOperation('main'), 'trim', 'main keeps its existing initial operation')
  assert.equal(getWorkbenchOperation('unknown'), 'trim')
  assert.equal(getWorkbenchOperation('regex-escape'), 'regex-escape')
  assert.equal(getWorkbenchOperation('find-duplicates'), 'find-duplicates')
  assert.equal(plugin.ui.surfaces.find(({ id }) => id === 'main').component, TextWorkbenchSurface)

  const sample = "  B  \r\n\r\nb\nO'Brien\n B \n🙂"
  const variants = [
    {},
    { direction: 'desc', ignoreCase: true, separator: '\\t|\\n', prefix: '[', suffix: ']', left: '(', right: ')' },
    { separator: '', prefix: '', suffix: '', left: '', right: '' },
  ]
  for (const [surfaceId, operation, toolId, expectedDefaults] of routes) {
    assert.equal(getWorkbenchOperation(surfaceId), operation)
    const route = lineOperationRoutes.find((item) => item.surfaceId === surfaceId)
    const entry = plugin.launcher.items.find(({ id }) => id === `open-${surfaceId}`)
    assert.ok(entry, `${surfaceId}: existing launcher entry remains registered`)
    assert.deepEqual(entry.display.aliases, route.aliases)
    assert.equal(plugin.ui.surfaces.find(({ id }) => id === surfaceId).component, TextWorkbenchSurface)
    const opened = []
    await entry.execute({ input: { text: sample }, api: { openSurface: (...args) => opened.push(args) } })
    assert.deepEqual(opened, [[surfaceId, { initialText: sample }]], 'route identity and exact source material survive entry')
    const tool = plugin.tools.find(({ id }) => id === toolId)
    assert.ok(tool, `${toolId}: existing command remains registered`)
    const params = Object.fromEntries((tool.params ?? []).map(({ key, default: value }) => [key, value]))
    assert.deepEqual(params, expectedDefaults, `${toolId}: existing command defaults are unchanged`)
    for (const [key, value] of Object.entries(params)) assert.equal(defaults[key], value)
    for (const custom of variants) {
      const executed = await tool.run({ input: { text: sample }, params: { ...params, ...custom }, output: { text: (text) => text } })
      assert.equal(ready(sample, operation, custom), executed, `${surfaceId}: preview agrees with command/Saved Action parameters`)
    }
  }
  for (const route of [...caseOperationRoutes, statsRoute]) {
    assert.equal(plugin.ui.surfaces.find(({ id }) => id === route.surfaceId).component, TextToolsSurface, 'naming comparison and statistics keep their separate surface')
  }

  // Existing single steps retain their historical newline semantics. Combined
  // cleanup uses the existing delimiter-preserving algorithm and exact defaults.
  assert.equal(ready(' A \r\n\r\nA\n', 'remove-blank'), ' A \r\nA')
  assert.equal(ready(' A \r\n A \n', 'trim'), 'A\nA\n')
  assert.equal(ready('A\r\nA\nA', 'dedup'), 'A\r\nA')
  assert.equal(ready(' A \r\n\r\nA\n', 'clean-list'), ' A \r\nA\n')
  assert.equal(ready(sample, 'clean-list', { trim: false, removeBlank: false, dedup: false }), sample)
  assert.equal(ready(' \t\r\n\u00a0\n', 'clean-list'), '', 'a result that removes all rows remains deliverable')
  assert.equal(ready('A\na\nA', 'dedup', { ignoreCase: false }), 'A\na')
  assert.equal(ready('A\na\nA', 'dedup', { ignoreCase: true }), 'A', 'changing parameters recomputes from source material')

  let material = '  beta  \n\n alpha \nalpha\n beta'
  for (const [operation, options, expected] of [
    ['clean-list', { trim: true, removeBlank: true, dedup: true }, 'beta\nalpha'],
    ['sort', {}, 'alpha\nbeta'],
    ['wrap', {}, '"alpha"\n"beta"'],
    ['join', { separator: ', ' }, '"alpha", "beta"'],
  ]) {
    material = ready(material, operation, options)
    assert.equal(material, expected, 'using each result as the next input preserves the whole chain')
  }

  material = '%20%20beta%20%20%0A%0A%20alpha%20%0Aalpha%0A%20beta'
  for (const [operation, options, expected] of [
    ['url-decode', {}, '  beta  \n\n alpha \nalpha\n beta'],
    ['clean-list', { trim: true, removeBlank: true, dedup: true }, 'beta\nalpha'],
    ['sort', {}, 'alpha\nbeta'],
    ['sql-string', {}, "('alpha','beta')"],
  ]) {
    material = ready(material, operation, options)
    assert.equal(material, expected, 'URL input can be cleaned, sorted, and turned into an SQL list without losing intermediate results')
  }

  for (const { value } of operations) assert.deepEqual(result('', value), { status: 'idle' })
  assert.deepEqual(result(' \n\t', 'json-format'), { status: 'ready', text: '' })
  assert.equal(ready('{"value":1}', 'json-format', { indent: 4 }), '{\n    "value": 1\n}')
  assert.equal(ready('{\n  "value": 1\n}', 'json-compact'), '{"value":1}')
  const encoded = ready('a & b/中文', 'url-encode')
  assert.equal(encoded, 'a%20%26%20b%2F%E4%B8%AD%E6%96%87')
  assert.equal(ready(encoded, 'url-decode'), 'a & b/中文')
  assert.equal(ready('a.b\\c\n中文', 'regex-escape'), 'a\\.b\\\\c\\n中文')
  const urlSource = '[https://label.example](https://target.example "https://title.example")\nhttps://target.example'
  assert.equal(ready(urlSource, 'extract-urls'), 'https://target.example\nhttps://target.example')
  assert.deepEqual(result('no links', 'extract-urls'), { status: 'error', messageKey: 'extractList.noUrls' })
  assert.equal(ready('https://recovered.example', 'extract-urls'), 'https://recovered.example', 'editing recovers without source replacement')
  assert.equal(ready('A\nB\nA\nA', 'find-duplicates'), '"A" ×3 [1, 3, 4]')
  assert.equal(ready('A\na\n A ', 'find-duplicates', { ignoreCase: true, trim: true }), '', 'other operation options do not silently change matching')
  assert.equal(ready('A\na\n A ', 'find-duplicates', { duplicateIgnoreCase: true, duplicateTrim: true }), '"A" ×3 [1, 2, 3]')
  const regexTool = plugin.tools.find(({ id }) => id === 'line-tools.regex-escape')
  assert.equal(regexTool.run({ input: { text: 'a.b' }, output: { text: (text) => text } }), 'a\\.b')
  assert.equal(regexTool.run({ input: { text: '' }, output: { error: (error) => error }, t: (key) => key }), 'regexEscape.empty')
  assert.deepEqual(result('{', 'json-format'), { status: 'error', messageKey: 'workbench.error.json' })
  assert.deepEqual(result('%E0%A4%A', 'url-decode'), { status: 'error', messageKey: 'workbench.error.url' })
  assert.equal(ready('{"fixed":true}', 'json-format'), '{\n  "fixed": true\n}', 'valid edits recover from an invalid result')
  console.log('text-workbench-model: 12 registered routes, command defaults/parameters, cleanup chain, empty results, JSON and URL passed')
} finally {
  await vite.close()
}
