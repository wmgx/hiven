#!/usr/bin/env node
/** Real controller and session-setter logic; no DOM, UI snapshots, or native side effects. */
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, String(value)) },
  removeItem: (key) => { values.delete(key) },
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const originalInfo = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') originalInfo(...args) }
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const controllers = new Set()

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

try {
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { useLauncherSession } = await vite.ssrLoadModule('/src/workspace/launcher/useLauncherSession.ts')
  let serial = 0
  let passed = 0

  async function check(name, test) {
    try {
      await test()
      passed++
    } catch (error) {
      error.message = `${name}: ${error.message}`
      throw error
    } finally {
      for (const controller of controllers) controller.reset()
      controllers.clear()
    }
  }

  function harness(surfaceId = 'global-launcher') {
    const h = { events: [], selections: [], closed: 0, notifications: 0 }
    h.controller = new LauncherController({
      surfaceId, api: {}, locale: 'en', makeT: () => (key) => key, getSettings: () => ({}),
      recordSelection: (_surface, item) => h.selections.push(item.systemKey),
      requestClose: () => { h.closed++ }, onChange: () => { h.notifications++ },
      appendExperienceEvent: (event) => h.events.push(event),
    })
    controllers.add(h.controller)
    // Execute the actual hook once without effects or a DOM. Its public setter
    // retains synchronous refs even before React has committed another render.
    function SessionProbe() {
      h.session = useLauncherSession({ hostId: surfaceId, open: false, requestClose() {} })
      return null
    }
    renderToString(createElement(SessionProbe))
    h.session.controllerRef.current = h.controller
    h.query = h.session.setQuery
    h.state = () => h.controller.getState()
    h.top = () => h.state().frames.at(-1)
    h.query('original query')
    return h
  }

  function item(execute, extra = {}) {
    return {
      systemKey: `host:test:root-error-${++serial}`, kind: 'host', display: { title: 'Root error regression' },
      behavior: { type: 'perform' }, execute, ...extra,
    }
  }

  function fail(gate, mode, message) {
    if (mode === 'throw') gate.reject(new Error(message))
    else gate.resolve({ ok: false, message })
  }

  function assertRecordedFailure(h, selectedItem) {
    const events = h.events.filter((event) => event.actionKey === selectedItem.systemKey)
    assert.deepEqual(events.map((event) => event.eventType), ['run.started', 'run.finished'])
    assert.notEqual(events[1].status, 'success', 'a dismissed error still records the actual failed run')
    assert.ok(events[1].errorType)
    assert.deepEqual(h.selections, [])
    assert.equal(h.closed, 0)
  }

  for (const mode of ['throw', 'returned']) {
    await check(`${mode}: current failure, same-value input, raw change and clear`, async () => {
      const h = harness()
      const gate = deferred()
      const selectedItem = item(() => gate.promise)
      const pending = h.controller.selectItem(selectedItem)
      const running = h.state()
      h.query('original query')
      assert.equal(h.state(), running, 'same-value input does not publish a controller update')
      fail(gate, mode, 'Current launch failed')
      await pending
      assert.equal(h.state().error, 'Current launch failed')
      assert.equal(h.state().busy, false)
      const failed = h.state()
      h.query('original query')
      assert.equal(h.state(), failed, 'same-value input keeps the current error')
      h.query(' original query ')
      assert.deepEqual(h.state(), { ...failed, error: null }, 'raw whitespace edits only clear the error')
      assert.equal(h.state().frames, failed.frames)
      assertRecordedFailure(h, selectedItem)

      await h.controller.selectItem(item(async () => ({ ok: false, message: 'Failure before clearing' })))
      h.query('')
      assert.equal(h.state().error, null, 'clearing root search dismisses its previous error')
    })

    await check(`${mode}: query edits retire a pending error without cancelling or unlocking`, async () => {
      const h = harness()
      const gate = deferred()
      let executions = 0
      const selectedItem = item(() => { executions++; return gate.promise })
      const pending = h.controller.selectItem(selectedItem)
      const running = h.state()
      h.query('new query')
      h.query('original query')
      assert.equal(h.state(), running, 'error-free query edits preserve state, frames and busy')
      await h.controller.selectItem(selectedItem)
      assert.equal(executions, 1, 'query edits retain the pending-item duplicate lock')
      fail(gate, mode, 'Stale launch failed')
      await pending
      assert.equal(h.state().busy, false, 'the original run still releases its own busy state')
      assert.equal(h.state().error, null, 'A → B → A cannot revive an old A error')
      assertRecordedFailure(h, selectedItem)
    })

    await check(`${mode}: an older run cannot clear a newer run's busy or error`, async () => {
      const h = harness()
      const oldGate = deferred()
      const newGate = deferred()
      const oldPending = h.controller.selectItem(item(() => oldGate.promise))
      h.query('new query')
      const newItem = item(() => newGate.promise)
      const newPending = h.controller.selectItem(newItem)
      const running = h.state()
      fail(oldGate, mode, 'Old run failed')
      await oldPending
      assert.equal(h.state(), running)
      assert.equal(h.state().busy, true)
      fail(newGate, mode, 'New run failed')
      await newPending
      assert.equal(h.state().error, 'New run failed')
      assert.equal(h.state().busy, false)
      assertRecordedFailure(h, newItem)
    })

    await check(`${mode}: preparation preserves the original root error owner`, async () => {
      const h = harness()
      const preparation = deferred()
      const execution = deferred()
      const started = deferred()
      const selectedItem = item(() => { started.resolve(); return execution.promise }, {
        prepare: () => preparation.promise,
      })
      const pending = h.controller.selectItem(selectedItem)
      h.query('new query during preparation')
      assert.equal(h.state().busy, true)
      preparation.resolve()
      await started.promise
      fail(execution, mode, 'Old prepared action failed')
      await pending
      assert.equal(h.state().error, null)
      assert.equal(h.state().busy, false)
      assertRecordedFailure(h, selectedItem)
    })

    await check(`${mode}: root query changes leave child draft failures intact`, async () => {
      const h = harness()
      const gate = deferred()
      const selectedItem = item(() => gate.promise, {
        behavior: { type: 'collect-input', input: { allowEmptyInput: false } },
      })
      await h.controller.selectItem(selectedItem)
      h.controller.setInputText('draft text')
      const pending = h.controller.submitInput()
      const running = h.state()
      h.query('host query while child runs')
      assert.equal(h.state(), running)
      fail(gate, mode, 'Child input failed')
      await pending
      const failed = h.state()
      h.query('another host query')
      assert.equal(h.state(), failed)
      assert.equal(h.state().error, 'Child input failed')
      assert.equal(h.top().inputText, 'draft text')
      assertRecordedFailure(h, selectedItem)
    })
  }

  await check('preparation rejection clears only an error owned by the current query', async () => {
    const h = harness()
    for (const change of [false, true]) {
      const gate = deferred()
      const pending = h.controller.selectItem(item(() => assert.fail('Preparation failed'), { prepare: () => gate.promise }))
      if (change) h.query('edited during preparation')
      assert.equal(h.state().busy, true)
      gate.reject(new Error('Preparation failed'))
      await pending
      assert.equal(h.state().error, change ? null : 'Preparation failed')
      assert.equal(h.state().busy, false)
    }
    assert.deepEqual(h.events, [], 'preparation keeps existing experience-recording semantics')
  })

  await check('late preparation cannot release a newer run or show a stale disabled reason', async () => {
    const h = harness()
    const preparation = deferred()
    const oldPending = h.controller.selectItem(item(() => assert.fail('Old preparation was superseded'), {
      prepare: () => preparation.promise,
    }))
    h.query('new query')
    const execution = deferred()
    const pending = h.controller.selectItem(item(() => execution.promise))
    const running = h.state()
    preparation.reject(new Error('Old prepare failed'))
    await oldPending
    assert.equal(h.state(), running)
    execution.resolve({ ok: false, message: 'Current failure' })
    await pending
    assert.equal(h.state().error, 'Current failure')

    const disabledPreparation = deferred()
    const disabled = item(() => assert.fail('Disabled action cannot run'), {
      disabledReason: { message: 'Unavailable here' },
    })
    const disabledPending = h.controller.selectItem(item(() => assert.fail('Preparation replaces this item'), {
      prepare: () => disabledPreparation.promise,
    }))
    h.query('after disabled preparation starts')
    disabledPreparation.resolve(disabled)
    await disabledPending
    assert.equal(h.state().error, null)
    assert.equal(h.state().busy, false)
  })

  await check('session reset aligns the synchronous query identity', async () => {
    const h = harness('editor-command-bar')
    h.session.reset()
    const selectedItem = item(async () => ({ ok: false, message: 'Empty-query failure' }))
    await h.controller.selectItem(selectedItem)
    h.query('')
    assert.equal(h.state().error, 'Empty-query failure', 'reset already changed the actual query to empty')
    h.query('original query')
    assert.equal(h.state().error, null, 'the pre-reset value is a new query after reset')
  })

  await check('query edits preserve successful execution, delivery ownership and usage', async () => {
    const h = harness()
    const execution = deferred()
    const delivery = deferred()
    const started = deferred()
    let delivered = 0
    let executions = 0
    const selectedItem = item(() => { executions++; return execution.promise })
    const pending = h.controller.selectItem(selectedItem)
    h.query('changed before successful output')
    execution.resolve({ ok: true, output: { choices: [{
      id: 'deliver', title: 'Deliver output', primaryAction: async () => {
        delivered++
        started.resolve()
        await delivery.promise
      },
    }] } })
    await started.promise
    const delivering = h.state()
    assert.equal(delivering.busy, true)
    assert.equal(delivering.deliveryIntent, 'action')
    h.query('changed during delivery')
    assert.equal(h.state(), delivering)
    await h.controller.selectItem(selectedItem)
    assert.equal(executions, 1)
    assert.equal(delivered, 1)
    delivery.resolve()
    await pending
    assert.equal(h.state().busy, false)
    assert.equal(h.state().deliveryIntent, null)
    assert.equal(h.closed, 1)
    assert.deepEqual(h.selections, [selectedItem.systemKey])
  })

  console.log(`launcher root query errors: ${passed} behavioral checks passed`)
} finally {
  for (const controller of controllers) controller.reset()
  console.info = originalInfo
  await vite.close()
}
