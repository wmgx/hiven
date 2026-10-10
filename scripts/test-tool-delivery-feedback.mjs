#!/usr/bin/env node
// Feedback ownership and asynchronous result handling; no UI/style assertions or native I/O.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/ui/toolDeliveryFeedback.ts', 'utf8')
const exports = {}
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, module: { exports }, Symbol, Set, Object })
const { createToolDeliveryFeedbackController } = exports

const copied = { ok: false, fallback: 'copied', message: 'Copied. Paste manually.' }
const failed = { ok: false, fallback: 'none', message: 'Clipboard write failed.' }
const cancelled = { ok: false, fallback: 'none', message: '' }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function createOwner() {
  let current = true
  const listeners = new Set()
  return {
    isCurrent: () => current,
    subscribeInvalidation(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    leave() {
      current = false
      for (const listener of [...listeners]) listener()
    },
    // Exercise strict-mode/hidden-window remount without reviving old attempts.
    enter() { current = true },
  }
}
function harness(result = { text: 'result' }, owner) {
  if (arguments.length < 2) owner = createOwner()
  const controller = createToolDeliveryFeedbackController()
  controller.activate()
  let unsubscribe = () => {}
  const h = {
    controller, result, owner,
    render(nextResult = h.result, nextOwner = h.owner) {
      h.result = nextResult
      if (h.owner !== nextOwner) {
        unsubscribe()
        unsubscribe = nextOwner?.subscribeInvalidation(controller.invalidate) ?? (() => {})
      }
      h.owner = nextOwner
      controller.setContext(nextResult, nextOwner)
      const revision = controller.getSnapshot().revision
      return () => controller.beginAttempt(nextResult, nextOwner, revision)
    },
    feedback: () => controller.getSnapshot().feedback,
  }
  unsubscribe = owner?.subscribeInvalidation(controller.invalidate) ?? (() => {})
  h.begin = h.render()
  return h
}

{
  const h = harness(), attempt = h.begin()
  assert.equal(attempt.reportPaste(copied), true)
  assert.equal(h.feedback().tone, 'info')
  assert.equal(h.feedback().message, copied.message)
  const retained = h.feedback()
  h.render()
  assert.equal(h.feedback(), retained, 'ordinary owner/result rerenders preserve the persistent notice')
  assert.equal(attempt.isCurrent(), true, 'rendering does not expire the active action')
  const copyOrReturn = h.begin()
  assert.equal(h.feedback(), null, 'starting any new delivery clears the previous notice')
  assert.equal(attempt.reportError('obsolete'), false)
  assert.equal(copyOrReturn.reportError('Copy failed'), true)
  assert.equal(h.feedback().tone, 'error')
}

for (const outcome of [failed, cancelled, { ok: true }, { ok: false, fallback: 'copied', message: '' }]) {
  const h = harness()
  h.begin().reportPaste(copied)
  assert.equal(h.begin().reportPaste(outcome), true)
  if (outcome === failed) {
    assert.equal(h.feedback().tone, 'error')
    assert.equal(h.feedback().message, failed.message)
  } else assert.equal(h.feedback(), null, 'success and empty-message cancellation produce no failure notice')
}

{
  const h = harness(), oldRender = h.begin, pending = oldRender()
  pending.reportPaste(copied)
  h.controller.invalidate()
  assert.equal(h.feedback(), null, 'input/options/exit clears immediately before React renders')
  assert.equal(pending.isCurrent(), false)
  assert.equal(oldRender().isCurrent(), false, 'a retained pre-edit handler cannot start stale I/O')
  const freshRender = h.render()
  assert.equal(freshRender().isCurrent(), true, 'same-result retry is allowed after a fresh render, including cancelled exit')
  assert.equal(pending.isCurrent(), false, 'same-result retry never revives an old attempt')
}

for (const changed of ['input', 'operation', 'result']) {
  const initial = { input: 'a ', operation: 'trim', text: 'a' }
  const h = harness(initial), pending = h.begin()
  pending.reportPaste(copied)
  const next = changed === 'input'
    ? { ...initial, input: ' a ' }
    : changed === 'operation'
      ? { ...initial, operation: 'remove-blank' }
      : { ...initial, text: 'b' }
  const nextRender = h.render(next)
  assert.equal(h.feedback(), null, `${changed} identity clears old feedback even when output text is equal`)
  assert.equal(pending.isCurrent(), false)
  assert.equal(nextRender().isCurrent(), true)
  h.render(initial)
  assert.equal(pending.isCurrent(), false, 'A to B to A result identity cannot revive the A attempt')
}

{
  const h = harness(), pending = h.begin(), firstOwner = h.owner
  pending.reportPaste(copied)
  const nextRender = h.render(h.result, createOwner())
  assert.equal(h.feedback(), null, 'new owner clears feedback for identical output')
  assert.equal(pending.isCurrent(), false)
  const replacement = nextRender()
  firstOwner.leave()
  assert.equal(replacement.isCurrent(), true, 'old owner subscription cannot revoke its replacement')
  replacement.reportPaste(copied)
  h.owner.leave()
  assert.equal(h.feedback(), null, 'owner leaves synchronously clear settled feedback without unmount')
  assert.equal(replacement.isCurrent(), false)
  assert.equal(h.render()().isCurrent(), false, 'inactive owners cannot begin delivery')
  h.owner.enter()
  assert.equal(h.render()().isCurrent(), true)
  assert.equal(replacement.isCurrent(), false, 'hidden then visible cannot revive old completion')
}

{
  const h = harness(), pending = h.begin()
  pending.reportPaste(copied)
  h.controller.deactivate()
  assert.equal(h.feedback(), null)
  assert.equal(pending.isCurrent(), false)
  h.controller.activate()
  assert.equal(h.render()().isCurrent(), true, 'strict-mode remount has a fresh usable attempt')
  assert.equal(pending.isCurrent(), false)
}

for (const settle of ['resolve', 'reject']) {
  for (const interrupt of ['new-attempt', 'input', 'owner', 'unmount']) {
    const h = harness(), done = deferred(), attempt = h.begin()
    const late = done.promise.then(attempt.reportPaste, () => attempt.reportError('Late write failure'))
    if (interrupt === 'new-attempt') h.begin().reportPaste(failed)
    if (interrupt === 'input') h.controller.invalidate()
    if (interrupt === 'owner') h.owner.leave()
    if (interrupt === 'unmount') h.controller.deactivate()
    const expected = h.feedback()
    if (settle === 'resolve') done.resolve(copied)
    else done.reject(new Error('write failed'))
    assert.equal(await late, false, `${interrupt} rejects late ${settle}`)
    assert.equal(h.feedback(), expected, `${interrupt} late ${settle} cannot overwrite current feedback`)
  }
}

{
  const h = harness(), done = deferred(), attempt = h.begin()
  const success = done.promise.then((outcome) => attempt.isCurrent() && attempt.reportPaste(outcome))
  h.owner.leave()
  h.owner.enter()
  h.render()
  done.resolve({ ok: true })
  assert.equal(await success, false, 'late success after reopening cannot authorize complete/close')
}

{
  const one = harness('equal', undefined), two = harness('equal', undefined)
  one.begin().reportPaste(copied)
  assert.equal(two.feedback(), null, 'component instances never share feedback')
  two.controller.invalidate()
  assert.equal(one.feedback().message, copied.message)
}

console.log('PASS tool delivery feedback: persistent info, failure/cancel/success, owner and result generations, stale handlers, late results, remount and instance isolation')

// Execute the real hook with a minimal committed-render lifecycle. This checks
// its subscriptions and render-bound handlers, without rendering any UI.
function hookHarness() {
  const slots = []
  let cursor = 0, dirty = false, effects = [], current
  const useLayoutEffect = (effect, dependencies) => {
    const index = cursor++
    const old = slots[index]
    if (old && old.dependencies.length === dependencies.length
      && old.dependencies.every((value, i) => Object.is(value, dependencies[i]))) return
    effects.push(() => {
      old?.cleanup?.()
      slots[index] = { dependencies, cleanup: effect() }
    })
  }
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[index].value, (value) => { slots[index].value = value; dirty = true }]
    },
    useLayoutEffect,
    useCallback: (callback) => callback,
    useSyncExternalStore(subscribe, getSnapshot) {
      useLayoutEffect(() => subscribe(() => { dirty = true }), [subscribe])
      return getSnapshot()
    },
  }
  const hookExports = {}
  vm.runInNewContext(ts.transpileModule(readFileSync('src/ui/useToolDeliveryFeedback.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports: hookExports, module: { exports: hookExports },
    require(name) {
      if (name === 'react') return react
      assert.equal(name, './toolDeliveryFeedback')
      return exports
    },
  })
  return {
    render(result, owner, parentCommit = () => {}) {
      let count = 0
      do {
        assert.ok(count++ < 10, 'the hook must settle without a render loop')
        cursor = 0; dirty = false; effects = []
        current = hookExports.useToolDeliveryFeedback(result, owner)
        for (const effect of effects) effect()
        parentCommit()
      } while (dirty)
      return current
    },
    unmount() {
      for (const slot of slots) slot.cleanup?.()
    },
  }
}

