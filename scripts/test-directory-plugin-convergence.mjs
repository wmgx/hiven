#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

// Time utilities ship as one first-party plugin package (timestamp merged into date-time-assistant).
assert.ok(
  !existsSync('src/plugins/timestamp/manifest.json'),
  'timestamp should be merged into date-time-assistant instead of shipping as a separate plugin package',
)
const manifest = JSON.parse(readFileSync('src/plugins/date-time-assistant/manifest.json', 'utf8'))
assert.deepEqual(
  [...(manifest.capabilities ?? [])].sort(),
  ['command', 'instant-suggestion', 'surface'],
  'date-time-assistant should advertise command, instant-suggestion, and surface capabilities',
)

console.log('directory plugin convergence checks passed')
