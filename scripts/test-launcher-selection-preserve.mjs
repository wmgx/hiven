#!/usr/bin/env node
/**
 * Progressive list append must not steal the user's highlighted row.
 * Only user-pinned selection (systemKey) is sticky; default top is not.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = readFileSync(join(root, 'src/workspace/launcher/selectionPreserve.ts'), 'utf8')
assert.match(src, /resolvePreservedSelection/, 'selectionPreserve must export resolvePreservedSelection')

const session = readFileSync(join(root, 'src/workspace/launcher/useLauncherSession.ts'), 'utf8')
assert.match(session, /resolvePreservedSelection|selectedKeyRef/, 'session must preserve selection by systemKey')
assert.match(session, /pin:\s*false|options\?\.pin/, 'session must support pin:false for default selection')
assert.doesNotMatch(
  session,
  /First paint with items: pin identity/,
  'must not auto-pin default top-of-list selection',
)

const panel = readFileSync(join(root, 'src/components/launcher/GlobalLauncherPanel.tsx'), 'utf8')
assert.match(panel, /setSelectedIndex\(0,\s*\{\s*pin:\s*false\s*\}\)/, 'query change must not pin default selection')

const tmp = mkdtempSync(join(tmpdir(), 'sel-preserve-'))
const out = join(tmp, 'selectionPreserve.mjs')
writeFileSync(
  out,
  ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'selectionPreserve.ts',
  }).outputText,
)

const { resolvePreservedSelection } = await import(pathToFileURL(out).href)

// 1) No user pin → always ranking top, no sticky key
{
  const r = resolvePreservedSelection({
    selectedKey: null,
    selectedIndex: 0,
    items: [{ systemKey: 'a' }, { systemKey: 'b' }],
  })
  assert.equal(r.index, 0)
  assert.equal(r.key, null, 'default selection must not adopt a sticky key')
}

// 1b) Default must not stick to old index when list grows above
{
  const r = resolvePreservedSelection({
    selectedKey: null,
    selectedIndex: 2,
    items: [
      { systemKey: 'feishu.docs:1' },
      { systemKey: 'tool:create-doc' },
      { systemKey: 'old-top' },
    ],
  })
  assert.equal(r.index, 0, 'unpinned selection follows new ranking top')
  assert.equal(r.key, null)
}

// 2) Partial append + re-rank moves user-selected item down → follow key
{
  const r = resolvePreservedSelection({
    selectedKey: 'tool:create-doc',
    selectedIndex: 0,
    items: [
      { systemKey: 'feishu.docs:1' },
      { systemKey: 'feishu.contacts:1' },
      { systemKey: 'tool:create-doc' },
    ],
  })
  assert.equal(r.index, 2, 'must follow systemKey after append above')
  assert.equal(r.key, 'tool:create-doc')
}

// 3) User-selected item disappeared → drop pin, default to top
{
  const r = resolvePreservedSelection({
    selectedKey: 'gone',
    selectedIndex: 5,
    items: [{ systemKey: 'a' }, { systemKey: 'b' }],
  })
  assert.equal(r.index, 0)
  assert.equal(r.key, null)
}

// 4) Empty list
{
  const r = resolvePreservedSelection({
    selectedKey: 'a',
    selectedIndex: 2,
    items: [],
  })
  assert.equal(r.index, 0)
  assert.equal(r.key, null)
}

rmSync(tmp, { recursive: true, force: true })
console.log('launcher selection preserve checks passed')
