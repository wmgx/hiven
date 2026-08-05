#!/usr/bin/env node
/** V4 stereo-black tokens + V5 empty well contract */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync('src/index.css', 'utf8')
const empty = readFileSync('src/components/launcher/LauncherEmptyWell.tsx', 'utf8')
const search = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')
const result = readFileSync('src/components/launcher/GlobalLauncherResultFrame.tsx', 'utf8')
const palette = readFileSync('src/i18n/locales/palette.ts', 'utf8')

assert.match(css, /--elev-highlight/, 'V4 elev-highlight token')
assert.match(css, /--well-bg/, 'V4/V5 well-bg token')
assert.match(css, /--well-inset/, 'V4/V5 well-inset token defined')
assert.match(css, /\.launcher-empty-well\b/, 'empty well styles')
// Input row uses surface face + hairline; multi-edge well-inset was removed (muddy layer).
assert.match(css, /\.l-search[\s\S]*?background:\s*var\(--surface\)/, 'input row recessed via surface')

assert.match(empty, /data-testid/, 'empty well test id')
assert.match(empty, /SearchX/, 'line icon not emoji-only')
assert.match(search, /LauncherEmptyWell/, 'search no-results uses empty well')
assert.match(search, /noResultsHint/, 'search empty has secondary hint')

assert.match(result, /LauncherCommandTag/, 'result uses command tag')
assert.match(result, /launcher-result-preview-well|launcher-preview-well/, 'single text result preview well')
assert.match(result, /LauncherOutputTargetsBar|useOutputDestinations/, 'result shares destination module')
assert.match(result, /return-to-launcher|hasReturn/, 'result return destination')
const dest = readFileSync('src/components/launcher/LauncherOutputTargets.tsx', 'utf8')
assert.match(dest, /⇧↵/, 'shared paste shortcut')

assert.match(palette, /noResultsHint/, 'i18n noResultsHint')
assert.match(palette, /noOptionsHint/, 'i18n noOptionsHint')

console.log('v4/v5 empty well + result destinations contracts passed')
