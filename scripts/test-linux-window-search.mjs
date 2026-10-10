#!/usr/bin/env node
/** Behavioral contract for explicit, session-scoped Linux window search. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const nodeRequire = createRequire(import.meta.url)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve() }

function harness(platform = 'linux') {
  const calls = []
  const logs = []
  const idle = []
  const overrides = new Map()
  const modules = new Map()
  const state = { session: 1, instance: 7, now: 1000, titles: ['Alpha synthetic window', 'Beta synthetic window'] }
  const invoke = async (command, args) => {
    calls.push({ command, args })
    if (overrides.has(command)) return overrides.get(command)(args)
    if (command === 'get_desktop_window_platform') return platform
    if (command === 'get_desktop_window_search_session') return { session: state.session, instance: state.instance }
    if (command === 'release_desktop_window_search_session') {
      if (args.request.session === state.session) state.session += 1
      return
    }
    if (command === 'list_desktop_windows') {
      if (platform === 'linux') assert.equal(args.request.explicit, true)
      return state.titles.map((title, i) => ({ id: platform === 'linux' ? `x11:${state.session}:${i}` : String(i + 1), title, appName: 'Fixture App', pid: 43 }))
    }
    if (command === 'list_desktop_windows_enriched') return []
    if (command === 'focus_desktop_window') return
    throw new Error(`Unexpected command: ${command}`)
  }
  const load = (relative) => {
    const file = path.resolve(root, relative)
    if (modules.has(file)) return modules.get(file)
    const source = readFileSync(file, 'utf8')
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
    }).outputText
    const module = { exports: {} }
    modules.set(file, module.exports)
    const require = (specifier) => {
      if (specifier === '@tauri-apps/api/core') return { invoke }
      if (specifier.endsWith('/i18n')) return { pickLocale: (locale, zh, en) => locale === 'zh' ? zh : en }
      if (specifier.endsWith('/appLauncher/hostAppLauncher')) return { resolveInstalledAppIdByName: () => undefined }
      if (specifier.endsWith('/scheduleIdleWork')) return { scheduleIdleWork: (fn) => { idle.push(fn); return () => {} } }
      if (specifier === 'pinyin-pro') return nodeRequire(specifier)
      if (specifier === './audit') return { auditL2Action: () => { throw new Error('Unexpected close audit') } }
      if (specifier.endsWith('/launcher/favoriteSuggestion')) return { shouldSuggestFavorite: () => false }
      if (specifier.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), `${specifier}.ts`)))
      throw new Error(`Unexpected import: ${specifier}`)
    }
    vm.runInNewContext(output, {
      module, exports: module.exports, require,
      console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
      window: { __TAURI_INTERNALS__: {}, dispatchEvent: () => {}, addEventListener: () => {}, removeEventListener: () => {} },
      CustomEvent: class CustomEvent {},
      Date: class extends Date { static now() { return state.now } },
      setTimeout, clearTimeout, Promise, Error, AbortController,
    }, { filename: file })
    return module.exports
  }
  const windows = load('src/workspace/desktopControl/windows.ts')
  windows.setDesktopWindowRootSearchEnabled(true)
  windows.setDesktopWindowSearchVisibilityGuard(() => true)
  const context = (query) => ({ query, surfaceId: 'global-launcher', locale: 'en' })
  return { calls, logs, idle, overrides, state, windows, load, context, list: (query) => windows.getHostWindowLauncherDynamicItems(context(query)) }
}

{
  const h = harness()
  h.windows.prefetchDesktopWindowsOnStartup()
  await settle()
  assert.equal(h.idle.length, 0, 'Linux must not schedule startup window work')
  assert.equal((await h.windows.listDesktopWindowsCached({ force: true, immediate: true })).length, 0)
  for (const query of ['', 'Alpha', 'close Alpha', '关闭 Alpha', 'focus Alpha', 'switch Alpha', 'windowless', 'my window Alpha']) {
    assert.equal((await h.list(query)).length, 0, `ordinary/close intent must not enumerate: ${query}`)
  }
  const provider = h.load('src/workspace/desktopTargets/windowProvider.ts').hostWindowTargetProvider
  assert.equal((await provider.list(h.context('Alpha'))).length, 0, 'provider must share the explicit gate')
  assert.equal(h.calls.filter((c) => c.command !== 'get_desktop_window_platform').length, 0, 'no session/list/enrich before explicit intent')
  h.windows.setDesktopWindowRootSearchEnabled(false)
  assert.equal((await h.list('window Alpha')).length, 0, 'a retained root query behind another command must not enumerate')
  assert.equal(h.calls.some((c) => c.command === 'get_desktop_window_search_session'), false)
  h.windows.setDesktopWindowRootSearchEnabled(true)
  h.windows.setDesktopWindowSearchVisibilityGuard(() => false)
  assert.equal((await h.list('window Alpha')).length, 0, 'settings/tool overlays must block the retained root query')
  assert.equal((await h.windows.listSwitchableWindowsForFilter('', 'en')).length, 0, 'covered L2 must not enumerate either')
  assert.equal(h.calls.some((c) => c.command === 'get_desktop_window_search_session'), false)
  h.windows.setDesktopWindowSearchVisibilityGuard(() => true)

  const [alpha] = await h.list('window Alpha')
  assert.match(alpha.display.title, /Alpha/)
  assert.equal(alpha.recordUsage, false)
  assert.equal(alpha.experienceRecord, false)
  assert.equal(alpha.legacyUsageKeys, undefined)
  const [beta] = await h.list('窗口：Beta')
  assert.match(beta.display.title, /Beta/)
  assert.equal(h.calls.filter((c) => c.command === 'list_desktop_windows').length, 1, 'typing filters the live snapshot')
  assert.equal(h.calls.some((c) => c.command === 'list_desktop_windows_enriched'), false)
  assert.equal((await h.list('close Alpha')).length, 0, 'a warm Linux cache must not unlock close')
  assert.equal((await alpha.execute()).ok, true)
  const focus = h.calls.find((c) => c.command === 'focus_desktop_window')
  assert.equal(focus.args.id, 'x11:1:0')
  assert.equal(focus.args.request.session, 1)
  assert.equal(JSON.stringify(h.calls).includes('Alpha synthetic'), false, 'titles never travel back as identifiers')

  const targets = await provider.list(h.context('window'))
  assert.equal(targets.length, 2)
  assert.equal(targets[0].persistable, false)
  const mapped = h.load('src/workspace/desktopTargets/toLauncherItem.ts').desktopTargetToLauncherItem(targets[0], { locale: 'en', provider })
  assert.equal(mapped.recordUsage, false)
  assert.equal(mapped.experienceRecord, false)
  assert.equal(mapped.persistPayload, undefined)
  assert.equal((await mapped.execute()).ok, true)
  assert.equal(h.logs.length, 0, 'DesktopTarget activation must not log window title/token')

  await h.windows.releaseDesktopWindowSearch()
  const before = h.calls.filter((c) => c.command === 'focus_desktop_window').length
  assert.equal((await alpha.execute()).ok, false, 'old result must fail after leaving the scope')
  assert.equal(h.calls.filter((c) => c.command === 'focus_desktop_window').length, before)
  assert.equal((await h.list('Alpha')).length, 0, 'old titles must not reappear in ordinary search')
  const [fresh] = await h.list('切到 Alpha')
  assert.notEqual(fresh.systemKey, alpha.systemKey)
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  h.state.titles = ['Same title', 'Same title']
  const rows = await h.list('window Same')
  assert.equal(rows.length, 2, 'same-title windows are not deduplicated')
  assert.notEqual(rows[0].systemKey, rows[1].systemKey)
  const command = h.load('src/workspace/desktopControl/switchWindowCommand.ts').getSwitchWindowHostItem()
  const prepared = await command.prepare({})
  assert.equal(prepared.recordUsage, false, 'L2 parent usage must also be disabled')
  assert.equal(prepared.experienceRecord, false)
  const result = await prepared.execute({ input: { text: 'Same' }, locale: 'en' })
  assert.equal(result.ok, false, 'ambiguous free text must not focus the first window')
  assert.equal(h.calls.some((c) => c.command === 'focus_desktop_window'), false)
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  h.state.titles = ['HivenWindow Alpha', 'HivenWindow Beta']
  const ranking = h.load('src/workspace/launcher/ranking.ts')
  const rank = (query, rows) => ranking.rankLauncherItems({
    query, locale: 'en', surfaceId: 'global-launcher', usage: {}, now: h.state.now,
  }, rows)
  // This uses the real searchRanking + rankLauncherItems modules. The native
  // list is the only fixture: provider matches must survive the final UI rank.
  for (const query of ['window HivenWindow', '窗口 HivenWindow', '切到：HivenWindow']) {
    const rows = await h.list(query)
    assert.equal(rows.length, 2)
    assert.equal(rank(query, rows).length, 2, `prefixed results must survive shared ranking: ${query}`)
  }
  assert.equal((await h.list('window Missing')).length, 0, 'query alias only exists after an actual window match')
  const [alpha] = await h.list('window Alpha')
  const [beta] = await h.list('window Beta')
  assert.equal(rank('window Beta', [alpha]).length, 0, 'previous query row must not match an unrelated replacement query')
  assert.equal(rank('window Beta', [beta]).length, 1)
  assert.equal(beta.display.aliases.includes('window Alpha'), false, 'query aliases must not accumulate in the shared native snapshot')
  assert.equal(alpha.display.aliases.includes('window Beta'), false, 'new query must not mutate an older result object')
  const query = 'window HivenWindow'
  const provider = h.load('src/workspace/desktopTargets/windowProvider.ts').hostWindowTargetProvider
  const targets = await provider.list(h.context(query))
  assert.ok(targets.every((target) => target.keywords.includes(query)), 'DesktopTarget keywords must retain the same transient query match')
  const { desktopTargetToLauncherItem } = h.load('src/workspace/desktopTargets/toLauncherItem.ts')
  const mapped = targets.map((target) => desktopTargetToLauncherItem(target, { locale: 'en', provider }))
  assert.equal(rank(query, mapped).length, 2, 'DesktopTarget round trip must also survive shared ranking')
  assert.ok(mapped.every((row) => row.recordUsage === false && row.experienceRecord === false))
  assert.equal((await h.list('HivenWindow')).length, 0, 'transient query aliases must not enable ordinary Linux searches')
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  const [row] = await h.list('window Alpha')
  h.overrides.set('focus_desktop_window', () => { throw new Error('x11-window-unavailable') })
  const result = await row.execute()
  assert.equal(result.ok, false)
  assert.match(result.message, /closed, hidden, or became unavailable/)
  await settle()
  assert.equal(h.windows.hasLinuxDesktopWindowSearch(), false, 'failed focus invalidates the stale snapshot')
  assert.equal(h.calls.filter((c) => c.command === 'focus_desktop_window').length, 1, 'failed focus must never try another window/app')
  h.overrides.delete('focus_desktop_window')
  const [fresh] = await h.list('window Alpha')
  assert.notEqual(fresh.systemKey, row.systemKey)
  assert.equal((await fresh.execute()).ok, true)
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  h.overrides.set('list_desktop_windows', () => { throw new Error('x11-window-unsupported') })
  const rows = await h.list('window Alpha')
  assert.equal(rows.length, 1, 'root search must show unsupported status, not a fake empty success')
  assert.match(rows[0].display.title, /X11.*Wayland/)
  assert.ok(rows[0].disabledReason)
  assert.equal((await rows[0].execute()).ok, false)
  const command = h.load('src/workspace/desktopControl/switchWindowCommand.ts').getSwitchWindowHostItem()
  const output = await command.suggest({ inputText: '', locale: 'zh' })
  assert.equal(output.choices.length, 1)
  assert.match(output.choices[0].title, /X11.*Wayland/)
  assert.equal((await output.choices[0].primaryAction()).ok, false)
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  const list = deferred()
  h.overrides.set('list_desktop_windows', () => list.promise)
  const command = h.load('src/workspace/desktopControl/switchWindowCommand.ts').getSwitchWindowHostItem()
  const first = command.suggest({ inputText: 'A', locale: 'en' })
  await settle()
  const latest = command.suggest({ inputText: 'Al', locale: 'en' })
  const rootQuery = h.list('window Al')
  await settle()
  list.reject(new Error('x11-window-unsupported'))
  const [oldOutput, latestOutput, rootRows] = await Promise.all([first, latest, rootQuery])
  for (const output of [oldOutput, latestOutput]) {
    assert.equal(output.choices.length, 1, 'shared list failure must remain visible to every current L2 query')
    assert.match(output.choices[0].title, /X11.*Wayland/)
  }
  assert.equal(rootRows.length, 1, 'root query sharing the failure must retain its status too')
  await settle()
  assert.equal(h.calls.filter((c) => c.command === 'release_desktop_window_search_session').length, 1, 'shared failure releases its snapshot exactly once')
  h.overrides.delete('list_desktop_windows')
  assert.equal((await h.list('window Alpha')).length, 1, 'next explicit query can acquire a fresh native session')
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  const platform = deferred()
  h.overrides.set('get_desktop_window_platform', () => platform.promise)
  const old = h.list('window Alpha')
  await h.windows.releaseDesktopWindowSearch()
  platform.resolve('linux')
  assert.equal((await old).length, 0)
  assert.equal(h.calls.some((c) => c.command === 'get_desktop_window_search_session'), false, 'late platform result cannot start cancelled enumeration')
}

{
  const h = harness()
  const session = deferred()
  h.overrides.set('get_desktop_window_search_session', () => session.promise)
  const old = h.list('window Alpha')
  await settle()
  const release = h.windows.releaseDesktopWindowSearch()
  session.resolve({ session: 1, instance: 7 })
  await release
  assert.equal((await old).length, 0)
  assert.equal(h.calls.some((c) => c.command === 'list_desktop_windows'), false, 'late session reply cannot enumerate after close')
}

{
  const h = harness()
  const list = deferred()
  h.overrides.set('list_desktop_windows', () => list.promise)
  const old = h.list('window Alpha')
  await settle()
  await h.windows.releaseDesktopWindowSearch()
  h.overrides.delete('list_desktop_windows')
  const next = await h.list('window Beta')
  list.resolve([{ id: 'x11:1:0', title: 'Late title', appName: 'Fixture App', pid: 43 }])
  assert.equal((await old).length, 0, 'late native list must not revive a closed scope')
  assert.equal((await next[0].execute()).ok, true, 'late result cannot release/replace the new search')
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness()
  const list = deferred()
  h.overrides.set('list_desktop_windows', () => list.promise)
  const old = h.windows.listSwitchableWindowsForFilter('Alpha', 'en')
  await settle()
  await h.windows.releaseDesktopWindowSearch()
  h.overrides.delete('list_desktop_windows')
  const next = await h.list('window Beta')
  list.reject(new Error('x11-window-expired'))
  assert.equal((await old).length, 0, 'late L2 failure must be discarded')
  assert.equal((await next[0].execute()).ok, true, 'late L2 failure must not release the replacement scope')
  await h.windows.releaseDesktopWindowSearch()
}

{
  const h = harness('macos')
  h.windows.prefetchDesktopWindowsOnStartup()
  await settle()
  assert.equal(h.idle.length, 1, 'Mac retains startup prefetch')
  h.idle[0]()
  await settle()
  const rows = await h.list('Alpha')
  assert.equal(rows.length, 1, 'Mac retains ordinary title search')
  assert.equal(rows[0].recordUsage, true)
  assert.equal(rows[0].experienceRecord, undefined)
  assert.equal((await rows[0].execute()).ok, true)
  assert.equal(h.calls.find((c) => c.command === 'focus_desktop_window').args.request, undefined)
  assert.equal((await h.list('close Alpha')).length, 1, 'Mac retains close-prefix items')
}

{
  // Execute the actual panel callbacks and keyboard router. Only React element
  // construction and the store boundary are mocked; no copy of the pin guard.
  const h = harness()
  const writes = []
  const store = { launcherFavoriteKeys: [], toggleLauncherFavorite: (...args) => writes.push(args) }
  const keyboard = h.load('src/components/launcher/GlobalLauncherKeyboard.ts')
  const shortcuts = h.load('src/components/launcher/launcherParamShortcuts.ts')
  const jsx = (type, props) => ({ type, props })
  const module = { exports: {} }
  const source = readFileSync('src/components/launcher/GlobalLauncherPanel.tsx', 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const require = (id) => {
    if (id === 'react') return { useCallback: (fn) => fn, useMemo: (fn) => fn(), useEffect: () => {}, useRef: (current) => ({ current }) }
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (id === '../../i18n') return { t: (_locale, key) => key }
    if (id === '../../store') return { useAppStore: (select) => select(store) }
    if (id === './GlobalLauncherKeyboard') return keyboard
    if (id === './launcherParamShortcuts') return shortcuts
    if (id === './GlobalLauncherFrames') return { GlobalLauncherFrameSwitch: 'FrameSwitch' }
    if (id === './LauncherView') return { LauncherView: 'LauncherView' }
    if (id === './GlobalLauncherLayout') return { GLOBAL_LAUNCHER_SETTINGS_HEIGHT: 400, STANDALONE_SURFACE_MAX_HEIGHT: 600 }
    if (id.endsWith('/hostActions')) return {}
    if (id.endsWith('/toast')) return { showToast: () => { throw new Error('Unexpected favorite failure') } }
    throw new Error(`Unexpected panel import: ${id}`)
  }
  vm.runInNewContext(code, { module, exports: module.exports, require, console, Set })
  const row = (id) => ({ id, title: 'Synthetic window', kind: 'domain', domainItem: { systemKey: id, display: { title: 'Synthetic window' } } })
  const linux = row('host.window:focus:native:x11:ephemeral')
  const mac = row('host.window:focus:native:123')
  const command = row('host:window:switch-command')
  const availableItems = [linux, mac, command]
  const availableItemKeys = new Set(availableItems.map((item) => item.id))
  const render = (selectedItem) => module.exports.GlobalLauncherPanel({
    selectedItem, visibleFiltered: availableItems, availableItemKeys, locale: 'en', query: 'window Synthetic',
    controllerState: { frames: [{ kind: 'list' }], busy: false }, controllerRef: { current: null },
    isImeComposingRef: { current: false }, isKeyboardNavRef: { current: false },
    isWorkflowObjectLauncherItem: () => false, setSelectedIndex: () => {},
  })
  const linuxPanel = render(linux)
  const frame = linuxPanel.props.children
  assert.equal(frame.props.pinnableItemKeys.has(linux.id), false, 'transient rows must not show pin controls/hints')
  assert.equal(frame.props.visibleFiltered.includes(linux), true, 'pin eligibility must not remove searchable/executable rows')
  assert.equal(availableItemKeys.has(linux.id), true, 'upstream available-item set is unchanged')
  frame.props.onToggleSearchFavorite(linux)
  const ctrlP = () => ({ key: 'p', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, preventDefault() {}, stopPropagation() {}, target: null })
  linuxPanel.props.onKeyDown(ctrlP())
  assert.equal(writes.length, 0, 'both mouse callback and actual Ctrl+P handler must refuse the transient token')
  for (const stable of [mac, command]) {
    const panel = render(stable)
    assert.equal(panel.props.children.props.pinnableItemKeys.has(stable.id), true)
    panel.props.children.props.onToggleSearchFavorite(stable)
    panel.props.onKeyDown(ctrlP())
  }
  assert.deepEqual(writes.map(([key]) => key), [mac.id, mac.id, command.id, command.id], 'Mac and stable command pin behavior is preserved')
}

console.log('Linux explicit window-search behavior tests passed')
