import { readFileSync } from 'node:fs'

const source = readFileSync('src/workspace/pluginInputResolver.ts', 'utf8')

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

assert(
  /selectedText[\s\S]*paneId:\s*undefined/.test(source),
  'Plugin text input resolver should route selected text through active-input so commands replace only the selection',
)

assert(
  /paneId:\s*hasSelection\s*\?\s*undefined\s*:\s*activePaneId/.test(source),
  'Plugin text input resolver should keep whole-pane text bound to the active pane',
)

assert(
  /if \(!isEditorWindowRuntime\(\) && canReadEditorContextSnapshot\(\)\)[\s\S]*getActiveEditorContextSnapshot\(\)[\s\S]*resolveFromEditorContext/.test(source),
  'Plugin input resolver should use synced editor context outside the editor runtime',
)

assert(
  /resolveUseActiveFromEditorContext[\s\S]*selectedText[\s\S]*paneId:\s*selectedText \? undefined : editorContext\.activePaneId/.test(source),
  'Plugin input resolver should preserve selected-text replacement semantics from synced editor context',
)

assert(
  /resolveAutoFillFromEditorContext[\s\S]*paneSlots\.length === 1[\s\S]*paneInputFromEditorContext/.test(source),
  'Plugin input resolver should allow single-pane auto-fill from synced editor context',
)

assert(
  /Need editor pane snapshots for multiple pane inputs/.test(source),
  'Plugin input resolver should not guess multi-pane inputs from launcher-local shadow workspace state',
)

console.log('plugin selection input resolution checks passed')
