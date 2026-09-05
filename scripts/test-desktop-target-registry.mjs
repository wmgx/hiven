#!/usr/bin/env node
/**
 * Desktop Target registry + toLauncherItem contracts (design D0).
 */
import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const root = process.cwd()

function loadTsTree(entryRel) {
  const cache = new Map()
  function load(filePath) {
    const resolved = path.resolve(filePath)
    if (cache.has(resolved)) return cache.get(resolved)
    let src = readFileSync(resolved, 'utf8')
    const out = ts.transpileModule(src, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2023,
        esModuleInterop: true,
      },
    }).outputText
    const moduleExports = {}
    const mod = { exports: moduleExports }
    cache.set(resolved, moduleExports)
    const localRequire = (spec) => {
      // i18n is checked BEFORE the relative-path branch: it resolves on disk, so
      // that branch would load the entire locale registry instead of falling
      // through to this stub. Only pickLocale is actually needed here.
      if (spec === '../../i18n' || spec.endsWith('/i18n')) {
        return { pickLocale: (locale, zh, en) => (String(locale).startsWith('zh') ? zh : en) }
      }
      if (spec.startsWith('.')) {
        const base = path.dirname(resolved)
        const candidates = [
          path.join(base, spec),
          path.join(base, spec + '.ts'),
          path.join(base, spec, 'index.ts'),
        ]
        for (const c of candidates) {
          // statSync is imported at module scope: this is an ESM file, so the
          // bare require('fs') that used to be here always threw, and the catch
          // turned every candidate into a miss — the resolver reported
          // "Cannot resolve" for modules sitting right there on disk.
          let isFile = false
          try {
            isFile = statSync(c).isFile()
          } catch { /* not this candidate */ }
          // Deliberately outside the try: a module that EXISTS but fails to load
          // must surface its own error, not be reported as unresolvable.
          if (isFile) return load(c)
        }
        throw new Error(`Cannot resolve ${spec} from ${resolved}`)
      }
      if (spec.includes('launcher/types')) {
        return {}
      }
      if (spec.includes('desktopControl/windows')) {
        return {
          getHostWindowLauncherDynamicItems: async () => [],
          listDesktopWindowsCached: async () => [],
          stripWindowQueryPrefix: (q) => ({ rest: q, mode: 'search' }),
        }
      }
      return require(spec)
    }
    vm.runInNewContext(out, {
      exports: moduleExports,
      module: mod,
      require: localRequire,
      console,
      setTimeout,
      clearTimeout,
      DOMException: globalThis.DOMException ?? class DOMException extends Error {
        constructor(message, name) {
          super(message)
          this.name = name || 'Error'
        }
      },
    })
    return moduleExports
  }
  return load(path.join(root, entryRel))
}

const constants = loadTsTree('src/workspace/desktopTargets/constants.ts')
const registry = loadTsTree('src/workspace/desktopTargets/registry.ts')
const toItem = loadTsTree('src/workspace/desktopTargets/toLauncherItem.ts')

assert.equal(constants.PROVIDER_PRIORITY_CAP, 50)
assert.equal(constants.clampProviderPriority(100), 50)
assert.equal(constants.clampProviderPriority(-1), 0)

registry.clearDesktopTargetProviders()

const partials = []
const slow = {
  id: 'slow',
  title: 'Slow',
  priority: 10,
  async list() {
    await new Promise((r) => setTimeout(r, 30))
    return [{ id: 'slow:1', sourceId: 'slow', kind: 'window', title: 'Slow Win', actionClass: 'focus' }]
  },
}
const fast = {
  id: 'fast',
  title: 'Fast',
  async list() {
    return [{ id: 'fast:1', sourceId: 'fast', kind: 'app', title: 'Fast App', actionClass: 'focus', appStableKey: 'com.fast' }]
  },
}
const bad = {
  id: 'bad',
  title: 'Bad',
  async list() {
    throw new Error('boom')
  },
}
const terminateBlocked = {
  id: 'evil',
  title: 'Evil',
  async list() {
    return [{ id: 'evil:1', sourceId: 'evil', kind: 'window', title: 'Kill me', actionClass: 'terminate' }]
  },
}

registry.registerDesktopTargetProvider(slow)
registry.registerDesktopTargetProvider(fast)
registry.registerDesktopTargetProvider(bad)
registry.registerDesktopTargetProvider(terminateBlocked)

const ctx = { query: '', locale: 'en', surfaceId: 'global-launcher' }
const all = await registry.collectDesktopTargets(ctx, {
  timeoutMs: 200,
  onPartial: (u) => partials.push(u),
})