{
  const hooks = hookHarness(), owner = createOwner(), result = { text: 'same text' }
  owner.leave()
  let current = hooks.render(result, owner, () => owner.enter())
  assert.equal(current.beginAttempt().isCurrent(), true, 'child layout before parent owner activation remains recoverable')
  current.beginAttempt().reportPaste(copied)
  current = hooks.render(result, owner)
  assert.equal(current.feedback.tone, 'info')
  assert.equal(hooks.render(result, owner).feedback.message, copied.message)
  const oldHandler = current.beginAttempt
  current.invalidate()
  assert.equal(oldHandler().isCurrent(), false, 'hook handlers are bound to the render before synchronous input invalidation')
  current = hooks.render(result, owner)
  assert.equal(current.feedback, null)
  current.beginAttempt().reportPaste(copied)
  current = hooks.render(result, owner)
  owner.leave()
  current = hooks.render(result, owner)
  assert.equal(current.feedback, null, 'the hook subscribes to owner invalidation even after paste settled')
  assert.equal(current.beginAttempt().isCurrent(), false)
  const replacementOwner = createOwner()
  current = hooks.render(result, replacementOwner)
  const replacement = current.beginAttempt()
  owner.leave()
  assert.equal(replacement.isCurrent(), true, 'the hook detaches the previous owner subscription')
  hooks.unmount()
  assert.equal(replacement.isCurrent(), false, 'real hook cleanup expires retained attempts')
}
console.log('PASS real feedback hook: first mount, persistent rerender, synchronous invalidation, owner subscription/replacement and cleanup')
