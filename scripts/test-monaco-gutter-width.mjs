import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'

const textEditorCore = readFileSync('src/kits/editor/TextEditorCore.tsx', 'utf8')
const packageJson = readFileSync('package.json', 'utf8')

assert.match(
  packageJson,
  /"test:monaco-gutter-width":\s*"node scripts\/test-monaco-gutter-width\.mjs"/,
  'package.json should expose the Monaco gutter width regression test',
)

assert.match(
  textEditorCore,
  /const\s+lineDecorationsWidth\s*=\s*foldingEnabled\s*\?\s*8\s*:\s*24/,
  'Editor primitive should normalize total gutter width for folding and plaintext editors',
)

assert.match(
  textEditorCore,
  /lineDecorationsWidth,\s*\n\s*lineNumbersMinChars:\s*3/,
  'Editor primitive should pass the normalized gutter width with fixed line-number digits',
)

console.log('Monaco gutter width checks passed')
