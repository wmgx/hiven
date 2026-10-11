#!/usr/bin/env node
// Decode production CSV file bytes without browser, native APIs or user files.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'src/plugins/csv/csvFileInput.ts'
const exports = {}
const code = ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
vm.runInNewContext(code, { exports, module: { exports }, TextDecoder }, { filename: path })
const { decodeCsvFileBytes } = exports
const encoded = (text) => new TextEncoder().encode(text)
function accepts(bytes, expected, label) {
  const result = decodeCsvFileBytes(bytes.buffer)
  assert.equal(result.ok, true, label)
  assert.equal(result.text, expected, `${label}: preserve complete source text`)
}
function rejects(bytes, label) {
  const result = decodeCsvFileBytes(Uint8Array.from(bytes).buffer)
  assert.equal(result.ok, false, label)
  assert.equal('text' in result, false, `${label}: never return partially decoded text`)
}

accepts(encoded('name,value\r\none,1\r\n'), 'name,value\r\none,1\r\n', 'ASCII and CRLF')
accepts(encoded('姓名,城市\n测试😀,北京\n'), '姓名,城市\n测试😀,北京\n', 'Chinese and emoji')
accepts(encoded('\uFEFF姓名,城市\n测试,北京'), '姓名,城市\n测试,北京', 'UTF-8 BOM')
accepts(encoded('name,value\none,\uFFFD'), 'name,value\none,\uFFFD', 'valid encoded replacement character')
accepts(encoded('name,value\none,\uFEFF'), 'name,value\none,\uFEFF', 'retain non-leading BOM character')
accepts(encoded(''), '', 'empty file')
// GBK bytes for 姓名,城市\n测试,北京: valid legacy input must not become replacement text.
rejects([0xD0, 0xD5, 0xC3, 0xFB, 0x2C, 0xB3, 0xC7, 0xCA, 0xD0, 0x0A,
  0xB2, 0xE2, 0xCA, 0xD4, 0x2C, 0xB1, 0xB1, 0xBE, 0xA9], 'GBK source')
rejects([0x61, 0x2C, 0xE4, 0xB8], 'truncated three-byte sequence after valid prefix')
rejects([0x61, 0x2C, 0xF0, 0x9F, 0x98], 'truncated emoji')
rejects([0x80], 'lone continuation byte')
rejects([0xFF], 'invalid leading byte')
rejects([0xC0, 0xAF], 'overlong encoding')
rejects([0xED, 0xA0, 0x80], 'surrogate encoding')
rejects([0xF4, 0x90, 0x80, 0x80], 'code point beyond Unicode range')
rejects([0xEF, 0xBB, 0xBF, 0x61, 0xFF], 'BOM does not permit invalid trailing bytes')
console.log('CSV file strict UTF-8 decoding passed')
