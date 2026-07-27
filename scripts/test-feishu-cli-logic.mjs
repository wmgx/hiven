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
  'src/plugins/feishu/domains/calendar.ts',
  'src/plugins/feishu/domains/im.ts',
  'src/plugins/feishu/domains/contact.ts',
  'src/plugins/feishu/domains/write.ts',
  'src/plugins/feishu/domains/messages.ts',
  'src/plugins/feishu/domains/tasks.ts',
  'src/plugins/feishu/domains/minutes.ts',
  'src/plugins/feishu/domains/windowFocus.ts',
  'src/plugins/feishu/domains/icons.ts',
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
const formatErrorSrc = read('src/plugins/feishu/cli/formatError.ts')

// --- runLarkCli contract ---
assert.match(runSrc, /export\s+(async\s+)?function\s+runLarkCli|export\s+const\s+runLarkCli/, 'run.ts must export runLarkCli')
assert.match(runSrc, /pickCliJsonText|parseCliStreams/, 'must parse stderr error envelopes when stdout empty')
assert.match(errorsSrc, /missing_scope|extractMissingScopes|looksLikeCliJsonEnvelope/, 'errors must humanize missing_scope')
assert.match(formatErrorSrc, /formatFeishuCliFailure|presentFeishuCliFailure|error\.missingScope/, 'formatError must localize missing scope + auth flow')
assert.match(read('src/plugins/feishu/tools.ts'), /presentFeishuCliFailure/, 'tools must present friendly CLI failures')
assert.match(read('src/plugins/feishu/domains/write.ts'), /createSheet|deriveTitleFromContent/, 'write domain must support sheet + content-first doc')
assert.match(read('src/plugins/feishu/domains/auth.ts'), /--scope|scopes/, 'startLogin must accept missing scopes')
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

// --- calendar domain (B2 read-only) ---
const calendarSrc = read('src/plugins/feishu/domains/calendar.ts')
assert.match(calendarSrc, /fetchAgenda|\+agenda/, 'calendar.ts must support +agenda')
assert.match(calendarSrc, /searchEvents|\+search-event/, 'calendar.ts must support +search-event')
assert.match(calendarSrc, /mapEventsToRows/, 'calendar.ts must map events to launcher rows')
assert.doesNotMatch(calendarSrc, /\+create|\+rsvp/, 'B2 calendar domain must stay read-only (no create/rsvp)')

// --- im / contact domain (B3 read-only) ---
const imSrc = read('src/plugins/feishu/domains/im.ts')
const contactSrc = read('src/plugins/feishu/domains/contact.ts')
assert.match(imSrc, /\+chat-search|searchChats/, 'im.ts must support chat search')
assert.match(imSrc, /\+chat-list|listRecentChats/, 'im.ts must support chat list')
assert.doesNotMatch(imSrc, /\+messages-send/, 'B3 im domain must not send messages')
assert.match(contactSrc, /\+search-user|searchUsers/, 'contact.ts must support user search')
assert.match(contactSrc, /open_id|mapUsersToRows/, 'contact.ts must surface open_id for copy')

