#!/usr/bin/env node
/**
 * Host URL scheme registry: plugins register; host routes open without Tauri shell scope.
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

let ts
try {
  ts = createRequire(import.meta.url)('typescript')
} catch {
  console.log('typescript unavailable; static checks only')
  process.exit(0)
}

const tmp = mkdtempSync(join(tmpdir(), 'url-scheme-'))
const src = read('src/workspace/urlSchemeRegistry.ts')
const out = join(tmp, 'reg.mjs')
writeFileSync(
  out,
  ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'urlSchemeRegistry.ts',
  }).outputText,
)
const mod = await import(pathToFileURL(out).href)

assert.equal(mod.routeHostOpenUrl('https://example.com'), 'shell-open')
assert.equal(mod.routeHostOpenUrl('lark://applink.feishu.cn/client/chat/open?x=1'), 'deny')
mod.registerUrlSchemes('feishu', ['lark', 'feishu', 'x-feishu'])
assert.equal(mod.routeHostOpenUrl('lark://applink.feishu.cn/client/chat/open?x=1'), 'system-url')
assert.equal(mod.routeHostOpenUrl('feishu://applink.feishu.cn/x'), 'system-url')
assert.equal(mod.canHostOpenUrl('lark://x'), true)
assert.equal(mod.canHostOpenUrl('slack://x'), false)
mod.unregisterUrlSchemes('feishu')
assert.equal(mod.routeHostOpenUrl('lark://x'), 'deny')

rmSync(tmp, { recursive: true, force: true })
console.log('url scheme registry checks passed')
