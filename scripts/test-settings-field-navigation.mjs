#!/usr/bin/env node
// Real navigation lifetime and schema renderer, with synthetic DOM and values.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, console,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency: ${name}`)
      return modules[name]
    },
  }, { filename: path })
  return exports
}
const navigation = load('src/components/pluginSettingsFieldNavigation.ts')

function fixture() {
  const frames = new Map(), observers = new Set(), listeners = new Map()
  let nextFrame = 0
  const document = {
    activeElement: null,
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event, fn) => { if (listeners.get(event) === fn) listeners.delete(event) },
  }
  document.defaultView = {
    getComputedStyle: (node) => ({ display: node.display ?? 'block', visibility: node.visibility ?? 'visible' }),
    requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame },
    cancelAnimationFrame: (id) => frames.delete(id),
    MutationObserver: class {
      constructor(callback) { this.callback = callback }
      observe() { observers.add(this) }
      disconnect() { observers.delete(this) }
    },
  }
  class Element {
    constructor(kind = 'div', dataset = {}) {
      this.kind = kind; this.dataset = dataset; this.children = []; this.parentElement = null
      this.ownerDocument = document; this.isConnected = true; this.tabIndex = -1
      this.hidden = false; this.inert = false; this.attrs = {}; this.focusCount = 0; this.scrollCount = 0
    }
    append(node) { this.children.push(node); node.parentElement = this; return node }
    getAttribute(key) { return this.attrs[key] ?? null }
    getClientRects() { return this.hidden || this.display === 'none' ? [] : [{}] }
    querySelectorAll(selector) {
      assert.ok(['[data-settings-section-id]', '[data-settings-field-key]', 'input, textarea, select, [role="switch"], [role="combobox"]'].includes(selector), 'schema IDs must not be interpolated into selectors')
      const all = this.children.flatMap((node) => [node, ...node.descendants()])
      if (selector === '[data-settings-section-id]') return all.filter((node) => node.dataset.settingsSectionId !== undefined)
      if (selector === '[data-settings-field-key]') return all.filter((node) => node.dataset.settingsFieldKey !== undefined)
      return all.filter((node) => ['input', 'textarea', 'select'].includes(node.kind) || ['switch', 'combobox'].includes(node.attrs.role))
    }
    descendants() { return this.children.flatMap((node) => [node, ...node.descendants()]) }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector === '[data-settings-section-id]' && node.dataset.settingsSectionId !== undefined) return node
        if (selector === '[aria-disabled="true"], [inert]' && (node.attrs['aria-disabled'] === 'true' || node.inert)) return node
      }
      return null
    }
    matches() { return this.disabled || this.attrs.disabled !== undefined || this.attrs.type === 'hidden' }
    focus() { if (!this.refuseFocus) { document.activeElement = this; this.focusCount++ } }
    scrollIntoView() { this.scrollCount++ }
  }
  const root = new Element()
  const section = root.append(new Element('section', { settingsSectionId: 'limits' }))
  function field(key, kind = 'number') {
    const wrapper = section.append(new Element('div', { settingsFieldKey: key, settingsFieldKind: kind, settingsFieldDisabled: 'false' }))
    const input = wrapper.append(new Element(kind === 'select' || kind === 'switch' ? 'button' : 'input'))
    input.tabIndex = 0
    if (kind === 'select') input.attrs.role = 'combobox'
    if (kind === 'switch') input.attrs.role = 'switch'
    return { wrapper, input }
  }
  return {
    root, section, field, document, Element, frames, observers,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback()) },
    mutate() { [...observers].forEach((observer) => observer.callback()) },
    interact(event = 'pointerdown') { listeners.get(event)?.() },
  }
}

test('focuses the actual number input, never preceding buttons, and scrolls only once', () => {
  const page = fixture()
  const { wrapper, input } = page.field('cache')
  wrapper.children.unshift(new page.Element('button'))
  navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'cache' })
  page.flush()
  assert.equal(page.document.activeElement, input)
  assert.equal(wrapper.scrollCount, 1)
  assert.equal(page.observers.size, 0)
  page.section.focus(); page.mutate(); page.flush()
  assert.equal(page.document.activeElement, page.section)
  assert.equal(wrapper.scrollCount, 1, 'ordinary rerenders must not pull the user back')
})

test('stable IDs containing CSS punctuation are matched literally within their section', () => {
  const page = fixture()
  page.section.dataset.settingsSectionId = 'limits"] #foreign'
  const { input } = page.field('key"] [data-secret]')
  navigation.navigateToPluginSettingsField(page.root, { sectionId: page.section.dataset.settingsSectionId, fieldKey: 'key"] [data-secret]' })
  page.flush()
  assert.equal(page.document.activeElement, input)
})

