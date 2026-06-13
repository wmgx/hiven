import fs from 'node:fs'
import assert from 'node:assert/strict'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

function assertNotHas(source, pattern, message) {
  assert.doesNotMatch(source, pattern, message)
}

function readI18n() {
  const dir = 'src/i18n/locales'
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(`${dir}/${f}`, 'utf8')).join('\n')
}

const files = {
  packageJson: read('package.json'),
  app: read('src/App.tsx'),
  store: read('src/store.ts'),
  commandPalette: read('src/components/CommandPalette.tsx'),
  pinnedRunner: read('src/views/PinnedRunnerView.tsx'),
  i18n: readI18n(),
}

assertHas(files.packageJson, /test:pinned-action-completion-gaps/, 'package.json should expose this completion-gap verifier')

assertHas(files.store, /\bglobalLauncherOpen\s*:\s*boolean/, 'store should track global launcher separately from the command palette')
assertHas(files.store, /\bsetGlobalLauncherOpen\s*:/, 'store should expose a global launcher open setter')
assertHas(files.app, /Shift/i, 'App should wire a Shift-modified global launcher shortcut')
assertHas(files.app, /openGlobalLauncher\(|setGlobalLauncherOpen\(true\)/, 'App should open global launcher from the global shortcut')
assertHas(files.app, /<GlobalLauncher\s*\/>/, 'App should render a GlobalLauncher at the app root')
assertNotHas(files.store, /if\s*\(\s*open\s*&&\s*state\.activeView\s*!==\s*['"]editor['"]\s*\)\s*return\s*\{\s*\}/, 'command palette/global launcher open state should not share an editor-only guard')

const globalLauncherPath = 'src/components/GlobalLauncher.tsx'
assert.ok(fs.existsSync(globalLauncherPath), 'GlobalLauncher component should exist')
const globalLauncher = read(globalLauncherPath)
assertHas(files.i18n, /globalPinned/, 'i18n should define a localized GlobalLauncher pinned section label')
assertHas(files.i18n, /globalRecent/, 'i18n should define a localized GlobalLauncher recent section label')
assertHas(files.i18n, /globalViews/, 'i18n should define a localized GlobalLauncher workspace views section label')
assertHas(globalLauncher, /t\(locale,\s*['"]palette\.globalPinned['"]\)/, 'GlobalLauncher should localize the pinned section label')
assertHas(globalLauncher, /t\(locale,\s*['"]palette\.globalRecent['"]\)/, 'GlobalLauncher should localize the recent section label')
assertHas(globalLauncher, /t\(locale,\s*['"]palette\.globalViews['"]\)/, 'GlobalLauncher should localize the workspace views section label')
assertHas(globalLauncher, /placeholder=\{t\(locale,\s*['"]palette\.globalPlaceholder['"]\)\}/, 'GlobalLauncher placeholder should be localized')
assertHas(globalLauncher, /item\.kind\s*===\s*['"]pinned['"][\s\S]*resolveIcon\(item\.icon,\s*14,\s*item\.title\)/, 'GlobalLauncher pinned items should resolve icon names instead of rendering raw icon strings')
assertHas(globalLauncher, /openPinnedAction|activatePinnedAction/, 'GlobalLauncher should jump to pinned action runners')
assertHas(globalLauncher, /setActiveView/, 'GlobalLauncher should switch workspace views')

assertHas(files.pinnedRunner, /function\s+PinnedActionControls|const\s+PinnedActionControls/, 'PinnedRunnerView should render real controls instead of a placeholder')
assertNotHas(files.pinnedRunner, /Controls panel placeholder/, 'PinnedRunnerView controls must not be a placeholder')
assertHas(files.pinnedRunner, /updatePinnedAction\([^)]*\{\s*params:/s, 'PinnedRunner controls should update PinnedAction.params')
assertHas(files.pinnedRunner, /param\.type\s*===\s*['"]single-select['"]|case\s+['"]single-select['"]/, 'PinnedRunner controls should support select params')
assertHas(files.pinnedRunner, /param\.type\s*===\s*['"]boolean['"]|case\s+['"]boolean['"]/, 'PinnedRunner controls should support boolean params')

console.log('pinned action completion-gap checks passed')
