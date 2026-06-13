import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readI18n() {
  const dir = join(root, 'src/i18n/locales')
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const commandPalette = read('src/components/CommandPalette.tsx')
const store = read('src/store.ts')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const i18n = readI18n()

assert(/optionalParams\?:\s*boolean/.test(pluginTypes), 'CommandContribution should expose optionalParams')
assert(/customizeParamsLabel/.test(i18n), 'i18n should include the compact customize params label')
assert(!/Hold Command to customize parameters|按住 Command 键自定义参数/.test(i18n), 'i18n should not use the old long customize hint')
assert(/getPlatformShortcutMeta/.test(commandPalette), 'CommandPalette should expose platform shortcut metadata')
assert(/isMacPlatform/.test(commandPalette), 'CommandPalette should detect macOS for Command shortcuts')
assert(/event\.metaKey/.test(commandPalette) && /event\.ctrlKey/.test(commandPalette), 'CommandPalette should pass click modifier state for macOS and other platforms')
assert(/shouldCustomizeParams/.test(commandPalette), 'CommandPalette should centralize customize modifier handling')
assert(/selectItem\(item,\s*shouldCustomizeParams\(e\.metaKey,\s*e\.ctrlKey\)\)/.test(commandPalette), 'CommandPalette should support platform-aware Enter selection intent')
assert(/return\s+shortcutMeta\.modifier === 'meta' \? metaKey : ctrlKey/.test(commandPalette), 'CommandPalette should customize based on the platform modifier at selection time')
assert(/supportsDefaultParamRun/.test(commandPalette), 'CommandPalette should gate default runs behind explicit default support')
assert(/hasExplicitDefaultParams/.test(commandPalette), 'CommandPalette should require explicit defaults for optional params')
assert(/customize-shortcut-chip/.test(commandPalette), 'CommandPalette should render optional params as a compact shortcut chip')

function pluginIndex(dir) {
  const p = join(root, 'src/plugins', dir, 'index.ts')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

// optionalParams now lives in first-party plugin packages, not builtins.ts.
const selectedScripts = [
  'hash',
  'json',
  'sql',
]

for (const name of selectedScripts) {
  const src = pluginIndex(name)
  assert(src, `${name} should exist as a first-party plugin package`)
  assert(/optionalParams:\s*true/.test(src), `${name} plugin should opt into optional params`)
  assert(/default:/.test(src), `${name} plugin should provide explicit parameter defaults`)
}

const notSelectedScripts = [
  'base64',
  'timestamp',
  'url',
  'yaml',
]

for (const name of notSelectedScripts) {
  const src = pluginIndex(name)
  if (src) {
    assert(!/optionalParams:\s*true/.test(src), `${name} plugin should not opt into optional params in this pass`)
  }
}

console.log('command optional params checks passed')
