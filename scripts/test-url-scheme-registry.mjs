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

assert.match(read('src/workspace/urlSchemeRegistry.ts'), /registerUrlSchemes|routeHostOpenUrl/)
assert.match(read('src/pluginHostSdk.ts'), /urlSchemes/)
assert.match(read('src/workspace/effectRunner.ts'), /routeHostOpenUrl|urlSchemeRegistry/)
assert.match(read('src/plugins/feishu/index.tsx'), /urlSchemes\.register|FEISHU_OPEN_SCHEMES|lark/)
// Must NOT put product schemes into tauri shell open config
const tauriConf = read('src-tauri/tauri.conf.json')
assert.doesNotMatch(
  tauriConf,
  /"shell"\s*:\s*\{[^}]*lark/,
  'tauri.conf must not hardcode lark scheme in shell.open',
)
// open_system_url must stay product-agnostic (plugin does open -a Lark.app)
const libRs = read('src-tauri/src/lib.rs')
const openFn = libRs.match(
  /fn open_system_url[\s\S]*?\n}\n\n#\[derive/,
)?.[0]
assert.ok(openFn, 'open_system_url function present')
assert.doesNotMatch(
  openFn,
  /is_feishu_scheme|Lark\.app|lark:\/\/|feishu:\/\//,
  'open_system_url must not hardcode Feishu/Lark delivery',
)
// Plugin owns dual open for navigation
assert.match(
  read('src/plugins/feishu/domains/windowFocus.ts'),
  /Lark\.app/,
  'feishu plugin must deliver deep link via open -a Lark.app',
)
assert.match(
  read('src/plugins/feishu/provider/contactsTargetProvider.ts'),
  /openChatId.*buildChatOpenUrl|buildChatOpenUrl\(openChatId\)/,
  'contacts must try p2p openChatId',
)

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