// --- write domain (B4) must require confirmation ---
const writeSrc = read('src/plugins/feishu/domains/write.ts')
assert.match(writeSrc, /sendMessage|\+messages-send/, 'write.ts must support messages-send')
assert.match(writeSrc, /createCalendarEvent|\+create/, 'write.ts must support calendar create')
assert.match(writeSrc, /createDoc|docs.*\+create/, 'write.ts must support docs create')
assert.match(writeSrc, /confirmed/, 'write helpers must accept confirmed flag')
assert.match(writeSrc, /risk:\s*['"]write['"]/, 'write helpers must use risk write')
assert.match(runSrc, /ensureYesFlag|--yes/, 'runLarkCli should attach --yes after write confirmation')

// --- B5 enhancements ---
const docsSrcFull = read('src/plugins/feishu/domains/docs.ts')
const messagesSrc = read('src/plugins/feishu/domains/messages.ts')
const tasksSrc = read('src/plugins/feishu/domains/tasks.ts')
const minutesSrc = read('src/plugins/feishu/domains/minutes.ts')
assert.match(docsSrcFull, /fetchDocContent|\+fetch/, 'docs.ts must support docs +fetch')
assert.match(messagesSrc, /\+messages-search|searchMessages/, 'messages.ts must support messages-search')
assert.match(tasksSrc, /\+get-my-tasks|listMyTasks/, 'tasks.ts must support get-my-tasks')
assert.match(minutesSrc, /\+search|searchMinutes/, 'minutes.ts must support minutes search')

// --- B5 window focus helpers (pure) ---
const windowFocusSrc = read('src/plugins/feishu/domains/windowFocus.ts')
assert.match(windowFocusSrc, /scoreWindowTitleMatch/, 'windowFocus must export title scoring')
assert.match(windowFocusSrc, /pickBestFeishuWindow|tryFocusFeishuWindowByTitle/, 'windowFocus must pick or focus windows')
assert.match(windowFocusSrc, /openFeishuTarget/, 'windowFocus must provide openFeishuTarget open path')
assert.match(windowFocusSrc, /osascript|AXRaise|Feishu|Lark/, 'window focus should target Feishu/Lark via osascript')
// Open URL must not wait for osascript (doc open latency)
assert.match(
  windowFocusSrc,
  /openUrl[\s\S]{0,200}preferWindowFocus|await options\.openUrl[\s\S]{0,400}void tryFocusFeishuWindowByTitle/,
  'openFeishuTarget must open URL before optional background focus',
)

const linksSrc = read('src/plugins/feishu/domains/links.ts')
assert.match(linksSrc, /buildChatOpenUrl|openChatId/, 'links must build chat open url')
// Prefer native client scheme over https applink (browser hop)
assert.match(linksSrc, /lark:\/\/|feishu:\/\//, 'chat open must use native client scheme')
// Host segment is required: lark://applink.feishu.cn/client/chat/open — bare lark://client/... does not navigate
assert.match(
  linksSrc,
  /applink\.feishu\.cn|applink\.larksuite\.com/,
  'native chat open must embed applink host so client routes to chat',
)
assert.match(
  linksSrc,
  /\$\{scheme\}:\/\/\$\{host\}\/client\/chat\/open|scheme\}:\/\/\$\{host\}/,
  'buildChatOpenUrl must use scheme://applink-host/client/chat/open',
)
assert.doesNotMatch(
  linksSrc.replace(/buildChatOpenHttpsUrl[\s\S]*?^}/m, ''),
  /buildChatOpenUrl[\s\S]*https:\/\/applink/,
  'primary buildChatOpenUrl must not use https applink (browser hop)',
)
assert.match(linksSrc, /buildUserChatOpenUrl|p2pChatId|openId/, 'links must build user DM applink')
const windowFocusSrc2 = read('src/plugins/feishu/domains/windowFocus.ts')
assert.match(windowFocusSrc2, /open \$\{|open \$\{shellQuote|`open |open -a/, 'native schemes should use macOS open')
assert.match(windowFocusSrc2, /Lark\.app/, 'open path should prefer production Lark.app when present')

// --- L1 multi-layer cache ---
const l1CacheSrc = read('src/plugins/feishu/search/l1Cache.ts')
assert.match(l1CacheSrc, /resolveL1List|getL1FastHits/, 'l1Cache must expose resolveL1List / getL1FastHits')
assert.match(l1CacheSrc, /rememberL1Entities|queryL1Entities/, 'l1Cache must keep entity index for local filter')
assert.match(l1CacheSrc, /touchL1EntityAccess|accessedAt|ENTITY_ACCESSED_TTL/, 'visited entities must be sticky with longer TTL')
assert.match(l1CacheSrc, /queryL1PrefixCache|withL1Inflight/, 'l1Cache must support prefix reuse + inflight coalesce')
assert.match(l1CacheSrc, /10\s*\*\s*60_000|QUERY_TTL_MS\s*=\s*10/, 'query cache TTL should be multi-minute, not seconds-only')
assert.match(
  read('src/plugins/feishu/provider/contactsTargetProvider.ts'),
  /touchL1EntityAccess/,
  'opening a contact must mark entity accessed',
)
assert.match(
  read('src/plugins/feishu/provider/chatsTargetProvider.ts'),
  /touchL1EntityAccess/,
  'opening a chat must mark entity accessed',
)
assert.match(
  read('src/plugins/feishu/provider/docsTargetProvider.ts'),
  /touchL1EntityAccess/,
  'opening a doc must mark entity accessed',
)
assert.match(
  read('src/plugins/feishu/provider/contactsTargetProvider.ts'),
  /resolveL1List/,
  'contacts provider must use resolveL1List',
)
assert.match(
  read('src/plugins/feishu/provider/chatsTargetProvider.ts'),
  /resolveL1List/,
  'chats provider must use resolveL1List',
)
assert.match(
  read('src/plugins/feishu/provider/docsTargetProvider.ts'),
  /resolveL1List/,
  'docs provider must use resolveL1List',
)
assert.match(
  read('src/plugins/feishu/runtime.ts'),
  /warmFeishuL1EntityIndex|listRecentChats/,
  'startup should warm recent chats into entity index',
)

// --- icons: doc types + person initials ---
const iconsSrc = read('src/plugins/feishu/domains/icons.ts')
assert.match(iconsSrc, /iconForFeishuDoc|iconForPerson|initialsAvatarDataUrl/, 'icons helpers required')
assert.match(read('src/plugins/feishu/domains/docs.ts'), /iconForFeishuDoc/, 'docs map must pick type icons')
assert.match(read('src/plugins/feishu/domains/contact.ts'), /iconForPerson/, 'contacts must set person icons')
assert.match(
  read('src/plugins/feishu/domains/contact.ts'),
  /hasContactIntersection|onlyChatted|has_chatted/,
  'contacts must model chat intersection',
)
assert.match(
  read('src/plugins/feishu/provider/contactsTargetProvider.ts'),
  /onlyChatted:\s*true|hasContactIntersection/,
  'L1 contacts mix-in must hide people without intersection',
)
assert.match(read('src/plugins/feishu/domains/im.ts'), /iconForChat/, 'chats must set avatar icons')
assert.match(
  read('src/components/launcher/LauncherCommandTag.tsx'),
  /launcher-param-chip-label|label\s*\?\s*`\$\{label\}/,
  'param chips must show parameter name, not value-only',
)

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
    'src/plugins/feishu/cli/formatError.ts',
    'src/plugins/feishu/domains/docs.ts',
    'src/plugins/feishu/search/l1Cache.ts',
    'src/plugins/feishu/domains/icons.ts',
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
      const mod = await import(pathToFileURL(outFile).href)

      // Behavioral checks for L1 cache
      if (rel.endsWith('l1Cache.ts')) {
        mod.clearL1Caches()
        const people = [
          { id: 'ou_1', title: '孙文韬', keywords: ['孙文韬', 'sunwentao'], openUrl: 'lark://x' },
          { id: 'ou_2', title: '孙文静', keywords: ['孙文静'], openUrl: 'lark://y' },
          { id: 'ou_3', title: '李昊天', keywords: ['李昊天'], openUrl: 'lark://z' },
        ]
        mod.setL1Cache('contacts', '孙文', people.slice(0, 2))
        const exact = mod.getL1Cache('contacts', '孙文')
        assert.equal(exact?.length, 2, 'exact cache hit')

        const refined = mod.getL1FastHits('contacts', '孙文韬', 8)
        assert.ok(refined?.some((r) => r.id === 'ou_1'), 'prefix/entity should find 孙文韬 without CLI')

        let fetches = 0
        const first = mod.resolveL1List({
          domain: 'contacts',
          query: '全新查询xyz',
          limit: 8,
          fetch: async () => {
            fetches += 1
            await new Promise((r) => setTimeout(r, 30))
            return [{ id: 'n1', title: '全新查询xyz结果', openUrl: 'lark://n' }]
          },
        })
        const second = mod.resolveL1List({
          domain: 'contacts',
          query: '全新查询xyz',
          limit: 8,
          fetch: async () => {
            fetches += 1
            return [{ id: 'n2', title: 'should not run', openUrl: 'lark://n2' }]
          },
        })
        const [a, b] = await Promise.all([first, second])
        assert.equal(fetches, 1, 'inflight must coalesce concurrent identical queries')
        assert.equal(a[0]?.id, 'n1')
        assert.equal(b[0]?.id, 'n1')

        // Second resolve should be pure cache (no extra fetch)
        const cachedAgain = await mod.resolveL1List({
          domain: 'contacts',
          query: '全新查询xyz',
          limit: 8,
          fetch: async () => {
            fetches += 1
            return []
          },
        })
        assert.equal(fetches, 1, 'exact cache must skip fetch')
        assert.equal(cachedAgain[0]?.id, 'n1')

        // Visited entities rank higher
        mod.clearL1Caches()
        mod.rememberL1Entities('contacts', [
          { id: 'a', title: '张三丰', openUrl: 'lark://a' },
          { id: 'b', title: '张三', openUrl: 'lark://b' },
        ])
        mod.touchL1EntityAccess('contacts', { id: 'a', title: '张三丰', openUrl: 'lark://a' })
        const ranked = mod.queryL1Entities('contacts', '张三', 8)
        assert.equal(ranked[0]?.id, 'a', 'visited 张三丰 should rank above plain 张三 match')
        mod.clearL1Caches()
      }

      if (rel.endsWith('icons.ts')) {
        assert.equal(mod.iconForFeishuDoc({ entityType: 'DOC', docTypes: 'SHEET' }), 'Sheet')
        assert.equal(mod.iconForFeishuDoc({ entityType: 'WIKI', docTypes: 'DOCX' }), 'FileText')
        assert.equal(mod.iconForFeishuDoc({ entityType: 'DOC', docTypes: 'SLIDES' }), 'Presentation')
        assert.equal(mod.iconForFeishuDoc({ entityType: 'WIKI' }), 'BookOpen')
        const personIcon = mod.iconForPerson({ name: '李昊天', id: 'ou_1' })
        assert.ok(personIcon.startsWith('data:image/svg+xml'), 'person without avatar uses initials svg')
        const chatIcon = mod.iconForChat({
          name: '群',
          avatarUrl: 'https://s1-imfile.feishucdn.com/static-resource/v1/x',
        })
        assert.ok(chatIcon.startsWith('https://'), 'chat uses remote avatar when present')
      }

      if (rel.endsWith('errors.ts')) {
        const rawJson = JSON.stringify({
          ok: false,
          error: {
            type: 'authorization',
            subtype: 'missing_scope',
            message: 'missing required scope(s): task:task:read',
            missing_scopes: ['task:task:read'],
          },
        })
        const mapped = mod.mapLarkCliError({
          exitCode: 1,
          stderr: rawJson,
          stdoutMessage: '',
          parseFailed: true,
        })
        assert.equal(mapped.code, 'missing_scope')
        assert.ok(!mapped.message.includes('"ok"'), 'must not dump raw JSON as message')
        assert.ok(mapped.message.includes('task:task:read'), 'must mention missing scope')
        assert.ok(mapped.hint && mapped.hint.includes('auth login'), 'must give login hint')
      }

      if (rel.endsWith('formatError.ts')) {
        const t = (key, vars) => {
          if (key === 'error.missingScope') return `缺少飞书权限：${vars.scopes}`
          if (key === 'error.missingScopeHint') return `请执行：lark-cli auth login --scope "${vars.scopes}"`
          if (key === 'error.tasksFailed') return '加载待办失败'
          if (key === 'action.openAuthUrl') return '打开授权链接'
          return key
        }
        const text = mod.formatFeishuCliFailure(
          t,
          {
            code: 'missing_scope',
            message: 'Missing Feishu permission: task:task:read',
            hint: 'Run: lark-cli auth login --scope "task:task:read"',
          },
          'error.tasksFailed',
        )
        assert.ok(text.includes('task:task:read'))
        assert.ok(!text.includes('"ok": false'), 'UI text must not include raw CLI JSON')
        assert.equal(typeof mod.presentFeishuCliFailure, 'function', 'presentFeishuCliFailure exported')
      }

    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

await tryRunPureHelpers()

console.log('feishu cli logic contract checks passed')
