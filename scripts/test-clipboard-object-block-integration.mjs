#!/usr/bin/env node
/**
 * Clipboard Object Block Integration Test
 *
 * Verifies the full object-action mode integration:
 *  - GlobalLauncherHost uses useClipboardObjectBlock
 *  - GlobalLauncherSearchFrame renders ObjectBlockToken when block exists
 *  - GlobalLauncherSearchFrame renders RecommendedActionRow when block + no query
 *  - GlobalLauncherSearchFrame renders RecentClipboardHint for 2-10 min clipboard
 *  - GlobalLauncherKeyboard handles Backspace for block deletion
 *  - Recommended actions list switches based on block kind
 *  - No recommended actions when query is typed (falls through to normal search)
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const searchFrame = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')
const keyboard = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
const panel = readFileSync('src/components/launcher/GlobalLauncherPanel.tsx', 'utf8')
const frames = readFileSync('src/components/launcher/GlobalLauncherFrames.tsx', 'utf8')

// ─── Host Integration ──────────────────────────────────────────────────────────

assert.match(
  globalLauncherHost,
  /useClipboardObjectBlock\(\{[\s\S]*open[\s\S]*readClipboard/,
  'GlobalLauncherHost must call useClipboardObjectBlock with open and readClipboard',
)
assert.match(
  globalLauncherHost,
  /clipboardBlock=\{clipboardBlock\}/,
  'GlobalLauncherHost must pass clipboardBlock to GlobalLauncherPanel',
)

// ─── Panel passthrough ─────────────────────────────────────────────────────────

assert.match(
  panel,
  /ClipboardObjectBlockState/,
  'GlobalLauncherPanel must import ClipboardObjectBlockState type',
)
assert.match(
  panel,
  /clipboardBlock/,
  'GlobalLauncherPanel must accept and pass clipboardBlock',
)

// ─── Frames passthrough ────────────────────────────────────────────────────────

assert.match(
  frames,
  /clipboardBlock/,
  'GlobalLauncherFrames must pass clipboardBlock to SearchFrame',
)

// ─── SearchFrame object-action mode ────────────────────────────────────────────

assert.match(
  searchFrame,
  /ObjectBlockToken/,
  'SearchFrame must render ObjectBlockToken',
)
assert.match(
  searchFrame,
  /RecentClipboardHint/,
  'SearchFrame must render RecentClipboardHint',
)
assert.match(
  searchFrame,
  /RecommendedActionRow/,
  'SearchFrame must render RecommendedActionRow for recommended actions',
)
assert.match(
  searchFrame,
  /recommendActionsForBlock/,
  'SearchFrame must call recommendActionsForBlock when block exists',
)
assert.match(
  searchFrame,
  /data-testid="recommended-actions-list"/,
  'SearchFrame must expose test id for recommended actions list',
)
assert.match(
  searchFrame,
  /block \? \(/,
  'SearchFrame must show recommended actions when block exists (object-action mode)',
)
assert.match(
  searchFrame,
  /filteredActions/,
  'SearchFrame must filter recommended actions by query',
)

// ─── Keyboard Backspace handling ───────────────────────────────────────────────

assert.match(
  keyboard,
  /handleClipboardBackspace/,
  'GlobalLauncherKeyboard must accept handleClipboardBackspace callback',
)
assert.match(
  keyboard,
  /event\.key === ['"]Backspace['"][\s\S]*handleClipboardBackspace/,
  'GlobalLauncherKeyboard must call handleClipboardBackspace on Backspace',
)

// ─── Regression: no auto Cmd+C ────────────────────────────────────────────────

assert.doesNotMatch(
  globalLauncherHost,
  /simulateCopy|simulate_copy|⌘C|Cmd\+C/,
  'GlobalLauncherHost must never auto-simulate Cmd+C',
)
assert.doesNotMatch(
  searchFrame,
  /simulateCopy|simulate_copy/,
  'SearchFrame must not simulate copy',
)

console.log('clipboard object block integration checks passed')
