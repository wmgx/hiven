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

const editorView = read('src/views/EditorView.tsx')
const renderStatusBar = read('src/components/workspace/RenderStatusBar.tsx')
const commandPalette = read('src/components/CommandPalette.tsx')
const store = read('src/store.ts')
const i18n = read('src/i18n.ts')

assert(
  !/lastResult|lastActionName|editor\.output|Bottom bar/.test(editorView),
  'EditorView should not render the old bottom output bar',
)

assert(
  /lastCommandStatus:\s*LastCommandStatus\s*\|\s*null/.test(store) &&
  /setLastCommandStatus:\s*\(status:\s*LastCommandStatus\s*\|\s*null\)\s*=>\s*void/.test(store),
  'App store should expose a single lastCommandStatus record',
)

assert(
  /lastCommandStatus\s*=\s*useAppStore/.test(renderStatusBar) &&
  /status\.lastCommand/.test(renderStatusBar) &&
  /lastCommandStatus\.title/.test(renderStatusBar),
  'RenderStatusBar should display the last command title/status',
)

assert(
  /lastCommandStatus/.test(renderStatusBar) &&
  /paneOrder\.length <= 1[\s\S]*!lastCommandStatus/.test(renderStatusBar),
  'RenderStatusBar should remain visible when only last command status exists',
)

assert(
  /setLastCommandStatus\(\{\s*title:\s*commandTitle,\s*status:\s*'running'/.test(commandPalette) &&
  /setLastCommandStatus\(\{\s*title:\s*commandTitle,\s*status:\s*'success'/.test(commandPalette) &&
  /setLastCommandStatus\(\{\s*title:\s*commandTitle,\s*status:\s*'error'/.test(commandPalette),
  'CommandPalette should record running, success, and error command status',
)

assert(
  /localized\(action\.title/.test(commandPalette) &&
  /localized\(entry\.contribution\.title/.test(commandPalette),
  'Command status should use the command title, not the command id/name',
)

assert(
  /status\.lastCommand/.test(i18n) &&
  /status\.commandRunning/.test(i18n) &&
  /status\.commandSuccess/.test(i18n) &&
  /status\.commandError/.test(i18n),
  'i18n should include last command status labels',
)

console.log('command status bar checks passed')
