#!/usr/bin/env node
/**
 * Kill Process must be a first-level host command with collect-input + suggest
 * (same second-level UX as web-open), not a search-prefix mode.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()

function loadKillCommand() {
  const file = path.join(root, 'src/workspace/desktopControl/killProcessCommand.ts')
  let src = readFileSync(file, 'utf8')
  // Stub relative imports
  src = src.replace(/from '\.\/audit'/g, "from '__audit__'")
  src = src.replace(/from '\.\/processes'/g, "from '__processes__'")
  src = src.replace(/from '\.\.\/launcher\/types'/g, "from '__types__'")
  src = src.replace(/from '\.\.\/\.\.\/i18n'/g, "from '__i18n__'")
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText

  const fakeProcesses = [
    { pid: 11, name: '/usr/bin/node', cpuPercent: 12.5, memoryBytes: 180 * 1024 * 1024 },
    { pid: 22, name: 'Google Chrome', cpuPercent: 3.1, memoryBytes: 512 * 1024 * 1024, appId: 'macos:bundle:com.google.Chrome' },
    { pid: 33, name: 'node-helper', cpuPercent: 0.2, memoryBytes: 40 * 1024 * 1024 },
  ]

  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    require: (spec) => {
      if (spec === '__audit__') return { auditL2Action: () => {} }
      if (spec === '__processes__') {
        return {
          clearDesktopProcessListCache: () => {},
          listDesktopProcessesCached: async (q) => {
            if (q === '*') return fakeProcesses
            const needle = String(q).toLowerCase()
            return fakeProcesses.filter(
              (p) => p.name.toLowerCase().includes(needle),
            )
          },
        }
      }
      if (spec === '__types__' || spec === '__i18n__') return {}
      throw new Error(`unexpected require ${spec}`)
    },
  }
  vm.runInNewContext(out, sandbox)
  return moduleExports
}

const mod = loadKillCommand()
const item = mod.getKillProcessHostItem()

assert.equal(item.systemKey, 'host:process:kill-command')
assert.equal(item.behavior?.type, 'collect-input', 'must use collect-input second level')
assert.equal(typeof item.suggest, 'function', 'must provide suggest for process list')
assert.ok(item.surfaces?.includes('global-launcher'))
assert.ok(item.display.aliases?.some((a) => a === 'kill' || a === '杀'))

// Empty filter → all processes as suggestion choices
const all = await item.suggest({
  surfaceId: 'global-launcher',
  inputText: '',
  settings: {},
  locale: 'en',
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
assert.ok(all?.choices?.length >= 3, 'empty second-level input lists processes')
assert.ok(all.choices.every((c) => c.id.startsWith('process:')), 'only real process rows (no fake empty choice)')
assert.match(all.choices[0].subtitle || '', /CPU|MEM|pid/, 'process row should show CPU/MEM/pid')

// Prefer real app icon when native provides appId
const withIcon = await item.suggest({
  surfaceId: 'global-launcher',
  inputText: '',
  settings: {},
  locale: 'en',
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
// When processes have no appId, icon is lucide fallback; when appId present → app-icon:
assert.ok(withIcon.choices.every((c) => typeof c.icon === 'string' && c.icon.length > 0), 'process rows must carry icons')
const chrome = withIcon.choices.find((c) => /Chrome/i.test(c.title))
assert.equal(chrome?.icon, 'app-icon:macos:bundle:com.google.Chrome', 'process with appId must use app-icon')

// No matches → empty choices (CollectInputFrame renders empty state; no process-empty row)
const none = await item.suggest({
  surfaceId: 'global-launcher',
  inputText: 'zzzz-no-such-process',
  settings: {},
  locale: 'zh',
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
assert.equal(none?.choices?.length ?? 0, 0, 'no matches must return empty choices, not a fake row')

// Filter "node"
const filtered = await item.suggest({
  surfaceId: 'global-launcher',
  inputText: 'node',
  settings: {},
  locale: 'zh',
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
assert.ok(filtered?.choices?.length >= 1)
assert.ok(filtered.choices.some((c) => /node/i.test(c.title)))

// Selecting a choice returns L2 confirm (two choices)
const confirm = await filtered.choices[0].primaryAction()
assert.equal(confirm.ok, true)
assert.ok(confirm.output?.choices?.length === 2, 'L2 confirm + cancel')
assert.ok(
  confirm.output.choices.some((c) => c.id.includes('confirm')),
  'must include confirm action',
)

// Host wires the static command
const host = readFileSync('src/workspace/launcher/hostProvider.ts', 'utf8')
assert.match(host, /getKillProcessHostItem/, 'host must register kill command as static item')
assert.doesNotMatch(
  host,
  /getHostProcessLauncherDynamicItems/,
  'host must NOT put processes on first-level dynamic list',
)

// Session must not implement search-prefix process mode
const session = readFileSync('src/workspace/launcher/useLauncherSession.ts', 'utf8')
assert.doesNotMatch(session, /isProcessModeQuery|process-mode/, 'session must not use prefix process mode')

console.log('kill process collect-input second-level checks passed')
