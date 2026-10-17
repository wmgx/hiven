// Stand-in for src/launcher/clipboard/objectBlockText.ts using the real zh locale table (no store or i18n registry).
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/i18n/locales/objectBlock.ts', import.meta.url), 'utf8')
const module = { exports: {} }
new Function('module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module, module.exports)
const table = module.exports.default.zh

export function objectBlockText(key, vars = {}) {
  let value = table[key] ?? key
  for (const [name, replacement] of Object.entries(vars)) value = value.replaceAll(`{${name}}`, String(replacement))
  return value
}
export const objectBlockTextModule = { objectBlockText }