test('focus-only select and switch navigation does not dispatch or activate anything', () => {
  for (const kind of ['select', 'switch', 'text', 'textarea', 'list']) {
    const page = fixture()
    const { input } = page.field('setting', kind)
    input.click = input.dispatchEvent = () => assert.fail('Navigation cannot activate a control')
    navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'setting' })
    page.flush()
    assert.equal(page.document.activeElement, input)
  }
})

test('disabled, permission-gated, action, modal and compound fields focus the readable section', () => {
  for (const reason of ['disabled-field', 'disabled-control', 'permission', 'hidden-control', 'action', 'modal', 'object-list']) {
    const page = fixture()
    const { wrapper, input } = page.field('setting', ['action', 'modal', 'object-list'].includes(reason) ? reason : 'text')
    if (reason === 'disabled-field') wrapper.dataset.settingsFieldDisabled = 'true'
    if (reason === 'disabled-control') input.disabled = true
    if (reason === 'permission') input.attrs['aria-disabled'] = 'true'
    if (reason === 'hidden-control') input.hidden = true
    navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'setting' })
    page.flush()
    assert.equal(page.document.activeElement, page.section, reason)
    assert.equal(input.focusCount, 0)
  }
})

test('missing and hidden fields use their section, then locate a delayed visible field once', () => {
  for (const hidden of [false, true]) {
    const page = fixture()
    const first = hidden ? page.field('later') : null
    if (first) first.wrapper.hidden = true
    navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'later' })
    page.flush()
    assert.equal(page.document.activeElement, page.section)
    page.mutate(); page.flush()
    assert.equal(page.section.focusCount, 1)
    const later = first ?? page.field('later')
    later.wrapper.hidden = false
    page.mutate(); page.flush()
    assert.equal(page.document.activeElement, later.input)
    assert.equal(page.observers.size, 0)
  }
})

test('user interaction or unmount cancels late navigation and queued frames', () => {
  for (const cancel of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'unmount']) {
    const page = fixture()
    const stop = navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'later' })
    page.flush()
    const { input } = page.field('later')
    page.mutate()
    if (cancel === 'unmount') stop()
    else page.interact(cancel)
    page.flush()
    assert.equal(input.focusCount, 0, cancel)
    assert.equal(page.observers.size, 0)
    assert.equal(page.frames.size, 0)
  }
})

test('replacing the target cancels the old request before its frame can focus', () => {
  const page = fixture()
  const old = page.field('old'), next = page.field('next')
  const stop = navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'old' })
  stop()
  navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'next' })
  page.flush()
  assert.equal(old.input.focusCount, 0)
  assert.equal(page.document.activeElement, next.input)
})

test('disconnected and visually hidden roots never steal focus', () => {
  for (const mode of ['disconnected', 'visibility']) {
    const page = fixture()
    const { input } = page.field('setting')
    if (mode === 'disconnected') page.root.isConnected = false
    else page.root.visibility = 'hidden'
    const stop = navigation.navigateToPluginSettingsField(page.root, { sectionId: 'limits', fieldKey: 'setting' })
    page.flush()
    assert.equal(input.focusCount, 0)
    stop()
  }
})

// Invoke the actual schema component with hook state held at its initial value.
// This checks the important no-write-on-blur behavior, not styles or snapshots.
const react = require('react')
const renderer = load('src/components/PluginSettingsSchemaRenderer.tsx', {
  react: { ...react, useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}] },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'lucide-react': require('lucide-react'),
  '../workspace/pluginPermissions': { describePluginPermission: () => 'permission' },
  '../i18n': { translate: (_locale, _namespace, key) => key },
  '../plugin-ui': { NumberField: 'NumberField', Select: 'Select', Switch: 'Switch' },
})
function nodes(element) {
  if (!element || typeof element !== 'object') return []
  return [element, ...react.Children.toArray(element.props?.children).flatMap(nodes)]
}
test('the real list renderer never saves an untouched field on navigation blur', () => {
  const writes = []
  const value = { rules: [{ name: 'synthetic' }] }
  const tree = renderer.PluginSettingsSchemaRenderer({
    schema: { sections: [{ id: 'rules-section', fields: [{ kind: 'list', key: 'rules', label: 'Rules' }] }] },
    locale: 'en', value, updateValue: (patch) => writes.push(patch),
    onOpenModal: () => assert.fail('Unexpected modal'), onRunAction: () => assert.fail('Unexpected action'),
  })
  const textarea = nodes(tree).find((node) => node.type === 'textarea')
  assert.ok(textarea)
  textarea.props.onBlur({ currentTarget: { value: textarea.props.defaultValue } })
  assert.equal(writes.length, 0)
  textarea.props.onBlur({ currentTarget: { value: '[{"name":"edited"}]' } })
  assert.equal(writes.length, 1, 'ordinary intentional edits still save')
  assert.equal(writes[0].rules[0].name, 'edited')
  const invalid = { value: '[invalid JSON' }
  textarea.props.onBlur({ currentTarget: invalid })
  assert.equal(writes.length, 1, 'invalid edits must not save')
  assert.equal(invalid.value, textarea.props.defaultValue, 'invalid edits still restore the persisted representation')
})

