import assert from 'node:assert/strict'
import ts from 'typescript'
import { createJiti } from 'jiti'
const { inferJsonType: infer, JsonTypeInferenceError } = await createJiti(import.meta.url).import('../src/plugins/json-tools/jsonTypeInference.ts')
const bad = (input, code) => assert.throws(() => infer(input), error => error instanceof JsonTypeInferenceError && error.code === code)
assert.equal(infer('1e9999'), 'export type Root = number;\n')
assert.equal(infer('9007199254740993'), 'export type Root = number;\n')
assert.equal(infer('null'), 'export type Root = null;\n')
assert.equal(infer('[]'), 'export type Root = unknown[];\n')
assert.equal(infer('{}'), 'export type Root = Record<string, never>;\n')
assert.equal(infer('[1,"x",null,false,2]'), 'export type Root = Array<number | string | null | boolean>;\n')
assert.equal(infer('[{"a":1},{"b":"x"}]'), 'export type Root = Array<{\n    "a"?: number;\n    "b"?: string;\n  }>;\n')
const nested = '[{"user":{"id":"001","tags":[]}},{"user":{"id":"002","tags":[true],"name":null}}]'
const nestedType = infer(nested)
assert.match(nestedType, /"name"\?: null/)
assert.match(nestedType, /"tags": Array<boolean>/)
assert.match(nestedType, /"id": string/)
bad('{"a":1,"\\u0061":2}', 'typeDuplicateKey')
bad('{"x":{"a":1,"a":2}}', 'typeDuplicateKey')
for (const input of ['', '01', '[1,]', '{"a":1,}', 'NaN', 'Infinity', 'true false', '"\\x00"', '"\n"', '{a:1}', '1.', '1e', '\ufeff{}']) bad(input, 'typeInvalidJson')
bad('['.repeat(66) + '0' + ']'.repeat(66), 'typeLimit')
bad('"' + '中'.repeat(45000) + '"', 'typeLimit')
bad('[' + '0,'.repeat(20000) + '0]', 'typeLimit')
// Depth-driven indentation expansion crosses output bounds without truncation.
let huge = Object.fromEntries(Array.from({length: 5500}, (_, i) => [`k${i}`, 0]))
for (let i = 0; i < 50; i++) huge = { a: huge }
bad(JSON.stringify(huge), 'typeLimit')
const samples = [nested, '[{}, {"id":1}]', '[[],[1,"x"]]', '{"a-b":1,"default":true,"quote\\\"key":null,"__proto__":"safe","中文":"yes","line\\nkey":[]}', '[]', '{}', 'null', '1e9999', '"date-like-2026-10-14"']
const source = samples.map((sample, index) => {
  const type = infer(sample).replace('export type Root', `type Root${index}`)
  return type + `const sample${index}: Root${index} = ${sample};\n`
}).join('\n')
const filename = '/virtual-json-type-inference.ts'
const options = { strict: true, noEmit: true, target: ts.ScriptTarget.ES2022, skipLibCheck: true, types: [] }
const host = ts.createCompilerHost(options)
const read = host.readFile.bind(host), exists = host.fileExists.bind(host)
host.readFile = file => file === filename ? source : read(file)
host.fileExists = file => file === filename || exists(file)
const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([filename], options, host))
assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [])
console.log('JSON sample inference: unions, optional nested properties, exact keys, lexical numbers, limits, generated TypeScript and sample assignability passed.')
