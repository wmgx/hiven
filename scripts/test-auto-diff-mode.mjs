#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const seamPath = join(root, 'src/plugins/textDiff/autoDiffMode.ts')

assert.ok(
  existsSync(seamPath),
  'Expected src/plugins/textDiff/autoDiffMode.ts to exist and export decideAutoDiffMode',
)

const source = readFileSync(seamPath, 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2023,
    jsx: ts.JsxEmit.ReactJSX,
    verbatimModuleSyntax: true,
  },
  fileName: seamPath,
})

const tempDir = mkdtempSync(join(tmpdir(), 'hiven-auto-diff-mode-'))
const compiledPath = join(tempDir, 'autoDiffMode.mjs')
writeFileSync(compiledPath, compiled.outputText)

try {
  const module = await import(new URL(`file://${compiledPath}`).href)
  assert.equal(typeof module.decideAutoDiffMode, 'function', 'Expected decideAutoDiffMode export')
  assert.equal(
    typeof module.normalizeAutoDiffLayout,
    'function',
    'Expected normalizeAutoDiffLayout export',
  )
  assert.equal(typeof module.isAutoDiffExitKey, 'function', 'Expected isAutoDiffExitKey export')

  const decide = module.decideAutoDiffMode
  const normalizeLayout = module.normalizeAutoDiffLayout
  const isExitKey = module.isAutoDiffExitKey

  assert.equal(
    decide({
      leftText: '{"name":"hiven","count":1}',
      rightText: '{\n  "count": 2,\n  "name": "hiven"\n}',
      semanticEnabled: true,
    }),
    'json-semantic',
    'valid JSON on both sides should use semantic JSON diff when semantic mode is enabled',
  )

  assert.equal(
    decide({
      leftText: '{"name":"hiven","count":1}',
      rightText: '{"name":"hiven","count":2}',
      semanticEnabled: false,
    }),
    'text',
    'valid JSON should fall back to text line diff when semantic mode is disabled',
  )

  assert.equal(
    decide({
      leftText: '{"name":"hiven",',
      rightText: '{"name":"hiven","count":2}',
      semanticEnabled: true,
    }),
    'text',
    'invalid JSON on either side should fall back to text line diff',
  )

  assert.equal(
    normalizeLayout('inline'),
    'side-by-side',
    'inline layout requests should normalize to side-by-side',
  )

  assert.equal(
    normalizeLayout('side-by-side'),
    'side-by-side',
    'side-by-side layout requests should stay side-by-side',
  )

  assert.equal(
    normalizeLayout(undefined),
    'side-by-side',
    'missing layout should default to side-by-side',
  )

  assert.equal(isExitKey('Escape'), true, 'Escape should exit auto diff mode')
  assert.equal(isExitKey('Enter'), false, 'Enter should not exit auto diff mode')

  console.log('auto diff mode tests passed')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
