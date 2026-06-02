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

const store = read('src/store.ts')
const types = read('src/workspace/types.ts')
const workspaceStore = read('src/workspace/workspaceStore.ts')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const inputResolver = read('src/workspace/pluginInputResolver.ts')
const rendererHost = read('src/components/workspace/RendererHost.tsx')
const commandPalette = read('src/components/CommandPalette.tsx')
const paneEditor = read('src/components/workspace/PaneEditor.tsx')
const dualEditor = read('src/kits/ui/DualEditorView.tsx')
const textDiff = read('src/plugins/textDiff/TextDiffRenderer.tsx')
const jsonDiff = read('src/plugins/jsonDiff/JsonDiffRenderer.tsx')
const corePlugin = read('src/workspace/corePlugin.ts')

assert(!/settings:\s*\{[\s\S]*stickyScroll:\s*boolean/.test(store), 'App settings should not expose global stickyScroll')
assert(/stickyScroll\?:\s*boolean/.test(types), 'EditorPane should expose per-pane stickyScroll')
assert(/stickyScroll:\s*false/.test(workspaceStore), 'New panes should default stickyScroll to off')
assert(/stickyScroll:\s*pane\.stickyScroll/.test(workspaceStore), 'Workspace persistence should keep per-pane stickyScroll')
assert(/stickyScroll\?:\s*boolean/.test(pluginTypes), 'PaneInput should carry per-pane stickyScroll')
assert(/stickyScroll:\s*activePane\.stickyScroll\s*===\s*true/.test(inputResolver), 'Active pane inputs should include stickyScroll')
assert(/stickyScroll:\s*pane\.stickyScroll\s*===\s*true/.test(rendererHost), 'RendererHost should resolve stickyScroll from current pane state')
assert(/stickyScroll:\s*pane\?\.stickyScroll\s*===\s*true/.test(commandPalette), 'Prompted pane inputs should include stickyScroll')
assert(/stickyScroll:\s*\{\s*enabled:\s*pane\.stickyScroll\s*===\s*true\s*\}/s.test(paneEditor), 'PaneEditor should pass pane stickyScroll to Monaco')
assert(/leftStickyScrollEnabled:\s*boolean/.test(dualEditor), 'DualEditorView should accept left stickyScroll flag')
assert(/rightStickyScrollEnabled:\s*boolean/.test(dualEditor), 'DualEditorView should accept right stickyScroll flag')
assert(/stickyScroll:\s*\{\s*enabled:\s*leftStickyScrollEnabled\s*\}/s.test(dualEditor), 'DualEditorView should pass left stickyScroll to Monaco')
assert(/stickyScroll:\s*\{\s*enabled:\s*rightStickyScrollEnabled\s*\}/s.test(dualEditor), 'DualEditorView should pass right stickyScroll to Monaco')
assert(/leftStickyScrollEnabled=\{originalPane\.stickyScroll\s*===\s*true\}/.test(textDiff), 'TextDiffRenderer should pass original pane stickyScroll')
assert(/rightStickyScrollEnabled=\{modifiedPane\.stickyScroll\s*===\s*true\}/.test(textDiff), 'TextDiffRenderer should pass modified pane stickyScroll')
assert(/leftStickyScrollEnabled=\{originalPane\.stickyScroll\s*===\s*true\}/.test(jsonDiff), 'JsonDiffRenderer should pass original pane stickyScroll')
assert(/rightStickyScrollEnabled=\{modifiedPane\.stickyScroll\s*===\s*true\}/.test(jsonDiff), 'JsonDiffRenderer should pass modified pane stickyScroll')
assert(/id:\s*'core\.toggle-sticky-scroll'/.test(corePlugin), 'Core plugin should register a command-palette toggle command')
assert(/patch:\s*\{\s*stickyScroll:\s*!stickyScrollEnabled\s*\}/s.test(corePlugin), 'Toggle command should update only the target pane')

console.log('sticky scroll toggle checks passed')
