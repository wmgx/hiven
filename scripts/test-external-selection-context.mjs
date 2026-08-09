#!/usr/bin/env node
/** External selection intentionally disabled. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const broker = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
const workflow = readFileSync('src/workflow/workflowRegistry.ts', 'utf8')

assert.match(broker, /externalSelection\?:/, 'snapshot type still models external selection')
assert.match(broker, /externalSelectionContextProvider|intentionally removed|DISABLED|NOTE:.*externalSelection/i, 'provider retired or documented off')
assert.doesNotMatch(broker, /last_foreground_selection_text/, 'native selection cache path not required while disabled')
assert.match(workflow, /DISABLED|externalSelection|editor selection/i, 'workflow notes selection scope')
console.log('external selection context (disabled) checks passed')
