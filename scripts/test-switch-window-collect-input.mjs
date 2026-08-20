#!/usr/bin/env node
/**
 * Switch Window must be a first-level host command with collect-input + suggest
 * (windows-only second level), while global mix still uses dynamic window items.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = process.cwd()

function loadSwitchCommand() {
  const file = path.join(root, 'src/workspace/desktopControl/switchWindowCommand.ts')
  let src = readFileSync(file, 'utf8')
  src = src.replace(/from '\.\/windows'/g, "from '__windows__'")
  src = src.replace(/from '\.\.\/launcher\/types'/g, "from '__types__'")
  // switchWindowCommand grew a pickLocale import; stub it rather than pulling the
  // whole i18n registry into the sandbox.
  src = src.replace(/from '\.\.\/\.\.\/i18n'/g, "from '__i18n__'")
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText

  const fakeWindows = [
    {
      win: { id: 'w1', appName: 'Google Chrome', title: 'Docs', pid: 11, appId: 'macos:bundle:com.google.Chrome' },
      title: 'Docs',
      subtitle: 'Google Chrome',
      icon: 'app-icon:macos:bundle:com.google.Chrome',
    },
    {
      win: { id: 'w2', appName: 'Code', title: 'flux_text', pid: 22 },
      title: 'flux_text',
      subtitle: 'Code',
      icon: 'AppWindow',
    },
    {
      win: { id: 'w3', appName: 'Finder', title: 'Downloads', pid: 33 },
      title: 'Downloads',
      subtitle: 'Finder',
      icon: 'AppWindow',
    },
  ]

  let focusedId = null
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    require: (spec) => {
      if (spec === '__windows__') {
        return {
          focusDesktopWindow: async (id) => {
            focusedId = id
          },
          listSwitchableWindowsForFilter: async (filter) => {
            const needle = String(filter || '').toLowerCase().trim()
            if (!needle) return fakeWindows
            return fakeWindows.filter(
              (e) =>
                e.title.toLowerCase().includes(needle) ||
                e.subtitle.toLowerCase().includes(needle) ||
                e.win.appName.toLowerCase().includes(needle),
            )
          },
        }
      }
      if (spec === '__types__') return {}
      if (spec === '__i18n__') {
        return { pickLocale: (locale, zh, en) => (String(locale).startsWith('zh') ? zh : en) }
      }
      throw new Error(`unexpected require ${spec}`)
    },
  }
  vm.runInNewContext(out, sandbox)
  return { mod: moduleExports, getFocusedId: () => focusedId }
}

const { mod, getFocusedId } = loadSwitchCommand()
const item = mod.getSwitchWindowHostItem()

assert.equal(item.systemKey, 'host:window:switch-command')
assert.equal(item.behavior?.type, 'collect-input', 'must use collect-input second level')
assert.equal(typeof item.suggest, 'function', 'must provide suggest for window list')
assert.ok(item.surfaces?.includes('global-launcher'))
assert.ok(item.display.aliases?.some((a) => a === '切换窗口' || a === 'switch window'))
assert.equal(item.display.titleI18n?.zh, '切换窗口')

// Empty filter → all windows as suggestion choices
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
assert.ok(all?.choices?.length >= 3, 'empty second-level input lists windows')
assert.ok(all.choices.every((c) => c.id.startsWith('window:')), 'only real window rows')
assert.ok(all.choices.every((c) => typeof c.icon === 'string' && c.icon.length > 0), 'window rows must carry icons')

const chrome = all.choices.find((c) => /Docs|Chrome/i.test(c.title) || /Chrome/i.test(c.subtitle || ''))
assert.equal(chrome?.icon, 'app-icon:macos:bundle:com.google.Chrome', 'window with appId must use app-icon')

// No matches → empty choices
const none = await item.suggest({
  surfaceId: 'global-launcher',
  inputText: 'zzzz-no-such-window',
  settings: {},
  locale: 'zh',
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
assert.equal(none?.choices?.length ?? 0, 0, 'no matches must return empty choices')

// Filter
const filtered = await item.suggest({
  surfaceId: 'global-launcher',
  inputText: 'flux',
  settings: {},
  locale: 'zh',
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
assert.ok(filtered?.choices?.length >= 1)
assert.ok(filtered.choices.some((c) => /flux/i.test(c.title)))

// Selecting a choice focuses immediately (no confirm step for focus)
const result = await filtered.choices[0].primaryAction()
assert.equal(result.ok, true)
assert.equal(getFocusedId(), 'w2')

// Unique free-text execute focuses
const unique = await item.execute({
  surfaceId: 'global-launcher',
  locale: 'en',
  input: { text: 'Downloads' },
  settings: {},
  api: {},
  storage: {},
  network: {},
  t: (k) => k,
})
assert.equal(unique.ok, true)
assert.equal(getFocusedId(), 'w3')

// Host wires static command AND keeps dynamic global mix
const host = readFileSync('src/workspace/launcher/hostProvider.ts', 'utf8')
assert.match(host, /getSwitchWindowHostItem/, 'host must register switch window as static item')
assert.match(host, /getHostWindowLauncherDynamicItems/, 'host must keep global window mix')

// windows.ts exports filter helper used by L2
const windowsSrc = readFileSync('src/workspace/desktopControl/windows.ts', 'utf8')
assert.match(windowsSrc, /export async function listSwitchableWindowsForFilter/, 'must export L2 list helper')
assert.match(windowsSrc, /export async function focusDesktopWindow/, 'must export focus helper')

console.log('switch window collect-input second-level checks passed')
