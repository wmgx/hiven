import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readOptional(path) {
  try {
    return read(path)
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

const store = read('src/store.ts')
const types = read('src/workspace/types.ts')
const workspaceStore = read('src/workspace/workspaceStore.ts')
const pluginTypes = read('src/workspace/pluginTypes.ts')
const inputResolver = read('src/workspace/pluginInputResolver.ts')
const rendererHost = read('src/components/workspace/RendererHost.tsx')
const launcherPluginApi = read('src/workspace/launcher/pluginApi.ts')
const paneEditor = read('src/components/workspace/PaneEditor.tsx')
const dualEditor = read('src/kits/ui/DualEditorView.tsx')
const textDiff = read('src/plugins/textDiff/TextDiffRenderer.tsx')
const corePlugin = readOptional('src/workspace/corePlugin.ts')
const hostActions = read('src/workspace/launcher/hostActions.ts')

assert(!/settings:\s*\{[\s\S]*stickyScroll:\s*boolean/.test(store), 'App settings should not expose global stickyScroll')
assert(/stickyScroll\?:\s*boolean/.test(types), 'EditorPane should expose per-pane stickyScroll')
assert(/stickyScroll:\s*false/.test(workspaceStore), 'New panes should default stickyScroll to off')
assert(/stickyScroll:\s*pane\.stickyScroll/.test(workspaceStore), 'Workspace persistence should keep per-pane stickyScroll')
assert(/stickyScroll\?:\s*boolean/.test(pluginTypes), 'PaneInput should carry per-pane stickyScroll')
assert(/stickyScroll:\s*activePane\.stickyScroll\s*===\s*true/.test(inputResolver), 'Active pane inputs should include stickyScroll')
assert(/stickyScroll:\s*pane\.stickyScroll\s*===\s*true/.test(rendererHost), 'RendererHost should resolve stickyScroll from current pane state')
assert(/stickyScroll:\s*state\.panes\[paneId\]\?\.stickyScroll\s*===\s*true/.test(launcherPluginApi), 'Launcher pane snapshots should include stickyScroll')
assert(/stickyScroll:\s*\{\s*enabled:\s*pane\.stickyScroll\s*===\s*true\s*\}/s.test(paneEditor), 'PaneEditor should pass pane stickyScroll to Monaco')
assert(/leftStickyScrollEnabled:\s*boolean/.test(dualEditor), 'DualEditorView should accept left stickyScroll flag')
assert(/rightStickyScrollEnabled:\s*boolean/.test(dualEditor), 'DualEditorView should accept right stickyScroll flag')
assert(/stickyScroll:\s*\{\s*enabled:\s*leftStickyScrollEnabled\s*\}/s.test(dualEditor), 'DualEditorView should pass left stickyScroll to Monaco')
assert(/stickyScroll:\s*\{\s*enabled:\s*rightStickyScrollEnabled\s*\}/s.test(dualEditor), 'DualEditorView should pass right stickyScroll to Monaco')
assert(/leftStickyScrollEnabled=\{originalPane\.stickyScroll\s*===\s*true\}/.test(textDiff), 'TextDiffRenderer should pass original pane stickyScroll')
assert(/rightStickyScrollEnabled=\{modifiedPane\.stickyScroll\s*===\s*true\}/.test(textDiff), 'TextDiffRenderer should pass modified pane stickyScroll')
assert(!/core\.toggle-sticky-scroll/.test(corePlugin), 'Internal core plugin should not register a sticky-scroll command')
assert(/host:pane:toggle-sticky-scroll/.test(hostActions), 'Host launcher actions should expose sticky-scroll toggle')
assert(/updatePaneStickyScroll\(state\.activePaneId,\s*next\)/.test(hostActions), 'Host sticky-scroll toggle should update only the active pane')

console.log('sticky scroll toggle checks passed')
