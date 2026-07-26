#!/usr/bin/env node
/**
 * Feishu plugin pure-logic contract (RED-first):
 * static source checks on cli/* + domains/*, optional TS transpile of pure helpers.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const cliFiles = [
  'src/plugins/feishu/cli/parse.ts',
  'src/plugins/feishu/cli/errors.ts',
  'src/plugins/feishu/cli/run.ts',
  'src/plugins/feishu/cli/detect.ts',
]

const domainFiles = [
  'src/plugins/feishu/domains/docs.ts',
  'src/plugins/feishu/domains/auth.ts',
]

// --- required modules must exist ---
for (const path of [...cliFiles, ...domainFiles]) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

const runSrc = read('src/plugins/feishu/cli/run.ts')
const parseSrc = read('src/plugins/feishu/cli/parse.ts')
const errorsSrc = read('src/plugins/feishu/cli/errors.ts')
const detectSrc = read('src/plugins/feishu/cli/detect.ts')
const docsSrc = read('src/plugins/feishu/domains/docs.ts')
const authSrc = read('src/plugins/feishu/domains/auth.ts')

// --- runLarkCli contract ---
assert.match(runSrc, /export\s+(async\s+)?function\s+runLarkCli|export\s+const\s+runLarkCli/, 'run.ts must export runLarkCli')
assert.match(runSrc, /runLarkCli/, 'run.ts must define runLarkCli')

// Write / high-risk-write must gate on confirmation before spawning CLI
assert.ok(
  /confirmation_required|confirmed/.test(runSrc),
  'run.ts must guard write paths with confirmation_required and/or confirmed',
)
assert.ok(
  /risk\s*[=:]|['"]write['"]|['"]high-risk-write['"]|highRiskWrite|high-risk-write/.test(runSrc),
  'run.ts must model write / high-risk-write risk levels',
)

// JSON / timeout / signal are part of the controlled spawn contract
assert.match(runSrc, /timeoutMs|--json|json/, 'run.ts should request JSON / honor timeoutMs')
assert.match(runSrc, /AbortSignal|signal/, 'run.ts should accept AbortSignal for cancellation')

// --- parse / errors / detect surface ---
assert.match(parseSrc, /parse|JSON\.parse|_notice/, 'parse.ts should parse CLI JSON / _notice')
assert.match(errorsSrc, /error|Error|map|hint/, 'errors.ts should map CLI failures to readable errors')
assert.match(detectSrc, /lark-cli|which|detect|doctor|version/, 'detect.ts should probe lark-cli availability')

// --- docs domain: DesktopTarget mapping + highlight strip ---
assert.ok(
  /DesktopTarget|sourceId|kind\s*:\s*['"]document['"]|kind:\s*['"]document['"]/.test(docsSrc),
  'docs.ts must map search results to DesktopTarget-like document targets',
)
assert.ok(
  /search|\+search|docs/.test(docsSrc),
  'docs.ts must call or wrap docs search',
)
// Strip title highlight tags such as <h>...</h> / <em> from search hits
assert.ok(
  /<h>|<\/h>|stripHighlight|highlight|replace\s*\([^)]*<h|<\/?h\b|<\/?em\b|strip.*title|title.*strip|removeHighlight/i.test(
    docsSrc,
  ),
  'docs.ts must strip title highlight tags (<h> or similar) from search results',
)

// --- auth domain present ---
assert.match(authSrc, /login|whoami|auth|token|profile/, 'auth.ts must cover auth/login/whoami surface')

// --- no workspace deep imports in feishu plugin sources ---
const pluginRoot = join(root, 'src/plugins/feishu')
assert.ok(existsSync(pluginRoot), 'src/plugins/feishu must exist')

function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) walkTsFiles(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name.name)) out.push(full)
  }
  return out
}

const pluginSources = walkTsFiles(pluginRoot)
assert.ok(pluginSources.length > 0, 'feishu plugin must contain source files')

for (const file of pluginSources) {
  const src = readFileSync(file, 'utf8')
  assert.doesNotMatch(
    src,
    /from\s+['"]\.\.\/\.\.\/workspace\//,
    `${file} must not deep-import via ../../workspace/`,
  )
  assert.doesNotMatch(
    src,
    /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//,
    `${file} must not deep-import via ../../../workspace/`,
  )
  assert.doesNotMatch(
    src,
    /from\s+['"]@?\/?src\/workspace\//,
    `${file} must not import src/workspace internals by absolute path`,
  )
}

// --- optional: transpile pure helpers if typescript is available ---
async function tryRunPureHelpers() {
  let ts
  try {
    const require = createRequire(import.meta.url)
    ts = require('typescript')
  } catch {
    console.log('typescript not resolvable; skipping transpile pure-helper checks')
    return
  }

  const candidates = [
    'src/plugins/feishu/cli/parse.ts',
    'src/plugins/feishu/cli/errors.ts',
    'src/plugins/feishu/domains/docs.ts',
  ].filter((p) => existsSync(join(root, p)))

  if (candidates.length === 0) return

  const tmp = mkdtempSync(join(tmpdir(), 'feishu-cli-logic-'))
  try {
    for (const rel of candidates) {
      const source = read(rel)
      // Only attempt isolated transpile for files without relative local imports that need full project graph
      const hasRelativeImport = /from\s+['"]\.\.?\/[^'"]+['"]/.test(source)
      if (hasRelativeImport) continue

      const { outputText } = ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true,
        },
        fileName: rel,
      })
      const outFile = join(tmp, rel.replace(/\//g, '__').replace(/\.ts$/, '.mjs'))
      writeFileSync(outFile, outputText, 'utf8')
      // Dynamic import validates the module evaluates (side-effect free pure helpers)
      await import(pathToFileURL(outFile).href)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

await tryRunPureHelpers()

console.log('feishu cli logic contract checks passed')
