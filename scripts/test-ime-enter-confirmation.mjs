import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readOptional(path) {
  try {
    return readFileSync(join(root, path), 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return ''
    throw error
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const commandPalette = readOptional('src/components/CommandPalette.tsx') + '\n' + readOptional('src/launcher/hosts/EditorCommandBarHost.tsx')
const globalLauncher = readOptional('src/components/GlobalLauncher.tsx') + '\n' + read('src/launcher/hosts/GlobalLauncherHost.tsx') + '\n' + read('src/components/launcher/GlobalLauncherKeyboard.ts') + '\n' + read('src/components/launcher/GlobalLauncherPanel.tsx')
const launcherParamStep = read('src/components/launcher/LauncherParamStep.tsx')
const scriptsView = readOptional('src/surfaces/PluginsManagerSurfaceContent.tsx') + '\n' + readOptional('src/surfaces/PluginsContent.tsx')
const settingsView = readOptional('src/surfaces/SettingsSurfaceContent.tsx') + '\n' + readOptional('src/surfaces/SettingsContent.tsx')
const jsFilterPlugin = readOptional('src/plugins/jsFilter/index.tsx') + '\n' + readOptional('src/plugins/jsFilter/JsFilterPanel.tsx')
const pluginUi = read('src/plugin-ui.tsx')
const clipboardHistorySurface = readOptional('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
const imeKeyboard = read('src/utils/imeKeyboard.ts')
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(imeKeyboard, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText).toString('base64')}`
)

assert(/shouldIgnoreImeKeyDown/.test(imeKeyboard), 'IME keyboard helper should expose a keydown guard')
assert(
  /composingRef\.current/.test(imeKeyboard),
  'IME keydown guard should consider tracked composition state, not only nativeEvent.isComposing',
)
assert(/keyCode\s*={2,3}\s*229/.test(imeKeyboard), 'IME keydown guard should preserve keyCode 229 fallback')
assert(
  /schedule\(\(\)\s*=>\s*\{\s*composingRef\.current\s*=\s*false\s*\}\)/s.test(imeKeyboard),
  'IME composition end should clear tracked state asynchronously so Enter-confirm keydown is ignored',
)
assert(
  /IME_COMMIT_ENTER_GUARD_MS|lastCompositionEndedAt/.test(imeKeyboard),
  'IME guard must suppress Enter shortly after compositionend (上屏 Enter)',
)
assert(
  /isComposing\s*===\s*true/.test(imeKeyboard),
  'IME guard must honor React synthetic event.isComposing',
)

const globalLauncherLifecycle = read('src/components/launcher/GlobalLauncherHostLifecycle.ts')
assert(
  /compositionstart/.test(globalLauncherLifecycle) && /compositionend/.test(globalLauncherLifecycle),
  'GlobalLauncher lifecycle must capture document compositionstart/end for 上屏 Enter',
)

function assertImeGuardedEnter(source, label) {
  assert(/useRef\(false\)/.test(source) && /isImeComposingRef/.test(source), `${label} should track IME composition state`)
  assert(
    /onCompositionStart=\{handleCompositionStart\}/.test(source) &&
      /onCompositionEnd=\{handleCompositionEnd\}/.test(source),
    `${label} should receive composition start/end events from its input surface`,
  )
  assert(
    /shouldIgnoreImeKeyDown\(.*isImeComposingRef\)/s.test(source),
    `${label} should use the IME-aware guard before Enter confirmation`,
  )
}

if (commandPalette.trim()) assertImeGuardedEnter(commandPalette, 'CommandPalette')
assertImeGuardedEnter(globalLauncher, 'GlobalLauncher')
if (scriptsView.trim()) assertImeGuardedEnter(scriptsView, 'ScriptsView remote import')

function assertLauncherParamStepUsesImeGuardedBackspace() {
  const failures = []
  const expect = (condition, message) => {
    if (!condition) failures.push(message)
  }

  expect(
    /useRef\(false\)/.test(launcherParamStep) && /isImeComposingRef/.test(launcherParamStep),
    'LauncherParamStep should track IME composition state for the parameter input',
  )
  expect(
    /onCompositionStart=\{handleCompositionStart\}/.test(launcherParamStep) &&
      /onCompositionEnd=\{handleCompositionEnd\}/.test(launcherParamStep),
    'LauncherParamStep input should receive composition start/end handlers',
  )

  const backspaceBranch = launcherParamStep.match(/if\s*\(\s*event\.key\s*={2,3}\s*['"]Backspace['"]\s*&&\s*frame\.query\s*={2,3}\s*['"]['"]\s*\)\s*\{([\s\S]*?)\n\s*\}/)
  const backspaceBody = backspaceBranch?.[1] ?? ''
  const imeGuardIndex = backspaceBody.search(/shouldIgnoreImeKeyDown\(.*isImeComposingRef\)/s)
  const preventDefaultIndex = backspaceBody.indexOf('preventDefault')
  const onBackIndex = backspaceBody.indexOf('onBack')

  expect(
    backspaceBranch !== null && imeGuardIndex >= 0,
    'LauncherParamStep Backspace return branch should call shouldIgnoreImeKeyDown',
  )
  expect(
    imeGuardIndex >= 0 &&
      preventDefaultIndex >= 0 &&
      onBackIndex >= 0 &&
      imeGuardIndex < preventDefaultIndex &&
      imeGuardIndex < onBackIndex,
    'LauncherParamStep Backspace return branch should check shouldIgnoreImeKeyDown before preventDefault() and onBack()',
  )

  assert(
    failures.length === 0,
    `LauncherParamStep IME Backspace contract is missing:\n- ${failures.join('\n- ')}`,
  )
}

assertLauncherParamStepUsesImeGuardedBackspace()

if (settingsView.trim()) {
  assert(
    /<ShortcutRecorder\b/.test(settingsView) &&
      /onRecord=\{[\s\S]{0,160}globalPinnedLauncherShortcut/.test(settingsView) &&
      /globalPinnedLauncherShortcut/.test(settingsView),
    'SettingsView Enter handling is a shortcut recorder, not text-input confirmation',
  )
}
if (jsFilterPlugin.trim()) {
  assert(
    /monaco\.KeyCode\.Enter/.test(jsFilterPlugin),
    'jsFilter Enter handling is Monaco Ctrl/Cmd+Enter, not text-input confirmation',
  )
}

// Run actual extracted production handlers instead of the obsolete Enter-branch regex.
await import('./test-ime-input-handlers.mjs')

const {
  finishImeComposition,
  shouldIgnoreImeKeyDown,
  startImeComposition,
  resetImeCompositionGuardForTests,
} = helperModule

if (typeof resetImeCompositionGuardForTests === 'function') {
  resetImeCompositionGuardForTests()
}

const composingRef = { current: false }
for (const key of ['Enter', 'Tab', 'Backspace']) {
  assert(
    shouldIgnoreImeKeyDown({ key, keyCode: 0, nativeEvent: { keyCode: 229 } }, { current: false }) === true,
    `${key}: synthetic keyCode=0 must not mask native IME keyCode=229`,
  )
  assert(
    shouldIgnoreImeKeyDown({ key, keyCode: 229, nativeEvent: { keyCode: 0 } }, { current: false }) === true,
    `${key}: synthetic IME keyCode=229 must also be honored`,
  )
}
assert(
  shouldIgnoreImeKeyDown({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } }, composingRef) === false,
  'plain Enter outside IME composition should still submit/select',
)
startImeComposition(composingRef)
assert(
  shouldIgnoreImeKeyDown({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } }, composingRef) === true,
  'Enter during tracked IME composition should be ignored even when native keydown flags look like plain Enter',
)
let scheduledCallback = null
finishImeComposition(composingRef, (callback) => { scheduledCallback = callback })
assert(composingRef.current === true, 'composition end should not clear tracked state synchronously')
assert(typeof scheduledCallback === 'function', 'composition end should schedule the tracked-state cleanup')
// 上屏 Enter often arrives after compositionend with isComposing=false — must still ignore
assert(
  shouldIgnoreImeKeyDown({ key: 'Enter', keyCode: 13, isComposing: false }, composingRef) === true,
  'Enter immediately after compositionend must be ignored (上屏 must not confirm)',
)
scheduledCallback()
assert(composingRef.current === false, 'scheduled composition cleanup should clear tracked state')
assert(
  shouldIgnoreImeKeyDown({ key: 'Enter', keyCode: 13 }, composingRef) === true,
  'Enter within post-composition guard window must still be ignored',
)
assert(
  shouldIgnoreImeKeyDown({ key: 'a', keyCode: 65 }, composingRef) === false,
  'non-Enter keys after composition end should not be blocked by Enter-only guard',
)
assert(
  shouldIgnoreImeKeyDown({ key: 'Enter', isComposing: true }, { current: false }) === true,
  'React event.isComposing must be honored',
)

// Escape must never be trapped by a stuck composition flag (collect-input exit).
startImeComposition(composingRef)
assert(composingRef.current === true, 'composition flag should be set')
assert(
  shouldIgnoreImeKeyDown({ key: 'Escape', keyCode: 27 }, composingRef) === false,
  'Escape must not be ignored during tracked IME composition (exit must stay available)',
)
assert(
  shouldIgnoreImeKeyDown({ key: 'Escape', isComposing: true }, { current: true }) === false,
  'Escape must not be ignored when isComposing=true',
)

// Host Escape chain must clear stuck IME and consult interceptors (not early-return on settings).
assert(
  /isImeComposingRef\.current\s*=\s*false/.test(globalLauncherLifecycle),
  'Host Escape must clear stuck IME composing flag',
)
assert(
  /runLauncherEscapeInterceptor/.test(globalLauncherLifecycle),
  'Host Escape must consult layer interceptors',
)
assert(
  !/if\s*\(\s*usePluginSettingsStore\.getState\(\)\.settingsDialogTarget\s*\)\s*return/.test(globalLauncherLifecycle),
  'Host Escape must not early-return on any settingsDialogTarget (that swallowed Esc)',
)

console.log('IME enter confirmation checks passed')
