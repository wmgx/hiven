#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'vite'

const scratch = await mkdtemp(join(tmpdir(), 'hiven-shortcut-recording-'))
const entry = join(scratch, 'entry.ts')
await writeFile(entry, `export * from '${resolve('src/hotkeys/pageReload.ts')}';`)
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

try {
  await build({
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: scratch,
      emptyOutDir: false,
      minify: false,
      lib: { entry, formats: ['es'], fileName: () => 'runtime.mjs' },
    },
  })
  globalThis.window = Object.assign(new EventTarget(), {
    setTimeout,
    clearTimeout,
    location: { reload() {} },
  })
  const api = await import(pathToFileURL(join(scratch, 'runtime.mjs')).href)
  const active = new Set()
  const calls = []
  const installers = new Map()
  const install = (name, options = {}) => {
    active.add(name)
    const dispose = api.registerHotkeyReloadParticipant(name, {
      async stop() {
        calls.push(`stop:${name}`)
        options.started?.resolve()
        if (options.gate) await options.gate.promise
        if (options.fail) throw new Error(`cannot stop ${name}`)
        active.delete(name)
      },
      resume() {
        calls.push(`resume:${name}`)
        install(name)
      },
    })
    installers.set(name, dispose)
  }
  for (const name of ['global-launcher', 'quick-editor', 'plugin-surfaces', 'apps', 'unrelated']) install(name)

  const first = api.claimShortcutRecordingLease()
  assert.equal(api.isShortcutRecordingLeaseActive(), true, 'arming owns host Escape before native cleanup finishes')
  const firstLease = await first.acquired
  assert.ok(firstLease)
  assert.deepEqual([...active], ['unrelated'])
  const secondLease = await api.claimShortcutRecordingLease().acquired
  firstLease.release()
  await tick()
  assert.equal(api.isShortcutRecordingLeaseActive(), true, 'one cleanup cannot release another recorder ownership')
  assert.deepEqual([...active], ['unrelated'])
  secondLease.release()
  await tick()
  assert.equal(api.isShortcutRecordingLeaseActive(), false)
  assert.deepEqual([...active].sort(), ['apps', 'global-launcher', 'plugin-surfaces', 'quick-editor', 'unrelated'])

  const gate = deferred()
  const started = deferred()
  installers.get('apps')()
  await tick()
  install('apps', { gate, started })
  const cancelled = api.claimShortcutRecordingLease()
  await started.promise
  cancelled.cancel()
  assert.equal(api.isShortcutRecordingLeaseActive(), false, 'pending cancellation releases host Escape ownership')
  gate.resolve()
  assert.equal(await cancelled.acquired, null)
  assert.ok(active.has('apps'))

  installers.get('quick-editor')()
  await tick()
  install('quick-editor', { fail: true })
  const failed = api.claimShortcutRecordingLease()
  await assert.rejects(failed.acquired, /cannot stop quick-editor/)
  await tick()
  assert.deepEqual([...active].sort(), ['apps', 'global-launcher', 'plugin-surfaces', 'quick-editor', 'unrelated'])
  assert.ok(calls.includes('resume:apps'))
  assert.ok(calls.includes('resume:global-launcher'))

  const reloadGate = deferred()
  const reloadStarted = deferred()
  installers.get('apps')()
  await tick()
  install('apps', { gate: reloadGate, started: reloadStarted })
  const reload = api.reloadPageAfterHotkeysStop(() => {})
  await reloadStarted.promise
  const duringReload = api.claimShortcutRecordingLease()
  await assert.rejects(duringReload.acquired, /already stopping for reload/)
  assert.equal(api.isShortcutRecordingLeaseActive(), false, 'rejected acquisition cannot leak host ownership')
  reloadGate.resolve()
  await reload

  console.log('✓ shortcut-recording-lease: scoped pause, exact-token composition, cancellation and failure recovery passed')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
