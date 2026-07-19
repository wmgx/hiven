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
const recommendedActionRow = readFileSync('src/components/launcher/RecommendedActionRow.tsx', 'utf8')
const useClipboardObjectBlockSrc = readFileSync('src/launcher/clipboard/useClipboardObjectBlock.ts', 'utf8')
const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const globalLauncherSearchFrame = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')

// ObjectBlockToken contract
assert.match(objectBlockToken, /data-testid="object-block-token"/, 'ObjectBlockToken should have test id')
assert.match(objectBlockToken, /data-source=\{block\.source\}/, 'ObjectBlockToken should expose source')
assert.match(objectBlockToken, /data-kind=\{block\.kind\}/, 'ObjectBlockToken should expose kind')
assert.match(objectBlockToken, /data-state=/, 'ObjectBlockToken should show age label')
assert.match(objectBlockToken, /onRemove/, 'ObjectBlockToken should expose remove callback')
assert.match(objectBlockToken, /selectedForDelete/, 'ObjectBlockToken should handle selected-for-delete state')
assert.match(objectBlockToken, /再按 Backspace 删除/, 'ObjectBlockToken should show delete hint when selected')
assert.match(objectBlockToken, /secretMasked/, 'ObjectBlockToken should handle secret masking')
assert.match(objectBlockToken, /预览已隐藏/, 'ObjectBlockToken should show masked label for secrets')

// RecentClipboardHint contract
assert.match(recentClipboardHint, /data-testid="recent-clipboard-hint"/, 'RecentClipboardHint should have test id')
assert.match(recentClipboardHint, /hint\.ageLabel/, 'RecentClipboardHint should show source label')
assert.match(recentClipboardHint, /复制/, 'RecentClipboardHint should show attach action')
assert.match(recentClipboardHint, /onAttach/, 'RecentClipboardHint should expose attach callback')

// RecommendedActionRow contract
assert.match(recommendedActionRow, /data-testid="recommended-action-row"/, 'RecommendedActionRow should have test id')
assert.match(recommendedActionRow, /action\.titleZh/, 'RecommendedActionRow should display Chinese title')
assert.match(recommendedActionRow, /action\.pluginId/, 'RecommendedActionRow should display plugin attribution')
assert.match(recommendedActionRow, /输出/, 'RecommendedActionRow should display output targets')
assert.match(recommendedActionRow, /onSelect/, 'RecommendedActionRow should expose select callback')

// useClipboardObjectBlock hook shape
assert.match(useClipboardObjectBlockSrc, /export function useClipboardObjectBlock/, 'hook should be exported')
assert.match(useClipboardObjectBlockSrc, /mode:\s*ClipboardObjectBlockMode/, 'hook should expose mode')
assert.match(useClipboardObjectBlockSrc, /block:\s*LauncherObjectBlock \| null/, 'hook should expose block')
assert.match(useClipboardObjectBlockSrc, /hint:\s*RecentClipboardHint \| null/, 'hook should expose hint')
assert.match(useClipboardObjectBlockSrc, /removeBlock/, 'hook should expose removeBlock')
assert.match(useClipboardObjectBlockSrc, /handleBackspace/, 'hook should expose handleBackspace')
assert.match(useClipboardObjectBlockSrc, /attachHintAsBlock/, 'hook should expose attachHintAsBlock')
assert.match(useClipboardObjectBlockSrc, /readClipboard/, 'hook should accept readClipboard param')
assert.doesNotMatch(useClipboardObjectBlockSrc, /simulateCopy|simulate_copy|⌘C|Cmd\+C/, 'hook must not auto-simulate Cmd+C')
assert.doesNotMatch(useClipboardObjectBlockSrc, /externalSelection|readExternalSelection/, 'hook must not read external selection')

// GlobalLauncher regressions
assert.doesNotMatch(globalLauncherHost, /simulateCopy|simulate_copy/, 'GlobalLauncherHost must not auto-simulate copy')
assert.doesNotMatch(globalLauncherSearchFrame, /externalSelection|readExternalSelection/, 'search frame must not reference external selection')

console.log('clipboard object block UI contract checks passed')
