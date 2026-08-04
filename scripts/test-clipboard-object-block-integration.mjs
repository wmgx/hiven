#!/usr/bin/env node
/**
 * Clipboard Object Block Integration Test (current product path)
 *
 * RecommendedActionRow was retired; history + clipboard object actions ride
 * ranking / host-injected history-object-action rows.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const searchFrame = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')
const keyboard = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
const panel = readFileSync('src/components/launcher/GlobalLauncherPanel.tsx', 'utf8')
const frames = readFileSync('src/components/launcher/GlobalLauncherFrames.tsx', 'utf8')
const renderer = readFileSync('src/components/pluginSurface/PluginSurfaceRenderer.tsx', 'utf8')
const recommendation = readFileSync('src/launcher/clipboard/actionRecommendation.ts', 'utf8')
const executor = readFileSync('src/launcher/clipboard/actionExecutor.ts', 'utf8')

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
assert.match(
  globalLauncherHost,
  /historyObjectActionItems/,
  'Host injects history object actions into the mixed list',
)
assert.match(
  globalLauncherHost,
  /history-object-action:/,
  'History actions use dedicated systemKey prefix',
)
assert.match(
  globalLauncherHost,
  /pasteText:\s*async/,
  'Host wires pasteText for history text paste-to-front',
)

// ─── Panel / frames passthrough ────────────────────────────────────────────────

assert.match(panel, /ClipboardObjectBlockState/)
assert.match(panel, /clipboardBlock/)
assert.match(frames, /clipboardBlock/)

// ─── SearchFrame ───────────────────────────────────────────────────────────────

assert.match(searchFrame, /ObjectBlockToken/)
assert.match(searchFrame, /RecentClipboardHint/)
assert.doesNotMatch(
  searchFrame,
  /RecommendedActionRow/,
  'RecommendedActionRow must stay retired — list ranking is the path',
)

// ─── Keyboard Backspace for block ────────────────────────────────────────────

assert.match(
  keyboard,
  /handleClipboardBackspace/,
  'Keyboard must support Object Block Backspace removal',
)

// ─── Return-to-launcher host API ──────────────────────────────────────────────

assert.match(renderer, /returnToLauncherWithObject/)
assert.match(renderer, /setPendingObjectBlock/)
assert.match(renderer, /createHistoryItemObjectBlock/)
assert.match(renderer, /openGlobalLauncherOverlay/)

// ─── History recommendations ─────────────────────────────────────────────────

assert.match(recommendation, /paste-history-text/)
assert.match(recommendation, /paste-history-image/)
assert.match(recommendation, /paste-history-files/)
assert.match(recommendation, /source === 'history-item'/)
assert.match(executor, /paste-history-text/)
assert.match(executor, /pasteText\?:/)

console.log('✓ test-clipboard-object-block-integration passed')
