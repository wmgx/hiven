#!/usr/bin/env node
/** Retired collection must have no callable host command or frontend import. */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(path) ? [path] : []
  })
}

const retired = /experience\/(?:journal|miner|miningFingerprint|learningInbox|candidateEvents|candidateSuppressions|candidateSurfaceDedupe)|savedActions\/events|learning-inbox|experience_journal_(?:append|export|clear_since|clear_all)/
for (const path of sourceFiles('src')) {
  assert.doesNotMatch(readFileSync(path, 'utf8'), retired, `${path} must not expose retired collection or mining`)
}
const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
assert.doesNotMatch(native, /\b(?:fn\s+)?experience_journal_(?:append|export|clear_since|clear_all)\b/)
assert.doesNotMatch(native, /(?:DELETE\s+FROM|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+experience_events/i,
  'retiring collection must preserve existing records, including automatic retention cleanup')
assert.match(native, /last_saveable_run_set/)
assert.match(readFileSync('src/workspace/launcher/controller.ts', 'utf8'), /setLastSaveableRun/)
assert.match(readFileSync('src/workspace/launcher/hostProvider.ts', 'utf8'), /getHostSavedActionItems/)
console.log('retired self-learning has no collection/mining entrypoints; manual saving remains')
