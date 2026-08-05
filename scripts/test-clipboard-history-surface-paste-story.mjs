#!/usr/bin/env node
/**
 * Clipboard history surface paste + return-to-launcher story (source contracts).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))
const surface = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')

assert.equal(
  packageJson.scripts?.['test:clipboard-history-surface-paste-story'],
  'node scripts/test-clipboard-history-surface-paste-story.mjs',
  'package.json must expose clipboard history surface paste story coverage',
)

const handlePasteBlock =
  surface.match(/const handlePaste = useCallback\(async \(item: ClipboardHistoryItem\) => \{[\s\S]*?\n  \}, \[host, t, repository\]\)/)?.[0] ?? ''
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
  /recordPaste\(fullItem\.id\)/,
  'successful paste must record pasteCount for the Frequent tab',
)
assert.match(
  handlePasteBlock,
  /setQuery\(['"]['"]\)[\s\S]*host\.close\(\)/,
  'successful paste must clear the search query before closing so warm reopen has a clean list',
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

// Keydown: do not pin exact dependency array — product evolved (return-to-launcher, DOM ⌘C).
assert.match(surface, /const handleKeyDown = useCallback\(\(e: KeyboardEvent\) => \{/, 'must define handleKeyDown')
assert.match(
  surface,
  /e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)[\s\S]*handleReturnToLauncher/,
  '⌘/Ctrl+Enter must return selected item to launcher as Object Block',
)
assert.match(
  surface,
  /else if \(e\.key === 'Enter'\)[\s\S]*handlePaste\(selectedItem\)/,
  'Enter must paste the selected visible item',
)
assert.match(
  surface,
  /imeKeyDown\.shouldIgnoreKeyDown/,
  'Enter paths must respect IME composition',
)
assert.match(
  surface,
  /e\.key === 'Delete' \|\| e\.key === 'Backspace'[\s\S]*handleDelete\(selectedItem\.id\)/,
  'Delete/Backspace must remove the selected visible item',
)
assert.match(
  surface,
  /\(e\.metaKey \|\| e\.ctrlKey\) && e\.key === 'c'[\s\S]*readDomSelectedText/,
  'Cmd/Ctrl+C copies DOM selection in preview (not whole-item overwrite)',
)
assert.match(
  surface,
  /e\.key === 'ArrowDown'[\s\S]*filteredItems\.findIndex\(\(i\) => i\.id === selectedId\)[\s\S]*setSelectedId\(nextId\)/,
  'ArrowDown must move selection through the filtered visible list',
)
assert.match(
  surface,
  /e\.key === 'ArrowUp'[\s\S]*filteredItems\.findIndex\(\(i\) => i\.id === selectedId\)[\s\S]*setSelectedId\(prevId\)/,
  'ArrowUp must move selection through the filtered visible list',
)

// Return-to-launcher product path
assert.match(
  surface,
  /host\.returnToLauncherWithObject\(\{\s*kind:\s*'text'/,
  'text history items return via returnToLauncherWithObject',
)
assert.match(
  surface,
  /host\.returnToLauncherWithObject\(\{[\s\S]*kind:\s*'image'/,
  'image history items return via returnToLauncherWithObject',
)
assert.match(
  surface,
  /host\.returnToLauncherWithObject\(\{[\s\S]*kind:\s*'files'/,
  'files history items return via returnToLauncherWithObject',
)
assert.match(
  surface,
  /hint\.returnToLauncher/,
  'footer must expose return-to-launcher hint (i18n)',
)

// Frequent / favorite filters
assert.match(surface, /FilterKind = 'all' \| 'text' \| 'image' \| 'files' \| 'frequent' \| 'favorite'/)
assert.match(surface, /filter === 'frequent'[\s\S]*pasteCount/)
assert.match(surface, /filter === 'favorite'[\s\S]*isFavorite/)

console.log('✓ test-clipboard-history-surface-paste-story passed')
