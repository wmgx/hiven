import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const paneEditor = readFileSync('src/components/workspace/PaneEditor.tsx', 'utf8')
const packageJson = readFileSync('package.json', 'utf8')

assert.match(
  packageJson,
  /"test:monaco-gutter-width":\s*"node scripts\/test-monaco-gutter-width\.mjs"/,
  'package.json should expose the Monaco gutter width regression test',
)

assert.match(
  paneEditor,
  /const\s+lineDecorationsWidth\s*=\s*foldingEnabled\s*\?\s*8\s*:\s*24/,
  'Primary editor should normalize total gutter width for folding and plaintext panes',
)

assert.match(
  paneEditor,
  /lineDecorationsWidth,\s*\n\s*lineNumbersMinChars:\s*3/,
  'Primary editor should pass the normalized gutter width with fixed line-number digits',
)

console.log('Monaco gutter width checks passed')
