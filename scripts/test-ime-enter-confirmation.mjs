import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

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
const globalLauncher = read('src/components/GlobalLauncher.tsx')
const launcherParamStep = read('src/components/launcher/LauncherParamStep.tsx')
const scriptsView = read('src/views/ScriptsView.tsx')
const settingsView = read('src/views/SettingsView.tsx')
const jsFilterPlugin = read('src/plugins/jsFilter/index.tsx')
const pluginUi = read('src/plugin-ui.tsx')
const clipboardHistorySurface = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
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

assertImeGuardedEnter(commandPalette, 'CommandPalette')
assertImeGuardedEnter(globalLauncher, 'GlobalLauncher')
assertImeGuardedEnter(scriptsView, 'ScriptsView remote import')

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

assert(
  /<ShortcutRecorder\b/.test(settingsView) &&
    /onRecord=\{[\s\S]{0,160}globalPinnedLauncherShortcut/.test(settingsView) &&
    /globalPinnedLauncherShortcut/.test(settingsView),
  'SettingsView Enter handling is a shortcut recorder, not text-input confirmation',
)
assert(
  /monaco\.KeyCode\.Enter/.test(jsFilterPlugin),
  'jsFilter Enter handling is Monaco Ctrl/Cmd+Enter, not text-input confirmation',
)

function assertClipboardHistoryUsesReusableImeInputContract() {
  const failures = []
  const expect = (condition, message) => {
    if (!condition) failures.push(message)
  }

  const pluginUiExposesImeInputContract =
    /export\s+(?:const|function)\s+(?:useIme|useImeKeyboard|useImeSafeKeyDown|useImeAwareInput|createImeInputProps)\b/.test(pluginUi) ||
    /export\s+\{\s*(?:[^}]*,\s*)?shouldIgnoreImeKeyDown(?:\s*,[^}]*)?\s*\}/s.test(pluginUi) ||
    /type\s+(?:SearchField|TextInput|TextArea)[A-Za-z]*Props[\s\S]*onImeKeyDown/.test(pluginUi)
  expect(
    pluginUiExposesImeInputContract,
    'plugin-ui should expose a reusable IME-aware input contract such as a hook, props helper, or exported shouldIgnoreImeKeyDown guard; clipboard-history should not need a private one-off patch',
  )

  expect(
    /isImeComposingRef/.test(clipboardHistorySurface) ||
      /useIme(?:Keyboard|SafeKeyDown|AwareInput)\s*\(/.test(clipboardHistorySurface),
    'ClipboardHistorySurface should track IME composition state for the search input before treating Enter as paste confirmation',
  )
  expect(
    /onCompositionStart=\{[^}]*\}/.test(clipboardHistorySurface) &&
      /onCompositionEnd=\{[^}]*\}/.test(clipboardHistorySurface),
    'ClipboardHistorySurface SearchField should receive composition start/end handlers from the reusable IME input contract',
  )
  const enterBranch = clipboardHistorySurface.match(/if\s*\(\s*e\.key\s*={2,3}\s*['"]Enter['"]\s*\)\s*\{([\s\S]*?)\n\s*\}\s*else if/)
  const enterBody = enterBranch?.[1] ?? ''
  const imeGuardIndex = Math.max(
    enterBody.search(/shouldIgnoreImeKeyDown\(.*(?:isImeComposingRef|ime[A-Za-z]*Ref|ime[A-Za-z]*Input)/s),
    enterBody.search(/ime[A-Za-z]*(?:Props|Guard|KeyDown)\.shouldIgnoreKeyDown\(e\)/s),
  )
  const preventDefaultIndex = enterBody.indexOf('preventDefault')
  const pasteIndex = enterBody.indexOf('handlePaste')
  expect(
    enterBranch !== null && imeGuardIndex >= 0,
    'ClipboardHistorySurface Enter paste branch should call an IME guard',
  )
  expect(
    imeGuardIndex >= 0 &&
      preventDefaultIndex >= 0 &&
      pasteIndex >= 0 &&
      imeGuardIndex < preventDefaultIndex &&
      imeGuardIndex < pasteIndex,
    'ClipboardHistorySurface Enter paste handling should check the IME guard before preventDefault() and handlePaste()',
  )

  assert(
    failures.length === 0,
    `Clipboard history IME Enter confirmation contract is missing:\n- ${failures.join('\n- ')}`,
  )
}

assertClipboardHistoryUsesReusableImeInputContract()

const {
  finishImeComposition,
  shouldIgnoreImeKeyDown,
  startImeComposition,
} = helperModule
const composingRef = { current: false }
assert(
  shouldIgnoreImeKeyDown({ keyCode: 13, nativeEvent: { isComposing: false } }, composingRef) === false,
  'plain Enter outside IME composition should still submit/select',
)
startImeComposition(composingRef)
assert(
  shouldIgnoreImeKeyDown({ keyCode: 13, nativeEvent: { isComposing: false } }, composingRef) === true,
  'Enter during tracked IME composition should be ignored even when native keydown flags look like plain Enter',
)
let scheduledCallback = null
finishImeComposition(composingRef, (callback) => { scheduledCallback = callback })
assert(composingRef.current === true, 'composition end should not clear tracked state synchronously')
assert(typeof scheduledCallback === 'function', 'composition end should schedule the tracked-state cleanup')
scheduledCallback()
assert(composingRef.current === false, 'scheduled composition cleanup should clear tracked state')

console.log('IME enter confirmation checks passed')
