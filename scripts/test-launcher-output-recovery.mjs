#!/usr/bin/env node
/** Important delivery logic: real Vite SSR controller/output/LastRun and host bridge; no UI or source-text assertions. */
import assert from 'node:assert/strict'
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

function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

try {
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const output = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { getLastSaveableRun, setLastSaveableRun } = await vite.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  const { createGlobalLauncherPluginApi } = await vite.ssrLoadModule('/src/launcher/clipboard/globalLauncherApi.ts')
  const { consumePendingObjectBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/pendingObjectBlock.ts')
  const hostReturn = createGlobalLauncherPluginApi({}).returnToLauncher
  let serial = 0
  let passed = 0
  const controllers = new Set()

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

  function harness() {
    const h = {
      calls: { copy: [], return: [], paste: [], editor: [] },
      effects: {}, executions: 0, closed: 0, rootReturns: 0, material: 'original material',
      selections: [], events: [],
    }
    h.api = {
      getSelectionText: () => '', getActiveText: () => '',
      getClipboardText: async () => { throw new Error('Unexpected implicit clipboard read') },
      async copyText(text) { h.calls.copy.push(text); await h.effects.copy?.(text) },
      async returnToLauncher(text) {
        h.calls.return.push(text)
        await h.effects.return?.(text)
        await hostReturn(text)
        const block = consumePendingObjectBlock()
        assert.equal(block?.source, 'tool-result')
        assert.equal(block.payloadText, text, 'the real material bridge preserves exact output')
        h.material = block.payloadText
      },
      async pasteToForegroundApp(text) { h.calls.paste.push(text); await h.effects.paste?.(text) },
      async replaceActiveText(text) { h.calls.editor.push(text) },
      async insertText() { throw new Error('Unexpected insert') },
    }
    h.controller = new LauncherController({
      surfaceId: 'global-launcher', api: h.api, locale: 'en',
      makeT: () => (key) => key, getSettings: () => ({}),
      recordSelection: (_surface, item) => h.selections.push(item.systemKey),
      requestClose: () => { h.closed++ }, onReturnToRoot: () => { h.rootReturns++ },
      onChange() {}, appendExperienceEvent: (event) => h.events.push(event),
    })
    controllers.add(h.controller)
    h.top = () => h.controller.getState().frames.at(-1)
    h.choices = () => h.top().kind === 'result' ? h.top().output.choices : h.top().previewOutput.choices
    return h
  }

  function makeOutput(h, { count = 2, text = '  computed output\n', explicit = false } = {}) {
    const choices = Array.from({ length: count }, (_, index) => {
      const result = (explicit ? output.explicitTextPreviewResult : output.textResult)(
        index === 0 ? text : `${text} alternative ${index}`, h.api, 'en',
      )
      const choice = result.output.choices[0]
      choice.id += `.${index}` // Keep the actual Host output marker on the original object.
      return choice
    })
    return output.choicesResult(choices)
  }

  function makeItem(h, kind = 'result', options = {}) {
    const item = {
      systemKey: `host:test:output-recovery-${++serial}`, kind: 'host', display: { title: 'Delivery regression' },
      behavior: kind === 'suggestion'
        ? { type: 'collect-input', input: { allowEmptyInput: false } }
        : { type: 'perform' },
      actionPolicy: { effect: 'pure', learnable: true }, contractFingerprint: 'v1:delivery-regression',
      execute: async () => { h.executions++; return makeOutput(h, options) },
    }
    if (kind === 'preview' || options.explicit) item.inputPolicy = { mode: 'auto' }
    if (options.explicit) item.executionMode = 'explicit-text-preview'
    if (kind !== 'result') item.initialInputText = 'source input'
    if (kind === 'suggestion') item.suggest = async () => makeOutput(h, options).output
    return item
  }

  async function enter(h, kind = 'result', options = {}) {
    const item = makeItem(h, kind, options)
    await h.controller.selectItem(item, kind === 'result' ? { objectBlockText: 'source input' } : {})
    if (kind === 'preview') await h.controller.previewInput()
    if (kind === 'suggestion') await h.controller.refreshSuggestions()
    return item
  }

  function gateDelivery(h, method) {
    const completion = deferred()
    const started = deferred()
    h.effects[method] = () => { started.resolve(); return completion.promise }
    return { ...completion, started: started.promise }
  }

  function seedLastRun(label) {
    const run = {
      status: 'ready', runId: `run-${label}-${++serial}`, actionKey: 'host:test:newer-success',
      inputBinding: 'prompt', outputIntent: 'copy', savedParams: {},
      contractFingerprint: 'v1:newer', actionPolicy: { effect: 'pure', learnable: true }, completedAt: Date.now(),
    }
    setLastSaveableRun(run)
    return structuredClone(run)
  }

  for (const kind of ['suggestion', 'preview']) {
    await check(`${kind}: Enter retries the resolved choice without recomputing`, async () => {
      const h = harness()
      const item = await enter(h, kind)
      if (kind === 'suggestion') h.controller.moveSuggestionHighlight(1)
      const choice = h.choices()[0]
      const beforeExecutions = h.executions
      const gate = gateDelivery(h, 'copy')
      const pending = h.controller.submitInput()
      await gate.started
      await h.controller.submitInput()
      await h.controller.activateSecondary(choice, 'return-to-launcher')
      assert.equal(h.calls.copy.length, 1)
      assert.equal(h.calls.return.length, 0)
      gate.reject(new Error('Resolved choice delivery failed'))
      await pending
      assert.equal(h.top().kind, 'collect-input')
      assert.equal(h.choices()[0], choice)
      assert.equal(h.controller.getState().error, 'Resolved choice delivery failed')
      h.effects.copy = undefined
      await h.controller.submitInput()
      assert.equal(h.calls.copy.length, 2)
      assert.equal(h.executions, beforeExecutions)
      assert.equal(h.closed, 1)
      assert.equal((await getLastSaveableRun()).actionKey, item.systemKey)
    })
  }

  // All visible output entry points share one in-flight delivery lock.
  for (const kind of ['result', 'suggestion', 'preview']) {
    await check(`${kind}: primary, secondary, paste and Enter cannot race`, async () => {
      const h = harness()
      await enter(h, kind)
      const [choice, alternative] = h.choices()
      const beforeExecutions = h.executions
      const gate = gateDelivery(h, 'copy')
      const pending = h.controller.activateChoice(choice)
      await gate.started
      assert.equal(h.controller.getState().busy, true)
      assert.equal(h.controller.getState().deliveryIntent, 'copy')
      let fallbackCalls = 0
      await Promise.all([
        h.controller.activateChoice(choice), h.controller.activateChoice(alternative),
        h.controller.activateSecondary(choice, 'return-to-launcher'),
        h.controller.activatePreviewPaste(choice, () => { fallbackCalls++ }),
        h.controller.submitInput(), h.controller.previewInput(), h.controller.refreshSuggestions(),
      ])
      assert.equal(h.calls.copy.length, 1)
      assert.equal(h.calls.return.length, 0)
      assert.equal(fallbackCalls, 0)
      assert.equal(h.executions, beforeExecutions)
      assert.equal(h.controller.getState().busy, true)
      gate.resolve()
      await pending
      assert.equal(h.closed, 1, 'successful ordinary copy closes once')
      assert.equal(h.controller.getState().busy, false)
      await h.controller.activateChoice(choice)
      await h.controller.activateSecondary(choice, 'return-to-launcher')
      await h.controller.activatePreviewPaste(choice, () => { fallbackCalls++ })
      assert.equal(h.calls.copy.length, 1, 'closed output cannot deliver again')
      assert.equal(fallbackCalls, 0)
    })

    await check(`${kind}: Return owns the lock and uses the real root material bridge`, async () => {
      const h = harness()
      const item = await enter(h, kind)
      const choice = h.choices()[0]
      const gate = gateDelivery(h, 'return')
      const pending = h.controller.activateSecondary(choice, 'return-to-launcher')
      await gate.started
      await h.controller.activateChoice(choice)
      await h.controller.activateSecondary(choice, 'return-to-launcher')
      assert.equal(h.calls.return.length, 1)
      assert.equal(h.calls.copy.length, 0)
      gate.resolve()
      await pending
      assert.equal(h.top().kind, 'list')
      assert.equal(h.material, choice.preview)
      assert.equal(h.rootReturns, 1)
      assert.equal(h.closed, 0)
      if (kind === 'result') {
        const lastRun = await getLastSaveableRun()
        assert.equal(lastRun.actionKey, item.systemKey)
        assert.equal(lastRun.outputIntent, 'return-to-launcher')
      }
    })

    await check(`${kind}: a failed current delivery retains the computed choices`, async () => {
      const h = harness()
      await enter(h, kind)
      const frame = h.top()
      const choices = h.choices()
      const beforeExecutions = h.executions
      const priorRun = seedLastRun('before-failure')
      h.effects.copy = () => { throw new Error('Clipboard temporarily denied') }
      await h.controller.activateChoice(choices[0])
      assert.equal(h.top(), frame)
      assert.equal(h.choices(), choices)
      assert.equal(h.controller.getState().error, 'Clipboard temporarily denied')
      assert.equal(h.controller.getState().busy, false)
      assert.equal(h.closed, 0)
      assert.deepEqual(await getLastSaveableRun(), priorRun)
      h.effects.copy = undefined
      await h.controller.activateChoice(choices[0])
      assert.equal(h.calls.copy.length, 2)
      assert.equal(h.executions, beforeExecutions, 'retry delivers the already-computed output')
      assert.equal(h.closed, 1)
    })
  }

  await check('automatic single delivery rejects repeated selection of the same item', async () => {
    const h = harness()
    const item = makeItem(h, 'result', { count: 1 })
    const gate = gateDelivery(h, 'copy')
    const pending = h.controller.selectItem(item, { objectBlockText: 'source input' })
    await gate.started
    await h.controller.selectItem(item, { objectBlockText: 'source input' })
    assert.equal(h.executions, 1, 'reselecting the pending item cannot execute it again')
    assert.equal(h.calls.copy.length, 1)
    assert.equal(h.controller.getState().busy, true)
    assert.equal(h.closed, 0)
    gate.resolve()
    await pending
    assert.equal(h.executions, 1)
    assert.equal(h.calls.copy.length, 1)
    assert.equal(h.closed, 1)
    assert.equal(h.controller.getState().busy, false)
  })

  await check('back from nested output restores usable choices in the retained parent frame', async () => {
    const h = harness()
    await enter(h)
    const parentFrame = h.top()
    const parentChoice = h.choices()[0]
    const nested = makeOutput(h, { text: 'nested output' })
    await h.controller.activatePreviewPaste(parentChoice, () => nested)
    assert.equal(h.top().output, nested.output)
    assert.equal(h.closed, 0)
    assert.equal(h.controller.back(), true)
    assert.equal(h.top(), parentFrame)
    assert.equal(h.choices()[0], parentChoice)
    await h.controller.activateChoice(parentChoice)
    assert.deepEqual(h.calls.copy, [parentChoice.preview])
    assert.equal(h.executions, 1, 'returning to the parent output does not recompute it')
    assert.equal(h.closed, 1)
  })

  // A single ordinary output still auto-applies, but failed auto-apply exposes
  // only that original primary action. It must not offer a new destination.
  for (const failure of ['throw', 'result']) {
    await check(`single automatic choice: ${failure} becomes a retry-only frame`, async () => {
      const h = harness()
      const item = makeItem(h, 'result', { count: 1 })
      const result = makeOutput(h, { count: 1 })
      const choice = result.output.choices[0]
      // Protocol boundary: automatic single-choice delivery still retries its
      // primary action even when the original output also declared selection.
      if (failure === 'result') result.output.selection = {
        type: 'multi', min: 1, max: 1,
        submit: async () => { throw new Error('Retry must not submit selection') },
      }
      const originalPrimary = choice.primaryAction
      let attempts = 0
      choice.primaryAction = async () => {
        attempts++
        if (attempts === 1) {
          if (failure === 'throw') throw new Error('Automatic output failed')
          return output.errorResult('Automatic output failed')
        }
        return originalPrimary()
      }
      item.execute = async () => { h.executions++; return result }
      const priorRun = seedLastRun('before-auto-failure')
      await h.controller.selectItem(item, { objectBlockText: 'source input' })
      assert.equal(h.top().kind, 'result')
      assert.equal(h.top().retryOnly, true)
      assert.equal(h.top().output.selection, undefined, 'retry exposes only the failed primary action')
      if (failure === 'throw') assert.equal(h.top().output, result.output)
      assert.equal(h.top().output.choices[0], choice)
      assert.equal(h.controller.getState().error, 'Automatic output failed')
      assert.equal(h.controller.getState().busy, false)
      assert.deepEqual(await getLastSaveableRun(), priorRun)
      let fallbackCalls = 0
      for (const action of choice.secondaryActions) await h.controller.activateSecondary(choice, action.id)
      await h.controller.activatePreviewPaste(choice, () => { fallbackCalls++ })
      assert.equal(h.calls.return.length + h.calls.paste.length + h.calls.editor.length, 0)
      assert.equal(fallbackCalls, 0)
      assert.equal(attempts, 1)
      assert.equal(h.controller.getState().error, 'Automatic output failed')
      const gate = gateDelivery(h, 'copy')
      const retry = h.controller.activateChoice(choice)
      await gate.started
      await h.controller.activateChoice(choice)
      gate.resolve()
      await retry
      assert.equal(attempts, 2)
      assert.equal(h.executions, 1)
      assert.equal(h.closed, 1)
      assert.equal((await getLastSaveableRun()).actionKey, item.systemKey)
    })
  }

  // Old success and failure may complete an external I/O, but cannot mutate a
  // newer controller flow or replace the completed-run metadata stored later.
  for (const kind of ['result', 'suggestion', 'preview']) {
    const invalidations = kind === 'result' ? ['back', 'reset', 'select'] : ['back', 'reset', 'select', 'edit']
    for (const invalidation of invalidations) {
      for (const action of ['copy', 'return', 'paste']) {
        for (const outcome of ['resolve', 'reject']) {
          await check(`${kind}/${invalidation}/${action}: stale ${outcome}`, async () => {
            const h = harness()
            await enter(h, kind)
            const choice = h.choices()[0]
            const gate = gateDelivery(h, action)
            const pending = action === 'copy'
              ? h.controller.activateChoice(choice)
              : action === 'return'
                ? h.controller.activateSecondary(choice, 'return-to-launcher')
                : h.controller.activatePreviewPaste(choice, h.api.pasteToForegroundApp)
            await gate.started
            if (invalidation === 'edit') h.controller.setInputText('a newer draft')
            else if (invalidation === 'select') await h.controller.selectItem(makeItem(h, 'preview'))
            else h.controller[invalidation]()
            const newFrame = h.top()
            const newState = h.controller.getState()
            const newerRun = seedLastRun('newer-completion')
            if (outcome === 'reject') gate.reject(new Error('Obsolete output failure'))
            else gate.resolve()
            await pending
            assert.equal(h.top(), newFrame)
            assert.equal(h.controller.getState().error, newState.error)
            assert.equal(h.controller.getState().busy, newState.busy)
            assert.equal(h.closed, 0)
            assert.equal(h.rootReturns, 0)
            assert.deepEqual(await getLastSaveableRun(), newerRun)
            if (invalidation === 'edit') assert.equal(h.top().inputText, 'a newer draft')
            const counts = Object.fromEntries(Object.entries(h.calls).map(([key, calls]) => [key, calls.length]))
            await h.controller.activateChoice(choice)
            await h.controller.activateSecondary(choice, 'return-to-launcher')
            await h.controller.activatePreviewPaste(choice, h.api.pasteToForegroundApp)
            assert.deepEqual(Object.fromEntries(Object.entries(h.calls).map(([key, calls]) => [key, calls.length])), counts,
              'a stale choice remains non-deliverable, including a visible old suggestion after typing')
          })
        }
      }
    }
  }

  for (const invalidation of ['back', 'reset', 'select', 'edit']) {
    for (const outcome of ['resolve', 'reject']) {
      await check(`automatic delivery/${invalidation}: stale ${outcome} cannot restore retry output`, async () => {
        const h = harness()
        const item = makeItem(h, 'preview', { count: 1 })
        await h.controller.selectItem(item)
        const gate = gateDelivery(h, 'copy')
        const pending = h.controller.submitInput()
        await gate.started
        if (invalidation === 'edit') h.controller.setInputText('new automatic input')
        else if (invalidation === 'select') await h.controller.selectItem(makeItem(h, 'preview'))
        else h.controller[invalidation]()
        const frame = h.top()
        const newerRun = seedLastRun('after-auto-navigation')
        if (outcome === 'reject') gate.reject(new Error('Old automatic delivery failed'))
        else gate.resolve()
        await pending
        assert.equal(h.top(), frame)
        assert.notEqual(h.top().kind, 'result', 'late automatic failure cannot append a retry frame')
        assert.equal(h.controller.getState().error, null)
        assert.equal(h.controller.getState().busy, false)
        assert.equal(h.closed, 0)
        assert.deepEqual(await getLastSaveableRun(), newerRun)
      })
    }
  }

  for (const newerState of ['busy', 'error']) {
    for (const outcome of ['resolve', 'reject']) {
      await check(`old ${outcome} preserves newer task ${newerState}`, async () => {
        const h = harness()
        await enter(h)
        const gate = gateDelivery(h, 'copy')
        const oldDelivery = h.controller.activateChoice(h.choices()[0])
        await gate.started
        const execution = deferred()
        const newItem = makeItem(h, 'preview')
        newItem.initialInputText = newerState === 'busy' ? 'new work' : ''
        newItem.execute = () => execution.promise
        await h.controller.selectItem(newItem)
        const newWork = h.controller.submitInput()
        if (newerState === 'error') await newWork
        const frame = h.top()
        const error = h.controller.getState().error
        assert.equal(h.controller.getState().busy, newerState === 'busy')
        if (newerState === 'error') assert.ok(error)
        const newerRun = seedLastRun('new-flow')
        if (outcome === 'reject') gate.reject(new Error('Old error must not win'))
        else gate.resolve()
        await oldDelivery
        assert.equal(h.top(), frame)
        assert.equal(h.controller.getState().busy, newerState === 'busy')
        assert.equal(h.controller.getState().error, error)
        assert.deepEqual(await getLastSaveableRun(), newerRun)
        assert.equal(h.closed, 0)
        if (newerState === 'busy') {
          execution.resolve(output.errorResult('Current execution ended'))
          await newWork
        }
      })
    }
  }

  for (const text of ['  exact explicit output\n\n', '']) {
    await check(`explicit output ${JSON.stringify(text)} never falls back to paste`, async () => {
      const h = harness()
      await enter(h, 'result', { explicit: true, count: 1, text })
      const frame = h.top()
      const choice = h.choices()[0]
      assert.equal(frame.executionMode, 'explicit-text-preview')
      assert.equal(frame.retryOnly, undefined)
      assert.equal(choice.preview, text)
      assert.equal(h.calls.copy.length, 0)
      assert.deepEqual(choice.secondaryActions.map(output.getHostOutputIntent), ['return-to-launcher'])
      let fallbackCalls = 0
      await h.controller.activatePreviewPaste(choice, () => { fallbackCalls++ })
      assert.equal(fallbackCalls, 0)
      h.effects.copy = () => { throw new Error('Explicit copy failed') }
      await h.controller.activateChoice(choice)
      assert.equal(h.top(), frame)
      assert.equal(h.top().retryOnly, undefined, 'explicit preview keeps its two permitted destinations')
      await h.controller.activateSecondary(choice, 'return-to-launcher')
      assert.equal(h.material, text)
      assert.equal(h.top().kind, 'list')
      assert.equal(h.rootReturns, 1)
      assert.equal(h.closed, 0)
      assert.equal(h.calls.paste.length, 0)
    })
  }

  for (const semantics of ['void', 'keep-open', 'nested-output', 'failure', 'throw']) {
    await check(`legacy preview paste honors ${semantics} callback results`, async () => {
      const h = harness()
      await enter(h)
      const originalFrame = h.top()
      const choice = h.choices()[0]
      const nested = makeOutput(h, { text: 'next output' })
      const callbackResult = semantics === 'void' ? undefined
        : semantics === 'keep-open' ? { ok: true, keepOpen: true }
          : semantics === 'nested-output' ? nested : output.errorResult('Legacy paste failed')
      const gate = deferred()
      let calls = 0
      const callback = (text) => {
        assert.equal(text, choice.preview.trim(), 'legacy fallback retains existing trimmed preview text')
        calls++
        return gate.promise
      }
      const pending = h.controller.activatePreviewPaste(choice, callback)
      await h.controller.activatePreviewPaste(choice, callback)
      await h.controller.activateChoice(choice)
      await h.controller.activateSecondary(choice, 'return-to-launcher')
      assert.equal(calls, 1)
      assert.equal(h.calls.copy.length + h.calls.return.length, 0)
      assert.equal(h.controller.getState().busy, true)
      if (semantics === 'throw') gate.reject(new Error('Legacy paste failed'))
      else gate.resolve(callbackResult)
      await pending
      assert.equal(h.controller.getState().busy, false)
      if (semantics === 'void') assert.equal(h.closed, 1)
      else if (semantics === 'keep-open') {
        assert.equal(h.top().kind, 'list')
        assert.equal(h.closed, 0)
        assert.equal(h.rootReturns, 0)
      } else if (semantics === 'nested-output') {
        assert.equal(h.top().kind, 'result')
        assert.equal(h.top().output, nested.output)
        assert.equal(h.closed, 0)
        await h.controller.activateChoice(nested.output.choices[0])
        assert.equal(h.closed, 1)
      } else {
        assert.equal(h.top(), originalFrame)
        assert.equal(h.controller.getState().error, 'Legacy paste failed')
        assert.equal(h.closed, 0)
        await h.controller.activatePreviewPaste(choice, () => { calls++ })
        assert.equal(calls, 2)
        assert.equal(h.closed, 1, 'a failed fallback remains retryable')
      }
      assert.equal(h.executions, 1)
    })
  }

  await check('real legacy paste clipboard failure remains a controller failure', async () => {
    const { createPluginPaste } = await vite.ssrLoadModule('/src/workspace/pluginPaste.ts')
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    let clipboardWrites = 0
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { async writeText() { clipboardWrites++; throw new Error('Clipboard denied') } } },
    })
    try {
      const h = harness()
      await enter(h)
      const frame = h.top()
      let pasteResult
      await h.controller.activatePreviewPaste(h.choices()[0], async (text) => {
        pasteResult = await createPluginPaste().pasteText(text)
        return pasteResult
      })
      assert.equal(clipboardWrites, 1)
      assert.equal(pasteResult.ok, false)
      assert.equal(pasteResult.fallback, 'none')
      assert.ok(pasteResult.message)
      assert.equal(h.top(), frame)
      assert.equal(h.controller.getState().error, pasteResult.message)
      assert.equal(h.controller.getState().busy, false)
      assert.equal(h.closed, 0)
    } finally {
      if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
      else delete globalThis.navigator
    }
  })

  await check('multi-select submit shares the delivery lock and retries without execution', async () => {
    const h = harness()
    const item = makeItem(h)
    const result = makeOutput(h)
    const gate = deferred()
    let submissions = 0
    result.output.selection = {
      type: 'multi',
      submit: async (choices) => {
        assert.deepEqual(choices, [result.output.choices[0]])
        submissions++
        return submissions === 1 ? gate.promise : { ok: true }
      },
    }
    item.execute = async () => { h.executions++; return result }
    await h.controller.selectItem(item, { objectBlockText: 'source input' })
    const frame = h.top()
    const choice = result.output.choices[0]
    const pending = h.controller.submitResultSelection([choice])
    let fallbackCalls = 0
    await Promise.all([
      h.controller.submitResultSelection([choice]), h.controller.activateChoice(choice),
      h.controller.activateSecondary(choice, 'return-to-launcher'),
      h.controller.activatePreviewPaste(choice, () => { fallbackCalls++ }),
    ])
    assert.equal(submissions, 1)
    assert.equal(fallbackCalls, 0)
    assert.equal(h.calls.copy.length + h.calls.return.length, 0)
    assert.equal(h.controller.getState().busy, true)
    gate.resolve(output.errorResult('Batch delivery failed'))
    await pending
    assert.equal(h.top(), frame)
    assert.equal(h.controller.getState().error, 'Batch delivery failed')
    assert.equal(h.closed, 0)
    await h.controller.submitResultSelection([choice])
    assert.equal(submissions, 2)
    assert.equal(h.executions, 1)
    assert.equal(h.closed, 1)
  })

  console.log(`Launcher output recovery passed: ${passed} real logic cases (delivery locks, retry-only recovery, stale completions, exact Return material, explicit previews and legacy paste semantics)`)
} finally {
  console.info = originalInfo
  await vite.close()
}
