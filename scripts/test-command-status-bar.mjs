import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readI18n() {
  const dir = join(root, 'src/i18n/locales')
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const editorView = read('src/views/EditorView.tsx')
const renderStatusBar = read('src/components/workspace/RenderStatusBar.tsx')
const paneEditor = read('src/components/workspace/PaneEditor.tsx')
const commandPalette = read('src/components/CommandPalette.tsx')
const pluginCommandExecutor = read('src/workspace/pluginCommandExecutor.ts')
const store = read('src/store.ts')
const i18n = readI18n()

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
  /statusbar-spacer/.test(renderStatusBar) &&
  /pane-status-close/.test(paneEditor),
  'RenderStatusBar should reserve the right side for command status and panes should expose close from their status bars',
)

assert(
  /setLastCommandStatus\(\{\s*title:\s*displayTitle,\s*status:\s*'running'/.test(pluginCommandExecutor) &&
  /setLastCommandStatus\(\{\s*title:\s*displayTitle,\s*status:\s*'success'/.test(pluginCommandExecutor) &&
  /setLastCommandStatus\(\{\s*title:\s*displayTitle,\s*status:\s*'error'/.test(pluginCommandExecutor),
  'Plugin command executor should record running, success, and error command status',
)

assert(
  /title:\s*item\.display\.title/.test(commandPalette) &&
  /titleI18n:\s*item\.display\.titleI18n/.test(commandPalette) &&
  /localized\(command\.title\s*\|\|\s*command\.id,\s*command\.titleI18n/.test(pluginCommandExecutor),
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
