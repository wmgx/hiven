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

console.log('plugin selection input resolution checks passed')
