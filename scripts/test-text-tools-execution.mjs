import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { createJiti } from 'jiti'
import ts from 'typescript'
import { jsonCore } from './helpers/text-transform-cores.mjs'

const jiti = createJiti(import.meta.url)
// Only adapt the browser transport; the actual worker and converter execute in another thread.
class MarkdownWorker {
  constructor() {
    this.worker = new Worker(`
      const { parentPort } = require('node:worker_threads');
      global.self = { postMessage: data => parentPort.postMessage(data) };
      require('jiti').createJiti(${JSON.stringify(import.meta.url)}).import(${JSON.stringify(resolve('src/plugins/text-tools/line/markdownPlain.worker.ts'))}).then(() => {
        parentPort.on('message', data => self.onmessage({ data }));
      });
    `, { eval: true })
    this.worker.on('message', data => this.onmessage?.({ data }))
    this.worker.on('error', () => this.onerror?.({ preventDefault() {} }))
  }
  postMessage(data) { this.worker.postMessage(data) }
  terminate() { void this.worker.terminate() }
}
function load(path, dependencies) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const exports = {}
  new Function('require', 'exports', code)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name)
    return dependencies[name]
  }, exports)
  return exports
}
const root = 'src/plugins/text-tools/'
const markdown = load(root + 'line/markdownPlainExecution.ts', {
  './markdownPlain.worker?worker&inline': MarkdownWorker,
  './markdownPlainText': await jiti.import(resolve(root + 'line/markdownPlainText.ts')),
})
const dependencies = { './json/jsonCore': jsonCore, './line/markdownPlainExecution': markdown }
for (const name of ['line/cleanInvisibleCharacters', 'line/cleanAgentText', 'line/core', 'json/jsonTypeInference']) {
  dependencies['./' + name] = await jiti.import(resolve(root + name + '.ts'))
}
const { additionalTools } = load(root + 'additionalTools.ts', dependencies)
const { pathTools } = await jiti.import(resolve(root + 'paths/tools.ts'))
const tools = [...additionalTools, ...pathTools]
const samples = [
  ['line-tools.clean-invisible-characters', 'a\u00a0b\u200b', {}, 'a b'],
  ['line-tools.markdown-plain-text', '# Hello\n\n**world**', {}, 'Hello\n\nworld'],
  ['line-tools.clean-agent-text', '┌───────┐\n│ hello │\n└───────┘', {}, 'hello'],
  ['line-tools.find-duplicates', 'a\nb\na', {}, '"a" ×2 [1, 3]'],
  ['json.typescript', '{"a":1}', {}, 'export type Root = {\n  "a": number;\n};\n'],
  ['json.expression', '{"a":"hello"}', { expression: '.a' }, 'hello'],
  ['paths.convert', '/tmp/a b.png', { format: 'uri' }, 'file:///tmp/a%20b.png'],
]
for (const [id, text, params, expected] of samples) {
  const result = await tools.find(tool => tool.id === id).run({
    input: { text }, params, t: key => key,
    output: { text: value => value, error: message => { throw new Error(message) } },
  })
  assert.equal(result, expected, id)
}
console.log('Seven new text tools execute their real algorithms, including the Markdown worker.')