function actualCallback(path, find, scope) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let expression
  function visit(node) {
    if (find(node)) expression = ts.isVariableDeclaration(node) ? node.initializer : node.initializer.expression
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Actual callback not found in ${path}`)
  const code = ts.transpileModule(`exports.callback = ${expression.getText(source)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, { exports, ...scope }, { filename: path })
  return exports.callback
}
const variable = (name) => (node) => ts.isVariableDeclaration(node) && node.name.getText() === name

test('actual pin eligibility excludes query-only settings fields and X11 targets', () => {
  const keys = [
    'settings-field:builtin:clipboard-history:recording:recordImages',
    'host.window:focus:native:x11:temporary',
    'plugin:test:tool:ordinary',
    'plugin-settings:builtin:test',
  ]
  const pinnable = actualCallback('src/components/launcher/GlobalLauncherPanel.tsx', variable('pinnableItemKeys'), {
    useMemo: (callback) => callback(),
    availableItemKeys: new Set(keys),
  })
  assert.equal(pinnable.has(keys[0]), false, 'query-only fields cannot become unavailable empty-search favorites')
  assert.equal(pinnable.has(keys[1]), false, 'temporary X11 targets retain their existing exclusion')
  assert.equal(pinnable.has(keys[2]), true, 'ordinary tools remain pinnable')
  assert.equal(pinnable.has(keys[3]), true, 'persistent plugin settings entries remain pinnable')
})

test('actual field selection and one Back keep the selected identity after late results reorder it', () => {
  const { resolvePreservedSelection } = load('src/workspace/launcher/selectionPreserve.ts')
  const field = { id: 'domain:field', kind: 'domain', domainItem: { systemKey: 'settings-field:builtin:test:section:field' } }
  const ordinary = { id: 'domain:other', kind: 'domain', domainItem: { systemKey: 'plugin:test:tool:other' } }
  const visible = [field, ordinary]
  const selectedKeyRef = { current: null }, selectedIndexRef = { current: 0 }
  const visibleSelectionItemsRef = { current: visible.map((item) => item.domainItem) }
  const state = { selectedIndex: 0, query: 'settings field', settingsOpen: false, focusCount: 0 }
  const scope = {
    useCallback: (callback) => callback,
    selectedKeyRef, selectedIndexRef, visibleSelectionItemsRef,
    rankedItemsRef: { current: [] }, extraSelectionRowsRef: { current: [] },
    setSelectedIndexState: (next) => { state.selectedIndex = typeof next === 'function' ? next(state.selectedIndex) : next },
    resolvePreservedSelection,
  }
  const setSelectedIndex = actualCallback('src/workspace/launcher/useLauncherSession.ts', variable('setSelectedIndex'), scope)
  const syncSelection = actualCallback('src/workspace/launcher/useLauncherSession.ts', variable('syncSelection'), scope)
  const select = actualCallback('src/launcher/hosts/GlobalLauncherHost.tsx', variable('selectItemWithObjectActions'), {
    useCallback: scope.useCallback, visibleFiltered: visible, setSelectedIndex,
    clipboardBlock: { cancelFileTextRead() {} }, CURRENT_TEXT_EXPORT_ACTION: 'export',
    executeCurrentTextAction() {}, executeCurrentTextExport() {}, executeObjectAction() {}, objectActions: [],
    selectItem: (item) => { state.settingsOpen = item === field },
  })
  select(field)
  assert.equal(selectedKeyRef.current, field.domainItem.systemKey, 'Enter on default top establishes a return identity')
  assert.equal(state.settingsOpen, true)
  visibleSelectionItemsRef.current = [ordinary.domainItem, field.domainItem]
  syncSelection()
  assert.equal(state.selectedIndex, 1, 'late rank results follow the opened field')
  const close = actualCallback('src/components/launcher/GlobalLauncherPanel.tsx',
    (node) => ts.isJsxAttribute(node) && node.name.getText() === 'onSettingsClose', {
      closeSettingsDialog() { state.settingsOpen = false },
      focusSearchInputAfterBack() { state.focusCount++ },
    })
  close()
  assert.equal(state.settingsOpen, false)
  assert.equal(state.query, 'settings field')
  assert.equal(state.selectedIndex, 1)
  assert.equal(state.focusCount, 1)
  selectedKeyRef.current = null
  select(ordinary)
  assert.equal(selectedKeyRef.current, null, 'ordinary action selection keeps its prior behavior')
})
