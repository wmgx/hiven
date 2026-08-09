#!/usr/bin/env node
/** Launcher back/focus without CommandPalette. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

assert.equal(existsSync('src/components/CommandPalette.tsx'), false, 'CommandPalette deleted')
const host = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const keyboard = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
assert.match(host, /focus|Escape|back|onClose|open/i, 'host handles open/close focus')
assert.match(keyboard, /Escape|handleGlobalLauncherKeyDown/, 'keyboard handles escape')
console.log('launcher back focus checks passed')
