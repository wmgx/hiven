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

const imeKeyboard = read('src/utils/imeKeyboard.ts')
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(ts.transpileModule(imeKeyboard, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText).toString('base64')}`
)

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

console.log('IME enter confirmation checks passed')
