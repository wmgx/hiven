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
const scriptsView = read('src/views/ScriptsView.tsx')
const settingsView = read('src/views/SettingsView.tsx')
const jsFilterPlugin = read('src/plugins/jsFilter/index.tsx')
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

assert(
  /eventToGlobalPinnedLauncherShortcut/.test(settingsView),
  'SettingsView Enter handling is a shortcut recorder, not text-input confirmation',
)
assert(
  /monaco\.KeyCode\.Enter/.test(jsFilterPlugin),
  'jsFilter Enter handling is Monaco Ctrl/Cmd+Enter, not text-input confirmation',
)

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
