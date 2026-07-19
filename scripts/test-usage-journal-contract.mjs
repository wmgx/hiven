#!/usr/bin/env node

/**
 * Usage Journal contract tests (static / source-level).
 *
 * Asserts the append-only launcher usage journal surface:
 * 1. Frontend module `src/workspace/usageJournal.ts` exists with the expected API.
 * 2. Journal entries never carry clipboard/content body fields.
 * 3. Entry type fields are limited to the allow-listed metadata set.
 * 4. Launcher controller records journal writes on the shouldRecord path.
 * 5. Rust side exposes usage_journal storage / append command.
 *
 * This is a TDD contract: currently missing production wiring must FAIL.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(relPath) {
  return readFileSync(join(root, relPath), 'utf8')
}

function readIfExists(relPath) {
  const full = join(root, relPath)
  return existsSync(full) ? readFileSync(full, 'utf8') : null
}

const failures = []

function check(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
  } catch (err) {
    failures.push({ name, message: err?.message ?? String(err) })
    console.log(`  FAIL  ${name}`)
    console.log(`        ${err?.message ?? err}`)
  }
}

const JOURNAL_MODULE = 'src/workspace/usageJournal.ts'
const CONTROLLER = 'src/workspace/launcher/controller.ts'
const TAURI_LIB = 'src-tauri/src/lib.rs'

const ALLOWED_ENTRY_FIELDS = [
  'commandId',
  'surfaceId',
  'executedAt',
  'prevCommandId',
  'objectKind',
]

const FORBIDDEN_CONTENT_BODY_FIELDS = [
  'contentText',
  'payloadText',
  'clipboardText',
]

console.log('usage journal contract')

// ─── 1. Frontend module must exist ──────────────────────────────────────────

check('src/workspace/usageJournal.ts exists', () => {
  assert.ok(
    existsSync(join(root, JOURNAL_MODULE)),
    `expected ${JOURNAL_MODULE} to exist (append-only usage journal frontend module)`,
  )
})

const journalSource = readIfExists(JOURNAL_MODULE)

// ─── 2. No clipboard / content body fields on journal entries ───────────────

check('usageJournal.ts must not write content body fields (contentText / payloadText / clipboardText)', () => {
  assert.ok(journalSource != null, `${JOURNAL_MODULE} is missing`)

  // Forbid forbidden field names appearing as type/object property keys that
  // would be part of a journal entry payload (not incidental comments alone).
  // Match: property keys in types/interfaces, object literals, or append args.
  for (const field of FORBIDDEN_CONTENT_BODY_FIELDS) {
    const asKey = new RegExp(
      `(?:^|[,;{\\s])${field}\\s*[?:]?\\s*:|['"]${field}['"]\\s*:`,
      'm',
    )
    assert.doesNotMatch(
      journalSource,
      asKey,
      `${JOURNAL_MODULE} must not use entry field "${field}" (journal must not store clipboard/content body)`,
    )
  }

  // Also ban common full-text aliases if used as entry keys.
  assert.doesNotMatch(
    journalSource,
    /(?:^|[,;{\s])(?:content|payload|clipboard|textBody|bodyText)\s*[?:]?\s*:|['"](?:content|payload|clipboard|textBody|bodyText)['"]\s*:/m,
    `${JOURNAL_MODULE} must not introduce free-form content/payload/clipboard body entry keys`,
  )
})

// ─── 3. Entry type fields allow-list ────────────────────────────────────────

check('UsageJournalEntry type fields are limited to the allow-listed metadata set', () => {
  assert.ok(journalSource != null, `${JOURNAL_MODULE} is missing`)

  // Locate UsageJournalEntry type/interface definition block.
  const typeMatch = journalSource.match(
    /export\s+type\s+UsageJournalEntry\s*=\s*\{([\s\S]*?)\}/,
  ) ?? journalSource.match(
    /export\s+interface\s+UsageJournalEntry\s*\{([\s\S]*?)\}/,
  )

  assert.ok(
    typeMatch,
    `${JOURNAL_MODULE} must export type UsageJournalEntry = { ... }`,
  )

  const body = typeMatch[1]
  // Collect property names: optional `?` and readonly allowed.
  const fields = [...body.matchAll(/^\s*(?:readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\??\s*:/gm)].map(
    (m) => m[1],
  )

  assert.ok(fields.length > 0, 'UsageJournalEntry must declare at least one field')

  for (const field of fields) {
    assert.ok(
      ALLOWED_ENTRY_FIELDS.includes(field),
      `UsageJournalEntry field "${field}" is not allow-listed; allowed: ${ALLOWED_ENTRY_FIELDS.join(', ')}`,
    )
  }

  for (const required of ['commandId', 'surfaceId', 'executedAt']) {
    assert.ok(
      fields.includes(required),
      `UsageJournalEntry must include required field "${required}"`,
    )
  }
})

check('usageJournal.ts exports appendUsageJournal and pruneUsageJournal', () => {
  assert.ok(journalSource != null, `${JOURNAL_MODULE} is missing`)
  assert.match(
    journalSource,
    /export\s+(?:async\s+)?function\s+appendUsageJournal\b|export\s*\{[^}]*\bappendUsageJournal\b/,
    'must export appendUsageJournal',
  )
  assert.match(
    journalSource,
    /export\s+(?:async\s+)?function\s+pruneUsageJournal\b|export\s*\{[^}]*\bpruneUsageJournal\b/,
    'must export pruneUsageJournal',
  )
  assert.match(
    journalSource,
    /appendUsageJournal\s*\(\s*entry\s*:\s*UsageJournalEntry\s*\)\s*(?::\s*Promise<\s*void\s*>)?/,
    'appendUsageJournal(entry: UsageJournalEntry) signature expected',
  )
  assert.match(
    journalSource,
    /pruneUsageJournal\s*\(/,
    'pruneUsageJournal(...) must be callable',
  )
  assert.match(
    journalSource,
    /maxAgeDays|maxRows/,
    'pruneUsageJournal options should mention maxAgeDays and/or maxRows',
  )
})

// ─── 4. controller shouldRecord path must call journal ──────────────────────

check('controller.ts wires usage journal on shouldRecord paths', () => {
  assert.ok(existsSync(join(root, CONTROLLER)), `${CONTROLLER} must exist`)
  const controller = read(CONTROLLER)

  const importsOrCallsJournal =
    /\busageJournal\b/.test(controller) || /\bappendUsageJournal\b/.test(controller)

  assert.ok(
    importsOrCallsJournal,
    `${CONTROLLER} must reference usageJournal or appendUsageJournal so shouldRecord paths append journal rows`,
  )

  // Soft structural hint: near shouldRecord usage we expect journal append.
  // Not every shouldRecord branch must inline-call (helpers ok), but at least one
  // journal touchpoint near recordSelection / shouldRecord is required.
  const nearRecord =
    /shouldRecord[\s\S]{0,400}(?:appendUsageJournal|usageJournal)/.test(controller) ||
    /(?:appendUsageJournal|usageJournal)[\s\S]{0,400}shouldRecord/.test(controller) ||
    /recordSelection[\s\S]{0,400}(?:appendUsageJournal|usageJournal)/.test(controller) ||
    /(?:appendUsageJournal|usageJournal)[\s\S]{0,400}recordSelection/.test(controller)

  assert.ok(
    nearRecord,
    `${CONTROLLER}: journal call should appear near shouldRecord / recordSelection paths (fire-and-forget append)`,
  )
})

// ─── 5. Rust side: usage_journal table or append command ────────────────────

check('src-tauri/src/lib.rs exposes usage_journal table or usage_journal_append command', () => {
  assert.ok(existsSync(join(root, TAURI_LIB)), `${TAURI_LIB} must exist`)
  const rust = read(TAURI_LIB)

  const hasTable = /usage_journal/.test(rust)
  const hasAppend = /usage_journal_append/.test(rust)

  assert.ok(
    hasTable || hasAppend,
    `${TAURI_LIB} must contain "usage_journal" table and/or "usage_journal_append" command string`,
  )
})

// ─── Summary ────────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\nusage journal contract FAILED (${failures.length} check(s))`)
  for (const f of failures) {
    console.error(`  - ${f.name}: ${f.message}`)
  }
  process.exit(1)
}

console.log('\nusage journal contract checks passed')
