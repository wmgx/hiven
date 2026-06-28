#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const refactorSuite = read('scripts/test-refactor-suite.mjs')
const surface = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
// Story anchor: Enter -> pasteText -> pasteImage -> pasteFiles -> host.close

assert.equal(
  packageJson.scripts?.['test:clipboard-history-surface-paste-story'],
  'node scripts/test-clipboard-history-surface-paste-story.mjs',
  'package.json must expose clipboard history surface paste story coverage',
)
assert.match(
  refactorSuite,
  /test:clipboard-history-surface-paste-story/,
  'refactor suite must include clipboard history surface paste story coverage',
)

const handlePasteBlock = surface.match(/const handlePaste = useCallback\(async \(item: ClipboardHistoryItem\) => \{[\s\S]*?\n  \}, \[host, t, repository\]\)/)?.[0] ?? ''
assert.ok(handlePasteBlock, 'ClipboardHistorySurface must define handlePaste')
assert.match(
  handlePasteBlock,
  /if \(\(item\.kind === 'text' && !item\.text\) \|\| \(item\.kind === 'image' && !item\.blobId\) \|\| \(item\.kind === 'files' && item\.paths\.length === 0\)\)[\s\S]*repository\.getItem\(item\.id\)/,
  'paste must load the full clipboard item before using index-only list data',
)
assert.match(
  handlePasteBlock,
  /fullItem\.kind === 'text'[\s\S]*host\.paste\.pasteText\(fullItem\.text\)/,
  'text clipboard items must paste through host.paste.pasteText',
)
assert.match(
  handlePasteBlock,
  /fullItem\.kind === 'image'[\s\S]*host\.paste\.pasteImage\(fullItem\.blobId\)/,
  'image clipboard items must paste through host.paste.pasteImage',
)
assert.match(
  handlePasteBlock,
  /fullItem\.kind === 'files'[\s\S]*host\.paste\.pasteFiles\(fullItem\.paths\)/,
  'file clipboard items must paste through host.paste.pasteFiles',
)
assert.match(
  handlePasteBlock,
  /result && !result\.ok && result\.fallback === 'copied'[\s\S]*host\.showMessage\(result\.message, 'info'\)/,
  'paste fallback copied results must be surfaced to the user as info',
)
assert.match(
  handlePasteBlock,
  /host\.close\(\)/,
  'successful paste flow must close the clipboard history surface',
)
assert.match(
  handlePasteBlock,
  /catch[\s\S]*host\.showMessage\(t\('error\.pasteFailed'\), 'error'\)/,
  'paste failures must show a paste failed error instead of closing silently',
)

const keydownBlock = surface.match(/const handleKeyDown = useCallback\(\(e: KeyboardEvent\) => \{[\s\S]*?\n  \}, \[selectedItem, selectedFullItem, selectedId, filteredItems, flatRows, virtualizer, handlePaste, handleDelete, host, t, imeKeyDown\]\)/)?.[0] ?? ''
assert.ok(keydownBlock, 'ClipboardHistorySurface must define handleKeyDown')
assert.match(
  keydownBlock,
  /if \(e\.key === 'Enter'\)[\s\S]*imeKeyDown\.shouldIgnoreKeyDown\(e\)[\s\S]*e\.preventDefault\(\)[\s\S]*handlePaste\(selectedItem\)/,
  'Enter must paste the selected visible item and respect IME composition',
)
assert.match(
  keydownBlock,
  /e\.key === 'Delete' \|\| e\.key === 'Backspace'[\s\S]*handleDelete\(selectedItem\.id\)/,
  'Delete/Backspace must remove the selected visible item',
)
assert.match(
  keydownBlock,
  /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'c'[\s\S]*selectedFullItem && selectedFullItem\.kind === 'text'[\s\S]*host\.clipboard\.writeText\(selectedFullItem\.text\)/,
  'Cmd/Ctrl+C must copy the loaded selected text item',
)
assert.match(
  keydownBlock,
  /e\.key === 'ArrowDown'[\s\S]*filteredItems\.findIndex\(\(i\) => i\.id === selectedId\)[\s\S]*setSelectedId\(nextId\)/,
  'ArrowDown must move selection through the filtered visible list',
)
assert.match(
  keydownBlock,
  /e\.key === 'ArrowUp'[\s\S]*filteredItems\.findIndex\(\(i\) => i\.id === selectedId\)[\s\S]*setSelectedId\(prevId\)/,
  'ArrowUp must move selection through the filtered visible list',
)

assert.match(
  surface,
  /const selectedItem = useMemo\([\s\S]*filteredItems\.find\(\(i\) => i\.id === selectedId\) \?\? null/,
  'selectedItem must resolve from filtered visible items so Enter never pastes an invisible stale item',
)
assert.match(
  surface,
  /useEffect\(\(\) => \{[\s\S]*setSelectedId\(\(current\) => \{[\s\S]*filteredItems\.length === 0[\s\S]*filteredItems\.some\(\(item\) => item\.id === current\)[\s\S]*filteredItems\[0\]\.id/,
  'filter/search changes must keep selection on a visible item before Enter paste',
)
assert.match(
  surface,
  /onDoubleClick=\{\(\) => void onPaste\(item\)\}/,
  'double click must paste the clicked clipboard history item',
)

console.log('clipboard history surface paste story checks passed')
