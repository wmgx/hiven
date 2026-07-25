#!/usr/bin/env node
/**
 * Clipboard Object Block UI — Static contract test
 *
 * Verifies:
 *  - ObjectBlockToken renders source/kind/age/remove
 *  - RecentClipboardHint renders attach action
 *  - RecommendedActionRow renders action title/output targets
 *  - GlobalLauncherSearchFrame does not assume external selection
 *  - useClipboardObjectBlock exports correct shape
 *  - No auto Cmd+C or external selection reading in launcher
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const objectBlockToken = readFileSync('src/components/launcher/ObjectBlockToken.tsx', 'utf8')
const recentClipboardHint = readFileSync('src/components/launcher/RecentClipboardHint.tsx', 'utf8')
const useClipboardObjectBlockSrc = readFileSync('src/launcher/clipboard/useClipboardObjectBlock.ts', 'utf8')
const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const globalLauncherKeyboard = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
const globalLauncherSearchFrame = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')

// ObjectBlockToken contract
assert.match(objectBlockToken, /data-testid="object-block-token"/, 'ObjectBlockToken should have test id')
assert.match(objectBlockToken, /data-source=\{block\.source\}/, 'ObjectBlockToken should expose source')
assert.match(objectBlockToken, /data-kind=\{block\.kind\}/, 'ObjectBlockToken should expose kind')
assert.match(objectBlockToken, /data-state=/, 'ObjectBlockToken should show age label')
assert.match(objectBlockToken, /onRemove/, 'ObjectBlockToken should expose remove callback')
assert.match(objectBlockToken, /selectedForDelete/, 'ObjectBlockToken should handle selected-for-delete state')
assert.match(objectBlockToken, /objectBlockDeleteHint|object-block-delete-hint/, 'ObjectBlockToken should support delete hint when selected')
assert.match(objectBlockToken, /secretMasked/, 'ObjectBlockToken should handle secret masking')
assert.match(objectBlockToken, /objectBlockMasked/, 'ObjectBlockToken should show masked label via i18n')

// RecentClipboardHint contract
assert.match(recentClipboardHint, /data-testid="recent-clipboard-hint"/, 'RecentClipboardHint should have test id')
assert.match(recentClipboardHint, /hint\.ageLabel|recentClipboardHintSubtitle/, 'RecentClipboardHint should show age/kind subtitle')
assert.match(recentClipboardHint, /selected/, 'RecentClipboardHint should support selection state')
assert.match(recentClipboardHint, /onAttach/, 'RecentClipboardHint should expose attach callback')

// useClipboardObjectBlock hook shape
assert.match(useClipboardObjectBlockSrc, /export function useClipboardObjectBlock/, 'hook should be exported')
assert.match(useClipboardObjectBlockSrc, /mode:\s*ClipboardObjectBlockMode/, 'hook should expose mode')
assert.match(useClipboardObjectBlockSrc, /block:\s*LauncherObjectBlock \| null/, 'hook should expose block')
assert.match(useClipboardObjectBlockSrc, /hint:\s*RecentClipboardHint \| null/, 'hook should expose hint')
assert.match(useClipboardObjectBlockSrc, /removeBlock/, 'hook should expose removeBlock')
assert.match(useClipboardObjectBlockSrc, /handleBackspace/, 'hook should expose handleBackspace')
assert.match(useClipboardObjectBlockSrc, /attachHintAsBlock/, 'hook should expose attachHintAsBlock')
assert.match(useClipboardObjectBlockSrc, /readClipboard/, 'hook should accept readClipboard param')
// One-shot Backspace: empty query removes with exit transition (no select-for-delete step)
assert.match(useClipboardObjectBlockSrc, /if \(!queryEmpty\) return false/, 'backspace only when query empty')
assert.match(useClipboardObjectBlockSrc, /OBJECT_BLOCK_EXIT_MS|isExiting/, 'remove uses exit transition state')
assert.match(useClipboardObjectBlockSrc, /removeBlock\(\)/, 'backspace delegates to removeBlock')
assert.match(useClipboardObjectBlockSrc, /setIsExiting\(true\)/, 'remove starts exit animation before unmount')
assert.doesNotMatch(useClipboardObjectBlockSrc, /simulateCopy|simulate_copy|⌘C|Cmd\+C/, 'hook must not auto-simulate Cmd+C')
assert.doesNotMatch(useClipboardObjectBlockSrc, /externalSelection|readExternalSelection/, 'hook must not read external selection')

// Enter on recent clipboard hint must respect selection (not steal from list rows)
assert.match(globalLauncherKeyboard, /isClipboardHintSelected/, 'keyboard must know if clipboard hint is selected')
assert.match(globalLauncherKeyboard, /selectedIndex === -1/, 'keyboard treats -1 as hint focus')
assert.match(globalLauncherHost, /hasClipboardHint \? -1 : 0/, 'host allows selectedIndex -1 for hint')
assert.match(globalLauncherSearchFrame, /clipboardHintSelected/, 'search frame passes hint selected state')

// GlobalLauncher regressions
assert.doesNotMatch(globalLauncherHost, /simulateCopy|simulate_copy/, 'GlobalLauncherHost must not auto-simulate copy')
assert.doesNotMatch(globalLauncherSearchFrame, /externalSelection|readExternalSelection/, 'search frame must not reference external selection')

console.log('clipboard object block UI contract checks passed')
