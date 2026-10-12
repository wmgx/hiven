import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/components/launcher/surfaceInitialFocus.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports })
const { focusInitialSurfaceTarget } = exports

function fixture() {
  const document = new EventTarget()
  const view = new EventTarget()
  const frames = new Map(), timers = new Map(), observers = new Set()
  let serial = 0
  view.requestAnimationFrame = (fn) => { frames.set(++serial, fn); return serial }
  view.cancelAnimationFrame = (id) => frames.delete(id)
  view.setTimeout = (fn) => { timers.set(++serial, fn); return serial }
  view.clearTimeout = (id) => timers.delete(id)
  view.getComputedStyle = (node) => ({ visibility: node.visibility ?? 'visible' })
  view.MutationObserver = class {
    constructor(callback) { this.callback = callback }
    observe() { observers.add(this) }
    disconnect() { observers.delete(this) }
  }
  document.defaultView = view
  const control = (name) => ({
    name, isConnected: true, visible: true, disabled: false, excluded: false, calls: 0,
    getClientRects() { return this.visible ? [{}] : [] },
    matches() { return this.disabled },
    closest() { return this.excluded ? {} : null },
    focus(options) {
      assert.equal(options.preventScroll, true)
      this.calls++
      document.activeElement = this
      document.dispatchEvent(new Event('focusin'))
    },
  })
  const target = control('left'), other = control('right'), shell = control('shell')
  let ready = false, settings = false
  shell.querySelector = (selector) => selector === '[data-settings-navigation-root]' ? (settings ? {} : null) : (ready ? target : null)
  shell.contains = (node) => node === target || node === other || node === shell
  const panel = { ownerDocument: document, isConnected: true, querySelector: () => shell }
  document.activeElement = null
  const mutate = () => { for (const observer of [...observers]) observer.callback() }
  const frame = () => { const batch = [...frames.values()]; frames.clear(); for (const fn of batch) fn() }
  const readyNow = () => { ready = true; mutate() }
  return { panel, document, view, target, other, shell, frames, observers, timers, frame, mutate, readyNow,
    settings: () => { settings = true },
    timeout: () => { for (const fn of [...timers.values()]) fn() },
    clean: () => { assert.equal(frames.size, 0); assert.equal(observers.size, 0); assert.equal(timers.size, 0) },
  }
}

{
  const f = fixture(); const stop = focusInitialSurfaceTarget(f.panel)
  f.frame(); assert.equal(f.shell.calls, 1)
  f.mutate(); f.frame(); assert.equal(f.shell.calls, 1, 'fallback focuses only once')
  f.readyNow(); f.frame(); assert.equal(f.target.calls, 1)
  f.mutate(); f.frame(); assert.equal(f.target.calls, 1, 'no repeated caret pull')
  stop(); f.clean()
}
for (const interaction of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focusin', 'blur']) {
  const f = fixture(); focusInitialSurfaceTarget(f.panel); f.frame()
  ;(interaction === 'blur' ? f.view : f.document).dispatchEvent(new Event(interaction))
  f.readyNow(); f.frame(); assert.equal(f.target.calls, 0, `${interaction} cancels delayed handoff (keydown includes Tab/IME)`)
  f.clean()
}
for (const invalid of ['disabled', 'excluded', 'invisible', 'detached', 'visibility']) {
  const f = fixture(); f.readyNow()
  if (invalid === 'disabled') f.target.disabled = true
  if (invalid === 'excluded') f.target.excluded = true
  if (invalid === 'invisible') f.target.visible = false
  if (invalid === 'detached') f.target.isConnected = false
  if (invalid === 'visibility') f.target.visibility = 'hidden'
  focusInitialSurfaceTarget(f.panel); f.frame(); assert.equal(f.target.calls, 0)
  f.target.disabled = false; f.target.excluded = false; f.target.visible = true; f.target.isConnected = true; f.target.visibility = 'visible'
  f.mutate(); f.frame(); assert.equal(f.target.calls, 1)
  f.clean()
}
{
  const f = fixture(); focusInitialSurfaceTarget(f.panel); f.frame()
  f.panel.querySelector = () => ({})
  f.mutate(); f.frame(); f.clean(); assert.equal(f.target.calls, 0, 'replacement shell ends old owner')
}
{
  const f = fixture(); focusInitialSurfaceTarget(f.panel)
  f.panel.isConnected = false; f.frame(); f.clean()
}
{
  const f = fixture(); focusInitialSurfaceTarget(f.panel); f.frame(); f.timeout()
  f.readyNow(); f.frame(); f.clean(); assert.equal(f.target.calls, 0)
}
{
  const f = fixture(); f.settings(); f.readyNow()
  focusInitialSurfaceTarget(f.panel, true); f.frame(); f.clean(); assert.equal(f.target.calls, 0)
}
{
  const f = fixture(); const stop = focusInitialSurfaceTarget(f.panel); stop()
  f.readyNow(); f.frame(); assert.equal(f.target.calls, 0)
  focusInitialSurfaceTarget(f.panel); f.frame(); assert.equal(f.target.calls, 1, 'new opening gets a fresh bounded handoff'); f.clean()
}
{
  const f = fixture(); f.readyNow(); f.document.activeElement = f.other
  focusInitialSurfaceTarget(f.panel); f.frame()
  assert.equal(f.target.calls, 0, 'already-focused child owns focus even if marker is ready')
  assert.equal(f.document.activeElement, f.other); f.clean()
}
{
  const f = fixture(); focusInitialSurfaceTarget(f.panel)
  f.document.dispatchEvent(new Event('keydown')) // Tab before first paint.
  f.readyNow(); f.frame(); f.clean()
  assert.equal(f.shell.calls + f.target.calls, 0)
}
{
  const f = fixture(); const query = f.panel.querySelector
  f.panel.querySelector = () => null
  focusInitialSurfaceTarget(f.panel); f.frame()
  assert.equal(f.shell.calls, 0)
  f.panel.querySelector = query; f.readyNow(); f.frame()
  assert.equal(f.target.calls, 1, 'delayed shell/editor may complete the initial handoff'); f.clean()
}
{
  const f = fixture(); f.readyNow(); f.document.activeElement = f.target
  focusInitialSurfaceTarget(f.panel); f.frame(); f.clean()
  assert.equal(f.target.calls, 0, 'already focused editor is not refocused')
}
console.log('Surface initial focus lifecycle passed')
