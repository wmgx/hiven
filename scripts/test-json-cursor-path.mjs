import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
const dir = await mkdtemp(join(tmpdir(), 'hiven-json-path-'))
try {
  const source = await readFile(new URL('../src/plugins/json-tools/cursorPath.ts', import.meta.url), 'utf8')
  const path = join(dir, 'path.mjs')
  await writeFile(path, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  const { jsonCursorPath: locate, formatJsonCursorPath: format } = await import(pathToFileURL(path))
  const input = '{"users":[{"display.name":"Ada","a/b~c":42,"":false}],"emoji😀":"quoted \\\" string"}'
  for (const token of ['display.name', 'Ada']) assert.deepEqual(locate(input, input.indexOf(token)).value, { jsonPath: '$["users"][0]["display.name"]', pointer: '/users/0/display.name' })
  assert.deepEqual(locate(input, input.indexOf('42')).value, { jsonPath: '$["users"][0]["a/b~c"]', pointer: '/users/0/a~1b~0c' })
  assert.deepEqual(locate(input, input.indexOf('false')).value, { jsonPath: '$["users"][0][""]', pointer: '/users/0/' })
  assert.deepEqual(locate(input, 0).value, { jsonPath: '$', pointer: '' })
  assert.deepEqual(locate('[null,true,1e3,-2.5]', 15).value, { jsonPath: '$[3]', pointer: '/3' })
  assert.equal(locate(input, input.indexOf(':')).reason, 'position')
  assert.equal(locate('{ "x" : 1 }', 1).reason, 'position')
  assert.equal(locate(input, input.length).reason, 'position')
  assert.equal(locate('{"a":1,"a":2}', 2).reason, 'duplicate')
  assert.equal(locate('{"a":1,"\\u0061":2}', 2).reason, 'duplicate')
  assert.equal(locate('{"a":{"x":1},"b":{"x":2}}', 7).ok, true)
  assert.equal(locate('{"a":1,}', 2).reason, 'invalid')
  assert.equal(locate(' {"x":NaN}', 3).reason, 'invalid')
  assert.equal(locate('['.repeat(130) + '0' + ']'.repeat(130), 130).reason, 'limit')
  assert.equal(locate(' '.repeat(1000001), 0).reason, 'limit')
  assert.deepEqual(format(['a"b\\c\n', '0', 0, '/~']), { jsonPath: '$["a\\"b\\\\c\\n"]["0"][0]["/~"]', pointer: '/a"b\\c\n/0/0/~1~0' })
  const json = '{"\\ud83d\\ude00":"text","__proto__":{"constructor":true}}'
  assert.equal(locate(json, json.indexOf('text')).value.pointer, '/😀')
  assert.equal(locate(json, json.indexOf('true')).value.pointer, '/__proto__/constructor')
  console.log('JSON cursor token paths, escapes, duplicate keys and limits passed.')
} finally { await rm(dir, { recursive: true, force: true }) }
