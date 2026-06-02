import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const commandPalette = read('src/components/CommandPalette.tsx')
const store = read('src/store.ts')
const hardcodedBuiltins = read('src/actions/builtins.ts')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const i18n = read('src/i18n.ts')
const manifest = JSON.parse(read('src/builtin-scripts/manifest.json'))

assert(/optionalParams\?:\s*boolean/.test(store), 'ActionDef should expose optionalParams')
assert(/optionalParams\?:\s*boolean/.test(pluginTypes), 'CommandContribution should expose optionalParams')
assert(/palette\.customizeParamsLabel/.test(i18n), 'i18n should include the compact customize params label')
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
assert(manifest.version >= 8, 'builtin script manifest should bump so Tauri refreshes local builtin scripts')

const selectedScripts = [
  'dedup',
  'hash',
  'json',
  'wrap',
  'mdquote',
  'sort',
  'sql',
  'sqlin',
]

for (const name of selectedScripts) {
  const source = read(`src/builtin-scripts/${name}.ts`)
  assert(/optionalParams:\s*true/.test(source), `${name} should opt into default-run optional params`)
  assert(/default:/.test(source), `${name} should provide explicit parameter defaults`)

  const hardcodedEntry = new RegExp(`name:\\s*'${name}'[\\s\\S]*?params:\\s*\\[`)
  assert(hardcodedEntry.test(hardcodedBuiltins), `${name} should exist in hardcoded builtin actions`)
  const hardcodedSegment = hardcodedBuiltins.slice(hardcodedBuiltins.search(new RegExp(`name:\\s*'${name}'`)))
  const nextEntryIndex = hardcodedSegment.slice(1).search(/\n\s*\{\s*\n\s*name:\s*'/)
  const entryText = nextEntryIndex >= 0 ? hardcodedSegment.slice(0, nextEntryIndex + 1) : hardcodedSegment
  assert(/optionalParams:\s*true/.test(entryText), `${name} hardcoded action should opt into optional params`)
}

const notSelectedScripts = [
  'append',
  'base64',
  'case',
  'css',
  'csv',
  'extract',
  'html',
  'join',
  'prepend',
  'querystring',
  'slashes',
  'timestamp',
  'url',
  'xml',
  'yaml',
]

for (const name of notSelectedScripts) {
  const source = read(`src/builtin-scripts/${name}.ts`)
  assert(!/optionalParams:\s*true/.test(source), `${name} should not opt into optional params in this pass`)

  const start = hardcodedBuiltins.search(new RegExp(`name:\\s*'${name}'`))
  if (start >= 0) {
    const hardcodedSegment = hardcodedBuiltins.slice(start)
    const nextEntryIndex = hardcodedSegment.slice(1).search(/\n\s*\{\s*\n\s*name:\s*'/)
    const entryText = nextEntryIndex >= 0 ? hardcodedSegment.slice(0, nextEntryIndex + 1) : hardcodedSegment
    assert(!/optionalParams:\s*true/.test(entryText), `${name} hardcoded action should not opt into optional params in this pass`)
  }
}

console.log('command optional params checks passed')
