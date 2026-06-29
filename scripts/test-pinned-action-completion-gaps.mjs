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
  globalPinnedLauncher: read('src/hotkeys/globalPinnedLauncher.ts'),
  launcherMixedList: read('src/components/launcher/LauncherMixedList.tsx'),
  i18n: readI18n(),
}

assertHas(files.packageJson, /test:pinned-action-completion-gaps/, 'package.json should expose this completion-gap verifier')

assertHas(files.store, /\bglobalLauncherOpen\s*:\s*boolean/, 'store should track global launcher separately from the command palette')
assertHas(files.store, /\bsetGlobalLauncherOpen\s*:/, 'store should expose a global launcher open setter')
assertHas(files.store, /globalPinnedLauncherShortcut:\s*\{\s*kind:\s*['"]accelerator['"],\s*accelerator:\s*['"]Shift\+Cmd\+Space['"]\s*\}/, 'store should keep the Shift-modified default global launcher shortcut')
assertHas(files.globalPinnedLauncher, /settings\.globalPinnedLauncherShortcut/, 'global launcher hotkeys should read the configured launcher shortcut from the store')
assertHas(files.globalPinnedLauncher, /routeGlobalPinnedLauncherShortcut[\s\S]*showLauncherWindow\(\)/, 'global launcher shortcut should open the standalone launcher window')
assertHas(files.app, /<GlobalLauncher\s*\/>/, 'App should render a GlobalLauncher at the app root')
assertNotHas(files.store, /if\s*\(\s*open\s*&&\s*state\.activeView\s*!==\s*['"]editor['"]\s*\)\s*return\s*\{\s*\}/, 'command palette/global launcher open state should not share an editor-only guard')

const globalLauncherPath = 'src/launcher/hosts/GlobalLauncherHost.tsx'
const globalLauncherFramesPath = 'src/components/launcher/GlobalLauncherFrames.tsx'
assert.ok(fs.existsSync(globalLauncherPath), 'GlobalLauncher host should exist')
assert.ok(fs.existsSync(globalLauncherFramesPath), 'GlobalLauncher frames should exist')
const globalLauncher = `${read(globalLauncherPath)}\n${read(globalLauncherFramesPath)}\n${read('src/components/launcher/GlobalLauncherSearchFrame.tsx')}\n${read('src/components/launcher/GlobalLauncherItems.ts')}`
assertHas(files.i18n, /globalPinned/, 'i18n should define a localized GlobalLauncher pinned section label')
assertHas(globalLauncher, /t\(locale,\s*['"]palette\.globalPinned['"]\)/, 'GlobalLauncher should localize the pinned section label')
assertNotHas(globalLauncher, /t\(locale,\s*['"]palette\.globalViews['"]\)/, 'GlobalLauncher should not keep the retired workspace views section')
assertHas(globalLauncher, /searchPlaceholder=\{t\(locale,\s*['"]palette\.globalPlaceholder['"]\)\}/, 'GlobalLauncher host should pass a localized placeholder into the frame switch')
assertHas(globalLauncher, /placeholder=\{(?:placeholder|resolvedPlaceholder)\}/, 'GlobalLauncher search frame should render the provided placeholder')
assertHas(files.launcherMixedList, /\|\s*\{\s*kind:\s*['"]pinned['"]/, 'GlobalLauncher list should model pinned items explicitly')
assertHas(files.launcherMixedList, /resolveIcon\(item\.icon,\s*16,\s*item\.title\)/, 'GlobalLauncher pinned items should resolve icon names instead of rendering raw icon strings')
assertHas(globalLauncher, /openPinnedAction|activatePinnedAction/, 'GlobalLauncher should jump to pinned action runners')
assertNotHas(globalLauncher, /setActiveView/, 'GlobalLauncher must not switch retired workspace views')
assertNotHas(files.store, /export\s+type\s+ViewId\b|\bactiveView\b|\bsetActiveView\b/, 'store must not keep the retired main-window navigation model')
assertHas(files.i18n, /pinned\.controlsTitle/, 'i18n should define a localized custom controls panel title')

console.log('pinned action completion-gap checks passed')