assert.ok(partials.some((p) => p.sourceId === 'fast' && p.done), 'fast source should partial-done')
assert.ok(partials.some((p) => p.sourceId === 'bad' && p.targets.length === 0 && p.done), 'bad source isolated')
assert.ok(all.some((t) => t.id === 'fast:1'), 'fast target in final')
assert.ok(all.some((t) => t.id === 'slow:1'), 'slow target in final')
assert.ok(!all.some((t) => t.actionClass === 'terminate'), 'terminate filtered from primary list')

const item = toItem.desktopTargetToLauncherItem(
  {
    id: 'host.window:focus:native:42',
    sourceId: 'host.window',
    kind: 'window',
    title: 'Doc',
    appName: 'Chrome',
    appStableKey: 'com.google.Chrome',
    actionClass: 'focus',
  },
  { locale: 'zh', provider: { id: 'host.window', title: 'W', priority: 80 } },
)

assert.equal(item.systemKey, 'host.window:focus:native:42', 'systemKey === target.id')
assert.equal(item.surfaces?.length, 1)
assert.equal(item.surfaces?.[0], 'global-launcher')
assert.equal(item.recordUsage, true)
assert.ok(item.legacyUsageKeys?.includes('host:window:focus:app:com.google.Chrome'))
assert.equal(item.ranking?.providerPriorityBoost, 50, 'priority clamped to 50')
assert.equal(item.display.kindLabelI18n?.zh, '窗口')
assert.equal(toItem.kindLabelFor('window', 'en'), 'Window')

// Provider kindLabel override (product copy); host only supplies protocol defaults.
const personDefault = toItem.desktopTargetToLauncherItem(
  {
    id: 'feishu.contacts:person:ou_1',
    sourceId: 'feishu.contacts',
    kind: 'person',
    title: 'Ada',
    actionClass: 'open',
    meta: { url: 'lark://x' },
  },
  { locale: 'zh' },
)
assert.equal(personDefault.display.kindLabel, '联系人', 'protocol default for person')

const personOverride = toItem.desktopTargetToLauncherItem(
  {
    id: 'feishu.contacts:person:ou_2',
    sourceId: 'feishu.contacts',
    kind: 'person',
    title: 'Ada',
    actionClass: 'open',
    meta: { url: 'lark://x' },
    kindLabel: 'Feishu Contact',
    kindLabelI18n: { en: 'Feishu Contact', zh: '飞书联系人' },
  },
  { locale: 'zh' },
)
assert.equal(personOverride.display.kindLabel, '飞书联系人', 'provider kindLabelI18n overrides protocol default')
assert.equal(personOverride.display.kindLabelI18n?.en, 'Feishu Contact')

const resolved = toItem.resolveKindLabel(
  { kind: 'document', kindLabelI18n: { zh: '飞书文档', en: 'Feishu Doc' } },
  'en',
)
assert.equal(resolved.kindLabel, 'Feishu Doc')

const closeItem = toItem.desktopTargetToLauncherItem(
  {
    id: 'host.window:close:native:1',
    sourceId: 'host.window',
    kind: 'window',
    title: 'X',
    actionClass: 'close',
  },
  { locale: 'en' },
)
assert.equal(closeItem.recordUsage, false)

const fallbackItem = toItem.desktopTargetToLauncherItem(
  {
    id: 'browser.chromium:document:history-1',
    sourceId: 'browser.chromium',
    kind: 'document',
    title: 'Docs',
    actionClass: 'open',
    meta: { url: 'https://example.com/docs' },
    persistable: true,
    persistKey: 'https://example.com/docs',
    fallback: true,
  },
  { locale: 'en' },
)
assert.equal(fallbackItem.ranking?.fallback, true, 'target fallback reaches launcher ranking')
assert.equal(fallbackItem.persistPayload?.fallback, true, 'persisted target keeps fallback semantics')

// Process mode helper
const processesSrc = readFileSync('src/workspace/desktopControl/processes.ts', 'utf8')
assert.match(processesSrc, /isProcessModeQuery/)
// "Process rows are not usage-recorded" moved out of processes.ts into
// shouldRecordUsage's kind allowlist (same stale assertion as in
// test-desktop-window-process-contract). Assert it where it now lives.
{
  const toItem = readFileSync('src/workspace/desktopTargets/toLauncherItem.ts', 'utf8')
  const allowlist = /export function shouldRecordUsage[\s\S]*?\n}/.exec(toItem)?.[0] ?? ''
  assert.ok(allowlist, 'shouldRecordUsage must exist')
  assert.doesNotMatch(allowlist, /target\.kind === 'process'/, 'process rows must not record usage')
}

// surfaces force in toLauncherItem
assert.match(readFileSync('src/workspace/desktopTargets/toLauncherItem.ts', 'utf8'), /surfaces:\s*\[\s*'global-launcher'\s*\]/)

console.log('desktop target registry + toLauncherItem contracts passed')
