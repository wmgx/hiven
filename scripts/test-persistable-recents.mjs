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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

assert.match(read('src/workspace/desktopTargets/types.ts'), /persistable\?:/)
assert.match(read('src/workspace/desktopTargets/toLauncherItem.ts'), /buildPersistPayload|persistPayload/)
assert.match(read('src/workspace/launcher/persistableRecents.ts'), /recordPersistableRecent|buildPersistableRecentLauncherItems/)
assert.match(read('src/workspace/launcher/useLauncherSession.ts'), /persistableRecentItems|recordPersistableLauncherSelection/)
assert.match(read('src/store.ts'), /launcherPersistableRecents/)
assert.match(read('src/plugins/feishu/provider/contactsTargetProvider.ts'), /persistable:\s*Boolean/)
assert.match(read('src/plugins/feishu/provider/chatsTargetProvider.ts'), /persistable:\s*Boolean/)
assert.match(read('src/plugins/feishu/provider/docsTargetProvider.ts'), /persistable:\s*Boolean/)

// Pure helpers
const tmp = mkdtempSync(join(tmpdir(), 'persist-recents-'))
const src = read('src/workspace/launcher/persistableRecents.ts')
// Strip effectRunner import for isolated test
const stripped = src
  .replace(/import type \{ Locale \} from '[^']+'\n/, "/** @typedef {'en'|'zh'} Locale */\n")
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

const mod = await import(pathToFileURL(out).href)

const payload = {
  persistKey: 'ou_1',
  systemKey: 'feishu.contacts:person:ou_1',
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
    systemKey: 'feishu.chats:chat:oc_2',
    kind: 'chat',
    title: '项目群',
    url: 'lark://applink.feishu.cn/client/chat/open?openChatId=oc_2',
  },
  3000,
)
assert.equal(recents[0].persistKey, 'oc_2', 'most recent first')

const filtered = mod.filterPersistableRecents(recents, '李')
assert.equal(filtered.length, 1)
assert.equal(filtered[0].title, '李昊天')

const items = mod.buildPersistableRecentLauncherItems({
  recents,
  query: '',
  locale: 'zh',
  openUrl: async () => {},
})
assert.ok(items.length >= 2)
assert.equal(items[0].display.kindLabel, '最近会话')
assert.equal(items[0].persistable, true)

rmSync(tmp, { recursive: true, force: true })
console.log('persistable recents checks passed')
