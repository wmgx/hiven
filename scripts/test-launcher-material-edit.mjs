#!/usr/bin/env node
/** Real controller, classifier and pending bridge; synthetic inputs and memory-only I/O. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
const noop = () => {}
function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, module: { exports }, console, Date, Error, TextEncoder, structuredClone,
    setTimeout, clearTimeout, localStorage: storage,
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unmocked dependency ${name} in ${path}`)
      return modules[name]
    },
  }, { filename: path })
  return exports
}
const translate = (_locale, _namespace, key) => key
const types = load('src/workspace/launcher/types.ts')
const output = load('src/workspace/launcher/output.ts', { './types': types, '../../i18n': { translate } })
const lastRun = load('src/workspace/savedActions/lastSaveableRun.ts')
const content = load('src/kits/content/detectContent.ts')
const snapshot = load('src/launcher/clipboard/clipboardSnapshot.ts', { '../../kits/content/index': content })
const attachPolicy = load('src/launcher/clipboard/attachPolicy.ts', {
  '../../kits/content/index': content, './clipboardSnapshot': snapshot,
})
const blocks = load('src/launcher/clipboard/objectBlock.ts', { '../../kits/content/index': content, './clipboardSnapshot': snapshot, './attachPolicy': attachPolicy })
const material = load('src/launcher/clipboard/currentMaterial.ts')
const pending = load('src/launcher/clipboard/pendingObjectBlock.ts')
let serial = 0
let inputReads = 0
const forbidden = () => { inputReads++; throw new Error('Unexpected input acquisition or external delivery') }
const { LauncherController } = load('src/workspace/launcher/controller.ts', {
  './pluginLifetime': load('src/workspace/launcher/pluginLifetime.ts'),
  './output': output, '../../i18n': { translate },
  './foregroundSelectionCapture': { captureForegroundSelectionText: forbidden },
  '../usageJournal': { appendUsageJournal: forbidden },
  '../telemetry': { TelemetryEvents: {}, itemTelemetryProps: () => ({}), trackBehavior: noop, trackLatencyFrom: noop, telemetryNow: () => 0 },
  '../experience/journal': { newExperienceId: (prefix) => `${prefix}-${++serial}`, currentExperienceSessionId: (id) => id, appendExperienceEvent: forbidden },
  '../experience/errorType': load('src/workspace/experience/errorType.ts'),
  '../contentBoundary': load('src/workspace/contentBoundary.ts'),
  '../experience/saveableParams': { extractSaveableParams: forbidden },
  '../experience/miningFingerprint': { createMiningFingerprints: forbidden },
  '../savedActions/lastSaveableRun': lastRun,
  '../savedActions/store': { touchSavedAction: forbidden },
})

let query = 'format', browsing = true, notifications = 0, executions = 0
let current = material.replaceCurrentMaterial(blocks.createQueryObjectBlock({ query: '  {"name":"typo",}\r\n\r\n' }))
const original = current.block
const unsubscribe = pending.subscribePendingObjectBlock(() => { notifications++; query = ''; browsing = false })
const controller = new LauncherController({
  surfaceId: 'global-launcher', locale: 'en',
  api: { getSelectionText: forbidden, getActiveText: forbidden, getClipboardText: forbidden, copyText: forbidden, pasteToForegroundApp: forbidden },
  makeT: () => (key) => key, getSettings: () => ({}), recordSelection: forbidden,
  requestClose: forbidden, onReturnToRoot: forbidden, onChange: noop, appendExperienceEvent: forbidden,
})
const top = () => controller.getState().frames.at(-1)
function editItem() {
  const expected = current
  return {
    systemKey: 'host:test:material-edit', kind: 'host', display: { title: 'Edit material' },
    behavior: { type: 'collect-input', input: { allowEmptyInput: true } },
    initialInputText: current.block.payloadText, materialTextEdit: true,
    experienceRecord: false, recordUsage: false,
    execute: ({ input }) => {
      executions++
      if (current !== expected) return { ok: false, message: 'Material changed' }
      current = material.replaceCurrentMaterial(blocks.createQueryObjectBlock({ query: input.text }))
      pending.setPendingObjectBlock(current.block, { persist: true, silent: true })
      return { ok: true, keepOpen: true }
    },
  }
}
const savedRun = { status: 'ready', actionKey: 'synthetic-prior-copy', completedAt: Date.now() }
lastRun.setLastSaveableRun(savedRun)

try {
  // Explicit initial input prevents the attached input shortcut from auto-executing.
  await controller.selectItem(editItem(), { objectBlockText: 'must not replace initial material', recordUsage: false })
  assert.equal(top().kind, 'collect-input')
  assert.equal(top().inputText, original.payloadText)
  assert.equal(executions, 0)
  const renderedFrame = top()
  controller.setInputText('first input before React renders', renderedFrame)
  controller.setInputText('second input before React renders', renderedFrame)
  assert.equal(top().inputText, 'second input before React renders', 'same edit accepts consecutive input events')
  controller.setInputText('  {"name":"fixed"}\r\n\r\n')
  await controller.previewInput()
  await controller.captureInput()
  assert.equal(inputReads, 0, 'plain collect-input must not acquire implicit input even on direct preview calls')
  assert.equal(executions, 0)
  assert.equal(controller.back(renderedFrame), true, 'same edit can cancel before React renders')
  assert.equal(current.block, original)
  assert.equal(pending.peekPendingObjectBlock(), null)

  // Keep-open success returns to root without clearing the current search intent.
  await controller.selectItem(editItem(), { recordUsage: false })
  const draft = '  {"name":"fixed"}\r\n\r\n'
  controller.setInputText(draft)
  const submittedFrame = top()
  await controller.submitInput(submittedFrame)
  await controller.submitInput(submittedFrame)
  assert.equal(executions, 1)
  assert.equal(top().kind, 'list')
  assert.equal(current.block.payloadText, draft)
  assert.equal(current.block.kind, 'json')
  assert.equal(current.block.source, 'query')
  assert.equal(current.previousBlock, null)
  assert.equal(pending.peekPendingObjectBlock().payloadText, draft)
  assert.equal(query, 'format'); assert.equal(browsing, true); assert.equal(notifications, 0)
  assert.equal((await lastRun.getLastSaveableRun()).actionKey, savedRun.actionKey)

  // Stale buttons cannot submit a newer draft, including after cancel, close or replacement.
  for (const leave of ['back', 'exitCommand', 'reset']) {
    await controller.selectItem(editItem(), { recordUsage: false })
    const oldFrame = top()
    controller[leave]()
    current = material.replaceCurrentMaterial(blocks.createQueryObjectBlock({ query: `new material after ${leave}` }))
    await controller.selectItem(editItem(), { recordUsage: false })
    controller.setInputText('new unsubmitted draft')
    const before = executions
    const newFrame = top()
    controller.setInputText('old late edit', oldFrame)
    assert.equal(top(), newFrame)
    assert.equal(controller.back(oldFrame), false)
    assert.equal(controller.exitCommand(oldFrame), false)
    assert.equal(top(), newFrame, 'old cancel and command-tag buttons cannot leave a newer edit')
    await controller.submitInput(oldFrame)
    assert.equal(executions, before)
    assert.equal(top().inputText, 'new unsubmitted draft')
    assert.equal(current.block.payloadText, `new material after ${leave}`)
    controller.exitCommand()
  }

  // Replacing live material while an old draft stays open rejects that commit.
  await controller.selectItem(editItem(), { recordUsage: false })
  current = material.replaceCurrentMaterial(blocks.createQueryObjectBlock({ query: 'newer handoff' }))
  pending.setPendingObjectBlock(current.block, { persist: true, silent: true })
  await controller.submitInput(top())
  assert.equal(controller.getState().error, 'Material changed')
  assert.equal(current.block.payloadText, 'newer handoff')
  assert.equal(pending.peekPendingObjectBlock().payloadText, 'newer handoff')
  controller.exitCommand()

  for (const text of ['', '  \n\n', 'Authorization: synthetic-hidden-secret']) {
    await controller.selectItem(editItem(), { recordUsage: false })
    controller.setInputText(text)
    await controller.submitInput(top())
    assert.equal(current.block.payloadText, text)
    assert.equal(top().kind, 'list')
  }
  assert.equal(current.block.secretMasked, true, 'edited material is classified afresh')
  assert.equal(current.block.preview, undefined)
  assert.equal(inputReads, 0)
  assert.equal((await lastRun.getLastSaveableRun()).actionKey, savedRun.actionKey)
  console.log('Launcher material edit passed: explicit input, no implicit reads, cancel/confirm, stale submits, classification and delivery isolation')
} finally {
  controller.reset()
  unsubscribe()
  pending.clearPendingObjectBlock()
}
