#!/usr/bin/env node
/**
 * Persistable recents: plugin opts in; host stores snapshots and rehydrates.
 */

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { translate as launcherHostTranslate } from './helpers/launcher-host-locale.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

// Pure helpers
const tmp = mkdtempSync(join(tmpdir(), 'persist-recents-'))
const src = read('src/workspace/launcher/persistableRecents.ts')
// Strip effectRunner import for isolated test
const stripped = src
  .replace(/import \{ translate, type Locale \} from '[^']+'\n/, 'const translate = globalThis.__launcherHostTranslate\n')
  .replace(/import \{ openExternalUrl \} from '[^']+'\n/, '')
  .replace(/import type \{ LauncherItem \} from '[^']+'\n/, '')
  .replace(/const openUrl = options\.openUrl \?\? openExternalUrl/, 'const openUrl = options.openUrl ?? (async () => {})')

const out = join(tmp, 'persistableRecents.mjs')
writeFileSync(
  out,
  ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'persistableRecents.ts',
  }).outputText,
)

globalThis.__launcherHostTranslate = launcherHostTranslate
const mod = await import(pathToFileURL(out).href)

const payload = {
  persistKey: 'ou_1',
  systemKey: 'test.contacts:person:ou_1',
  kind: 'person',
  title: '李昊天',
  subtitle: 'dept',
  url: 'lark://applink.feishu.cn/client/chat/open?openId=ou_1',
  keywords: ['李昊天'],
}

let recents = mod.emptyPersistableRecents()
recents = mod.recordPersistableRecent(recents, payload, 1000)
recents = mod.recordPersistableRecent(recents, { ...payload, title: '李昊天' }, 2000)
assert.equal(recents.length, 1)
assert.equal(recents[0].count, 2)
assert.equal(recents[0].lastSelectedAt, 2000)

recents = mod.recordPersistableRecent(
  recents,
  {
    persistKey: 'oc_2',
    systemKey: 'test.chats:chat:oc_2',
    kind: 'chat',
    title: '项目群',
    url: 'lark://applink.feishu.cn/client/chat/open?openChatId=oc_2',
    fallback: true,
  },
  3000,
)
assert.equal(recents[0].persistKey, 'oc_2', 'most recent first')

const filtered = mod.filterPersistableRecents(recents, '李')
assert.equal(filtered.length, 1)
assert.equal(filtered[0].title, '李昊天')

const items = mod.buildPersistableRecentLauncherItems({
  recents: [...recents, { ...recents[0], sourceId: 'feishu.contacts' }, { ...recents[1], systemKey: 'feishu.docs:document:old' }],
  query: '',
  locale: 'zh',
  openUrl: async () => {},
})
assert.equal(items.length, 2, 'retired sources disappear while existing sources remain')
// Builder preserves every stored candidate; shared launcher ranking owns final order.
assert.equal(items[0].display.title, '项目群', 'builder preserves the recent snapshot order')
assert.equal(items[0].ranking?.fallback, true, 'rehydrated recent keeps fallback ranking')
assert.equal(items[0].persistPayload?.fallback, true, 'fallback survives another persistence cycle')
const personItem = items.find((item) => item.display.title === '李昊天')
assert.equal(personItem?.display.kindLabel, '最近联系人')
assert.equal(personItem?.persistable, true)
assert.ok(personItem?.display.aliases?.includes('dept'), 'rehydrated recent keeps subtitle searchable')
assert.ok(
  (personItem?.ranking?.providerPriorityBoost ?? 0) >= 40,
  'empty-query recents get higher boost',
)

const typed = mod.buildPersistableRecentLauncherItems({
  recents,
  query: 'li',
  locale: 'zh',
  openUrl: async () => {},
})
assert.equal(
  typed.length,
  recents.length,
  'typed query keeps the full bounded snapshot for shared pinyin search/ranking',
)
assert.ok(
  (typed[0].ranking?.providerPriorityBoost ?? 0) <= 40,
  'typed-query boost is not higher than empty boost',
)

const [legacyBrowserHistory] = mod.buildPersistableRecentLauncherItems({
  recents: [{
    persistKey: 'https://example.com/docs',
    systemKey: 'browser.chromium:document:history-1',
    sourceId: 'browser.chromium',
    kind: 'document',
    title: 'Docs',
    url: 'https://example.com/docs',
    count: 1,
    lastSelectedAt: 1000,
  }],
  query: 'docs',
  locale: 'en',
  openUrl: async () => {},
})
assert.equal(legacyBrowserHistory.ranking?.fallback, true, 'legacy browser history restores as fallback')
assert.equal(legacyBrowserHistory.persistPayload?.fallback, true, 'legacy browser history self-heals on selection')

rmSync(tmp, { recursive: true, force: true })
console.log('persistable recents checks passed')
