#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tauriConfig = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'))

assert.equal(tauriConfig.app.windows.find((window) => window.label === 'launcher')?.skipTaskbar, true, 'launcher runtime window must stay hidden from Windows taskbar')

console.log('desktop tray startup checks passed')
