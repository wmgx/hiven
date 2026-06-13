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
const launcherParamStep = read('src/components/launcher/LauncherParamStep.tsx')
const launcherParamShortcuts = read('src/components/launcher/launcherParamShortcuts.ts')
const globalLauncher = read('src/components/GlobalLauncher.tsx')
const commandAdapter = read('src/workspace/launcher/commandAdapter.ts')
const store = read('src/store.ts')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const pluginScaffold = read('src/workspace/pluginScaffold.ts')
const i18n = readI18n()

assert(/@deprecated Launcher parameter customization is inferred/.test(pluginTypes), 'CommandContribution optionalParams should be deprecated compatibility metadata')
assert(/const exposesParams = \(command\.params\?\.length \?\? 0\) > 0/.test(commandAdapter), 'command adapter should infer parameter customization from declared params')
assert(!/command\.optionalParams \?/.test(commandAdapter), 'command adapter must not gate parameter customization on optionalParams')
assert(!/optionalParams:\s*true/.test(pluginScaffold), 'plugin scaffold should not teach deprecated optionalParams')
assert(/customizeParamsLabel/.test(i18n), 'i18n should include the compact customize params label')
assert(!/Hold Command to customize parameters|按住 Command 键自定义参数/.test(i18n), 'i18n should not use the old long customize hint')
assert(/getPlatformShortcutMeta/.test(launcherParamShortcuts), 'shared launcher shortcut helper should expose platform shortcut metadata')
assert(/isMacPlatform/.test(launcherParamShortcuts), 'shared launcher shortcut helper should detect macOS for Command shortcuts')
assert(/event\.metaKey/.test(commandPalette) && /event\.ctrlKey/.test(commandPalette), 'CommandPalette should pass click modifier state for macOS and other platforms')
assert(/shouldCustomizeParams/.test(launcherParamShortcuts), 'launcher should centralize customize modifier handling')
assert(/selectItem\(item,\s*shouldCustomizeParams\(e\.metaKey,\s*e\.ctrlKey\)\)/.test(commandPalette), 'CommandPalette should support platform-aware Enter selection intent')
assert(/return\s+shortcutMeta\.modifier === 'meta' \? metaKey : ctrlKey/.test(launcherParamShortcuts), 'launcher should customize based on the platform modifier at selection time')
assert(/supportsDefaultParamRun/.test(launcherParamShortcuts), 'launcher should gate default runs behind explicit default support')
assert(/hasExplicitDefaultParams/.test(launcherParamShortcuts), 'launcher should require explicit defaults for optional params')
assert(/customize-shortcut-chip/.test(commandPalette), 'CommandPalette should render optional params as a compact shortcut chip')
assert(/supportsParamCustomization\(items\[selectedIndex\]\)/.test(commandPalette), 'CommandPalette footer should show the parameter shortcut for the selected optional-param item')
assert(/LauncherParamStep/.test(commandPalette), 'CommandPalette should render the shared launcher parameter step')
assert(/LauncherParamStep/.test(globalLauncher), 'GlobalLauncher should render the shared launcher parameter step')
assert(/ParamInputFrame/.test(globalLauncher), 'GlobalLauncher should support param-input controller frames')
assert(/commitCurrentParam/.test(commandPalette) && /commitCurrentParam/.test(globalLauncher), 'launcher surfaces should commit one parameter at a time through the controller')
assert(/frame\.paramIndex/.test(launcherParamStep) && /frame\.query/.test(launcherParamStep) && /frame\.selectedIndex/.test(launcherParamStep), 'LauncherParamStep should consume launcher param frame state')
assert(!/\bCheck\b/.test(launcherParamStep), 'LauncherParamStep single-select options should not render checkbox-style check marks')
assert((launcherParamStep.match(/<input/g) ?? []).length === 1, 'LauncherParamStep should keep filtering/input in the single launcher input row')
assert(/event\.key === 'Escape'[\s\S]*onBack\(\)/.test(launcherParamStep), 'LauncherParamStep should support Escape back navigation')
assert(/event\.key === 'Backspace' && frame\.query === ''[\s\S]*onBack\(\)/.test(launcherParamStep), 'LauncherParamStep should support Backspace back navigation only when the launcher input is empty')
assert(!/<form/.test(commandPalette), 'CommandPalette must not render the old parameter form')
assert(!/<select/.test(commandPalette), 'CommandPalette must not render native select parameters')
assert(!/multiple/.test(commandPalette), 'CommandPalette must not render native multi-select parameters')

function pluginIndex(dir) {
  const p = join(root, 'src/plugins', dir, 'index.ts')
  return existsSync(p) ? readFileSync(p, 'utf8') : null
}

const parameterizedPlugins = [
  'base64',
  'calculator',
  'case',
  'css',
  'csv',
  'date-time-assistant',
  'extract',
  'hash',
  'html',
  'json',
  'lineAffix',
  'lineTools',
  'mdquote',
  'queryString',
  'slashes',
  'sql',
  'sqlin',
  'url',
  'xml',
  'yaml',
]

for (const name of parameterizedPlugins) {
  const src = pluginIndex(name)
  assert(src, `${name} should exist as a first-party plugin package`)
  assert(!/optionalParams:\s*true/.test(src), `${name} plugin should not use deprecated optionalParams`)
  assert(/params:\s*\[/.test(src), `${name} plugin should declare command params`)
  assert(/default:/.test(src), `${name} plugin params should provide explicit defaults for launcher parameter flow`)
}

console.log('command optional params checks passed')
