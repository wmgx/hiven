// Real launcherHost locale table for tests that stub the i18n module.
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../../src/i18n/locales/launcherHost.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const module = { exports: {} }
new Function('module', 'exports', js)(module, module.exports)
const messages = module.exports.default

export const translate = (locale, _namespace, key) => messages[locale]?.[key] ?? messages.en[key] ?? key
