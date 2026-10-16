#!/usr/bin/env node
/** Plugin surface window capability contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const capability = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/capabilities/default.json'), 'utf8'))

assert.ok(
  capability.windows?.some?.((w) => String(w).includes('plugin-surface')) ||
    capability.windows?.includes?.('plugin-surface:*'),
  'capability allows plugin-surface',
)
console.log('plugin surface window checks passed')
