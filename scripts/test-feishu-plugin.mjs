#!/usr/bin/env node
/**
 * feishu first-party plugin contract:
 * manifest / provider / settings / locales / catalog / host SDK boundary.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const pluginDir = 'src/plugins/feishu'

// --- required package files ---
const requiredPaths = [
  `${pluginDir}/manifest.json`,
  `${pluginDir}/index.tsx`,
  `${pluginDir}/provider/docsTargetProvider.ts`,
]

for (const path of requiredPaths) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

// settings/* must exist (at least one file under settings/)
const settingsDir = join(root, pluginDir, 'settings')
assert.ok(existsSync(settingsDir) && statSync(settingsDir).isDirectory(), `${pluginDir}/settings/* must exist`)
const settingsFiles = readdirSync(settingsDir).filter((n) => /\.(ts|tsx|js|jsx)$/.test(n))
assert.ok(settingsFiles.length > 0, `${pluginDir}/settings must contain at least one source file`)

// locales en/zh
assert.ok(existsSync(join(root, pluginDir, 'locales/en.json')), `${pluginDir}/locales/en.json must exist`)
assert.ok(existsSync(join(root, pluginDir, 'locales/zh.json')), `${pluginDir}/locales/zh.json must exist`)

const manifestRaw = read(`${pluginDir}/manifest.json`)
const manifest = JSON.parse(manifestRaw)
const pluginIndex = read(`${pluginDir}/index.tsx`)
const provider = read(`${pluginDir}/provider/docsTargetProvider.ts`)
const catalog = read('src/workspace/pluginProductCatalog.ts')
const localeEn = read(`${pluginDir}/locales/en.json`)
const localeZh = read(`${pluginDir}/locales/zh.json`)

// --- manifest ---
assert.equal(manifest.pluginId, 'feishu', 'manifest pluginId must be feishu')
assert.ok(Array.isArray(manifest.permissions), 'manifest must declare permissions array')
assert.ok(
  manifest.permissions.includes('shell.run'),
  'manifest permissions must include shell.run for lark-cli spawn',
)

// --- index: hooks.startup + settings ---
assert.match(pluginIndex, /hooks\s*:\s*\{[\s\S]*startup/, 'index must register hooks.startup')
assert.match(pluginIndex, /settings\s*:/, 'index must contribute settings')
assert.ok(
  /schema\s*:\s*\{|component\s*:/.test(pluginIndex),
  'index settings must expose schema and/or component',
)

// B2 calendar tools live in tools.ts (assembled by index)
const toolsSrc = existsSync(join(root, `${pluginDir}/tools.ts`))
  ? read(`${pluginDir}/tools.ts`)
  : pluginIndex
assert.match(toolsSrc, /feishu\.calendar-agenda|calendar-agenda/, 'must expose calendar agenda tool')
assert.match(toolsSrc, /feishu\.calendar-search|calendar-search|\+search-event|searchEvents/, 'must expose calendar search tool')
assert.match(toolsSrc, /agenda|今日议程|日程/, 'agenda tool should be searchable via 日程/agenda aliases')
assert.match(toolsSrc, /feishu\.chat-search|chat-search|searchChats/, 'must expose chat search tool')
assert.match(toolsSrc, /feishu\.contact-search|contact-search|searchUsers/, 'must expose contact search tool')
assert.match(toolsSrc, /找人|搜群|contact|chat/, 'B3 tools should be searchable via 找人/搜群 aliases')
assert.match(toolsSrc, /openUrl|openedChat|buildChatOpenUrl|row\.openUrl/, 'chat/contact tools should open Feishu chat, not only copy id')
assert.match(toolsSrc, /feishu\.send-message|send-message|sendMessage/, 'must expose send-message tool')
assert.match(toolsSrc, /confirm\.sendMessage|Confirm send|确认发送|confirmed:\s*true/, 'send message must go through L2 confirm')
assert.match(toolsSrc, /feishu\.create-event|create-event|createCalendarEvent/, 'must expose create-event tool')
assert.match(toolsSrc, /feishu\.create-doc|create-doc|createDoc/, 'must expose create-doc tool')
assert.match(toolsSrc, /requireParamSelection:\s*false|createDocEmpty|doc\.defaultTitle/, 'create-doc should allow empty one-tap create')
assert.match(toolsSrc, /feishu\.create-sheet|create-sheet|createSheet/, 'must expose create-sheet tool')
assert.match(toolsSrc, /sheetType|bitable|workbook|\+create/, 'create-sheet must let user pick type')
assert.match(toolsSrc, /presentFeishuCliFailure|openAuthUrl|completeAuth/, 'missing scope should offer auth URL flow')
assert.match(
  read('src/i18n/pluginI18nRegistry.ts'),
  /descriptionI18n|optDesc|option\.description/,
  'plugin i18n must localize param option descriptions',
)
assert.match(toolsSrc, /feishu\.docs-fetch|docs-fetch|fetchDocContent/, 'must expose docs-fetch tool')
assert.match(toolsSrc, /createPane|openedInEditor/, 'docs-fetch should open content in editor pane')
assert.match(toolsSrc, /feishu\.messages-search|messages-search|searchMessages/, 'must expose messages-search tool')
assert.match(toolsSrc, /feishu\.my-tasks|my-tasks|listMyTasks/, 'must expose my-tasks tool')
assert.match(toolsSrc, /feishu\.minutes-search|minutes-search|searchMinutes/, 'must expose minutes-search tool')

// B5 window focus wiring
assert.match(provider, /openFeishuTarget|preferWindowFocus|titleHint/, 'docs provider activate should try window focus')
const settingsModel = read(`${pluginDir}/settings/model.ts`)
assert.match(settingsModel, /preferWindowFocus/, 'settings model must include preferWindowFocus')
assert.match(settingsModel, /contactSearchOnlyChatted/, 'settings model must include contactSearchOnlyChatted')
assert.match(localeEn, /settings\.avatarAuth|settings\.contactSearchOnlyChatted/, 'en locales cover new settings')
assert.match(localeZh, /settings\.avatarAuth|settings\.contactSearchOnlyChatted/, 'zh locales cover new settings')
assert.match(
  toolsSrc,
  /onlyChatted:\s*settings\.contactSearchOnlyChatted/,
  'contact-search tool must honor contactSearchOnlyChatted',
)

// --- provider: feishu.docs DesktopTargetProvider ---
assert.match(provider, /feishu\.docs/, 'provider must use source id feishu.docs')
// Empty / short query must not fire CLI (isL1QueryReady gates min length)
assert.match(
  provider,
  /!q|isL1QueryReady/,
  'provider list must short-circuit empty/short query',
)
assert.match(
  provider,
  /resolveL1List|getL1Cache|getL1FastHits/,
  'docs provider must use L1 cache path',
)
assert.match(
  provider,
  /scoreBias|DOCS_MIXIN_SCORE_BIAS/,
  'docs mix-in product ranking bias must live on the provider, not host hardcode',
)
assert.match(
  provider,
  /kindLabelI18n|飞书文档|Feishu Doc/,
  'docs provider should set product kindLabel override',
)
assert.match(
  read(`${pluginDir}/provider/contactsTargetProvider.ts`),
  /kindLabelI18n|飞书联系人/,
  'contacts provider should set product kindLabel override',
)

const l1 = read(`${pluginDir}/search/l1Cache.ts`)
assert.match(l1, /rememberL1Entities|resolveL1List|withL1Inflight/, 'l1Cache multi-layer cache required')
assert.match(provider, /listTimeoutMs/, 'provider must declare listTimeoutMs')
assert.match(provider, /kind\s*:\s*['"]document['"]|['"]document['"]/, 'provider targets must use kind document')

// L1 chats / contacts mix-in providers
assert.ok(existsSync(join(root, `${pluginDir}/provider/chatsTargetProvider.ts`)), 'chats L1 provider must exist')
assert.ok(existsSync(join(root, `${pluginDir}/provider/contactsTargetProvider.ts`)), 'contacts L1 provider must exist')
const chatsProvider = read(`${pluginDir}/provider/chatsTargetProvider.ts`)
const contactsProvider = read(`${pluginDir}/provider/contactsTargetProvider.ts`)
assert.match(chatsProvider, /feishu\.chats/, 'chats provider source id')
assert.match(chatsProvider, /kind\s*:\s*['"]chat['"]/, 'chats use kind chat')
assert.match(chatsProvider, /!q|isL1QueryReady/, 'chats empty/short query guard')
assert.match(contactsProvider, /feishu\.contacts/, 'contacts provider source id')
assert.match(contactsProvider, /kind\s*:\s*['"]person['"]/, 'contacts use kind person')
assert.match(contactsProvider, /!q|isL1QueryReady/, 'contacts empty/short query guard')
const runtime = read(`${pluginDir}/runtime.ts`)
assert.match(runtime, /registerFeishuChatsProvider|chatsMixEnabled/, 'runtime registers chats provider')
assert.match(runtime, /registerFeishuContactsProvider|contactsMixEnabled/, 'runtime registers contacts provider')
const types = read('src/workspace/desktopTargets/types.ts')
assert.match(types, /'chat'/, 'DesktopTargetKind includes chat')
assert.match(types, /'person'/, 'DesktopTargetKind includes person')

// Prefer host SDK desktopTargets / @hiven/plugin (no workspace deep import)
assert.match(provider, /from\s+['"]@hiven\/plugin['"]/, 'provider must import from @hiven/plugin')
assert.doesNotMatch(provider, /from\s+['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(provider, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(pluginIndex, /from\s+['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(pluginIndex, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//)

// settings sources also must not deep-import workspace
for (const name of settingsFiles) {
  const src = read(`${pluginDir}/settings/${name}`)
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/workspace\//, `settings/${name} must not deep-import workspace`)
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//, `settings/${name} must not deep-import workspace`)
}

// Walk remaining plugin sources for workspace deep imports
function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) walkTsFiles(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name.name)) out.push(full)
  }
  return out
}

for (const file of walkTsFiles(join(root, pluginDir))) {
  const src = readFileSync(file, 'utf8')
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/workspace\//, `${file} must not deep-import ../../workspace/`)
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//, `${file} must not deep-import ../../../workspace/`)
}

// --- product catalog ---
assert.match(catalog, /feishu/, 'pluginProductCatalog must include feishu')

// --- locales non-empty JSON ---
assert.ok(Object.keys(JSON.parse(localeEn)).length > 0, 'locales/en.json must have keys')
assert.ok(Object.keys(JSON.parse(localeZh)).length > 0, 'locales/zh.json must have keys')

// package.json scripts wiring
const packageJson = JSON.parse(read('package.json'))
assert.equal(
  packageJson.scripts?.['test:feishu-plugin'],
  'node scripts/test-feishu-plugin.mjs',
  'package.json must expose test:feishu-plugin',
)
assert.equal(
  packageJson.scripts?.['test:feishu-cli-logic'],
  'node scripts/test-feishu-cli-logic.mjs',
  'package.json must expose test:feishu-cli-logic',
)

console.log('feishu plugin contract checks passed')
