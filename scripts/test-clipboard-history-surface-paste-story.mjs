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
const surfaceRenderer = read('src/components/pluginSurface/PluginSurfaceRenderer.tsx')

assert.equal(
  packageJson.scripts?.['test:clipboard-history-surface-paste-story'],
  'node scripts/test-clipboard-history-surface-paste-story.mjs',
  'package.json must expose clipboard history surface paste story coverage',
)

assert.match(
  surfaceRenderer,
  /keepOpen:\s*presentation !== 'global-launcher' && target\.pluginId !== 'clipboard-history'/,
  'clipboard history must hide after paste so its next open captures the current foreground app',
)

const handlePasteBlock = surface.slice(surface.indexOf('const handlePaste = useCallback'), surface.indexOf('const resolveFullItem = useCallback'))
assert.ok(handlePasteBlock, 'ClipboardHistorySurface must define handlePaste')
assert.match(handlePasteBlock, /const fullItem = await repository\.getItem\(item\.id\)/,
  'paste re-reads full data, including already-loaded previews that may have changed or been deleted')
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
assert.match(handlePasteBlock, /if \(!result\?\.ok\)[\s\S]*setPasteNotice/,
  'failed delivery must retain the history selection and expose the host failure message')
assert.match(
  handlePasteBlock,
  /recordPaste\(fullItem\.id\)/,
  'successful paste must record pasteCount for the Frequent tab',
)
assert.match(
  handlePasteBlock,
  /resetBrowser\(\)[\s\S]*host\.complete\(\)/,
  'successful paste must reset browsing state before completing the launcher action',
)
assert.match(
  surface,
  /const resetBrowser = useCallback\([\s\S]*setQuery\(['"]['"]\)[\s\S]*setFilter\('all'\)[\s\S]*setSelectedId\(items\[0\]\?\.id \?\? null\)[\s\S]*listRef\.current\.scrollTop = 0[\s\S]*removeAllRanges\(\)/,
  'successful paste must restore the initial filter, selection and scroll position',
)
assert.match(
  handlePasteBlock,
  /host\.complete\(\)/,
  'successful paste flow must complete the launcher action',
)
assert.match(
  handlePasteBlock,
  /catch[\s\S]*setPasteNotice\(t\('error\.pasteFailed'\)\)/,
  'paste failures must show a paste failed error instead of closing silently',
)

// Keydown: do not pin exact dependency array — product evolved (return-to-launcher, DOM ⌘C).
assert.match(surface, /const handleKeyDown = useCallback\(\(e: KeyboardEvent\) => \{/, 'must define handleKeyDown')
assert.match(
  surface,
  /e\.key === 'Enter' && !e\.altKey && \(e\.metaKey \|\| e\.ctrlKey\)[\s\S]*handleReturnToLauncher/,
  '⌘/Ctrl+Enter must return selected item to launcher as Object Block',
)
assert.match(
  surface,
  /else if \(e\.key === 'Enter' && !e\.altKey && !e\.shiftKey\)[\s\S]*handlePaste\(selectedItem\)/,
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
assert.match(surface, /appliedFilter === 'frequent'[\s\S]*pasteCount/)
assert.match(surface, /appliedFilter === 'favorite'[\s\S]*isFavorite/)

console.log('✓ test-clipboard-history-surface-paste-story passed')
