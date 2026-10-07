#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { nativeExecutable, runNativeSmoke } from './lib/tauri-debug-runner.mjs'

// These tests run only Node fixtures and a private copy of the OS sleep binary.
// They never invoke npm, Cargo, Tauri, a browser, or any graphical application.
if (!['linux', 'darwin'].includes(process.platform)) {
  console.log(`tauri debug runner checks skipped: process fixtures unsupported on ${process.platform}`)
  process.exit(0)
}

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
await mkdir(join(root, 'temp'), { recursive: true })
const fixtureRoot = await mkdtemp(join(root, 'temp', 'tauri-debug-runner-test-'))
const binary = join(fixtureRoot, 'native executable')
const fakeNpm = join(fixtureRoot, 'fake-npm.mjs')
const caseRoots = []
const directChildren = new Set()
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
let checks = 0

await copyFile('/bin/sleep', binary)
await chmod(binary, 0o755)
await writeFile(fakeNpm, String.raw`
import { spawn } from 'node:child_process'
import { appendFileSync } from 'node:fs'
const mode = process.env.SMOKE_FIXTURE_MODE
const binary = process.env.SMOKE_FIXTURE_BINARY
const event = (kind, pid = process.pid) => appendFileSync('events.ndjson', JSON.stringify({ kind, pid }) + '\n')
event('launcher')
console.log('VITE v9.9.9 ready in 1 ms')
const startNative = (kind = 'native', options = {}) => {
  const child = spawn(binary, ['60'], { stdio: 'ignore', ...options })
  event(kind, child.pid)
  return child
}
if (mode === 'native' || mode === 'native-exit') {
  const child = startNative()
  if (mode === 'native-exit') setTimeout(() => child.kill('SIGTERM'), 250)
} else if (mode === 'restart') {
  let current = startNative()
  process.on('SIGUSR1', () => {
    const previous = current
    current = startNative('replacement')
    previous.kill('SIGKILL')
  })
} else if (mode === 'argv-spoof') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', binary], { argv0: binary, stdio: 'ignore' })
  event('argv-spoof', child.pid)
  console.log('Running ' + binary)
} else if (mode === 'launcher-exit') {
  const child = startNative('native', { stdio: ['ignore', 'inherit', 'inherit'] })
  child.once('spawn', () => process.exit(19))
} else if (mode === 'ignore-term') {
  const worker = spawn(process.execPath, ['-e', "const fs = require('node:fs'); process.on('SIGTERM', () => fs.appendFileSync('events.ndjson', JSON.stringify({ kind: 'term-ignored', pid: process.pid }) + '\\n')); process.send('ready'); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  event('worker', worker.pid)
  worker.once('message', () => { event('worker-ready', worker.pid); startNative() })
} else if (mode === 'ambiguous') {
  startNative()
  startNative('second-native')
} else if (mode === 'runtime-error') {
  startNative()
  console.error('error: synthetic runtime startup failure')
} else if (mode !== 'vite-only') {
  throw new Error('Unknown synthetic fixture mode: ' + mode)
}
setInterval(() => {}, 1000)
`)

async function events(caseRoot) {
  const content = await readFile(join(caseRoot, 'events.ndjson'), 'utf8').catch((error) => {
    if (error.code === 'ENOENT') return ''
    throw error
  })
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function isLive(pid) {
  try {
    const { stdout } = await exec('/bin/ps', ['-p', String(pid), '-o', 'stat='])
    return stdout.trim() !== '' && !/^[ZX]/.test(stdout.trim())
  } catch (error) {
    if (error.code === 1) return false
    throw error
  }
}

async function liveGroupMembers(pgid) {
  const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,pgid=,stat='])
  return stdout.split('\n').flatMap((line) => {
    const row = line.trim().split(/\s+/)
    return Number(row[1]) === pgid && !/^[ZX]/.test(row[2]) ? [Number(row[0])] : []
  })
}

async function waitUntil(predicate, message, timeoutMs = 1_500) {
  const deadline = Date.now() + timeoutMs
  do {
    if (await predicate()) return
    await sleep(10)
  } while (Date.now() < deadline)
  assert.fail(message)
}

async function cleanupCase(caseRoot) {
  const rows = await events(caseRoot)
  const launchers = rows.filter((row) => row.kind === 'launcher')
  for (const { pid } of launchers) {
    try { process.kill(-pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  await waitUntil(async () => (await Promise.all(rows.map(({ pid }) => isLive(pid)))).every((live) => !live), 'synthetic fixture processes must be cleaned up')
  for (const { pid } of launchers) await waitUntil(async () => (await liveGroupMembers(pid)).length === 0, 'synthetic fixture group must be empty')
}

async function assertClean(caseRoot) {
  const rows = await events(caseRoot)
  for (const { kind, pid } of rows) assert.equal(await isLive(pid), false, `${kind} pid ${pid} must not survive runner cleanup`)
  for (const { pid } of rows.filter((row) => row.kind === 'launcher')) assert.deepEqual(await liveGroupMembers(pid), [], `launcher group ${pid} must contain no live descendants`)
}

async function makeCase(mode) {
  const caseRoot = await mkdtemp(join(fixtureRoot, `${mode}-`))
  caseRoots.push(caseRoot)
  return {
    root: caseRoot,
    name: 'synthetic-smoke',
    command: process.execPath,
    args: [fakeNpm],
    env: { ...process.env, SMOKE_FIXTURE_MODE: mode, SMOKE_FIXTURE_BINARY: binary },
    executable: binary,
    timeoutMs: 500,
    settleMs: 100,
    shutdownMs: 75,
    verifyTimeoutMs: 250,
    pollMs: 15,
  }
}

async function failure(options, pattern) {
  let thrown
  try { await runNativeSmoke(options) } catch (error) { thrown = error }
  assert.ok(thrown, 'the synthetic smoke must fail')
  assert.match(thrown.message, pattern)
  const retainedPath = thrown.message.match(/^Failure log retained at (.+)$/m)?.[1]
  assert.ok(retainedPath, 'failures must identify their retained diagnostic log')
  assert.equal(dirname(retainedPath), join(options.root, 'temp'))
  const log = await readFile(retainedPath, 'utf8')
  assert.match(log, /\[smoke\] FAILED:/)
  await assertClean(options.root)
  return { error: thrown, log }
}

async function check(name, body) {
  const started = Date.now()
  try {
    await body()
    checks += 1
    console.log(`ok ${checks} - ${name} (${Date.now() - started}ms)`)
  } catch (error) {
    error.message = `${name}: ${error.message}`
    throw error
  }
}

try {
  await check('Vite-only output cannot prove native startup; failure retains its log', async () => {
    const options = await makeCase('vite-only')
    const { log } = await failure(options, /native startup timed out/)
    assert.match(log, /VITE v9\.9\.9 ready/)
    assert.doesNotMatch(log, /observed native pid=/)
  })

  await check('a pre-existing process with the exact executable cannot satisfy this invocation', async () => {
    const old = spawn(binary, ['60'], { detached: true, stdio: 'ignore' })
    directChildren.add(old)
    await once(old, 'spawn')
    try {
      assert.equal(await isLive(old.pid), true)
      await failure(await makeCase('vite-only'), /native startup timed out/)
      assert.equal(await isLive(old.pid), true, 'runner must not kill an unrelated existing process')
    } finally {
      old.kill('SIGKILL')
      await once(old, 'exit')
      directChildren.delete(old)
    }
  })

  await check('argv and startup-output impersonation cannot substitute for executable identity', async () => {
    const options = await makeCase('argv-spoof')
    const { log } = await failure(options, /native startup timed out/)
    assert.ok((await events(options.root)).some((row) => row.kind === 'argv-spoof'))
    assert.match(log, /Running /)
    assert.doesNotMatch(log, /observed native pid=/)
  })

  await check('a new exact-path descendant survives verification and is cleaned up', async () => {
    const options = await makeCase('native')
    let verifiedPid
    const result = await runNativeSmoke({ ...options, verify: ({ pid }) => { verifiedPid = pid } })
    const nativePid = (await events(options.root)).find((row) => row.kind === 'native').pid
    assert.equal(result.pid, nativePid)
    assert.equal(verifiedPid, nativePid, 'verification must target the observed native PID')
    assert.equal(result.logPath, undefined)
    assert.deepEqual(await readdir(join(options.root, 'temp')), [], 'successful logs are removed by default')
    await assertClean(options.root)
  })

  await check('native exit during the survival interval fails', async () => {
    const options = await makeCase('native-exit')
    const { log } = await failure({ ...options, settleMs: 600 }, /native process \d+ exited or changed identity/)
    assert.match(log, /observed native pid=/)
  })

  await check('a replacement native process cannot inherit the selected process identity', async () => {
    const options = await makeCase('restart')
    const { log } = await failure({
      ...options,
      verify: async () => {
        const launcher = (await events(options.root)).find((row) => row.kind === 'launcher')
        process.kill(launcher.pid, 'SIGUSR1')
        await waitUntil(async () => (await events(options.root)).some((row) => row.kind === 'replacement'), 'fixture must create the replacement')
      },
    }, /native process \d+ exited or changed identity|ambiguous native launch/)
    const rows = await events(options.root)
    const original = rows.find((row) => row.kind === 'native')
    const replacement = rows.find((row) => row.kind === 'replacement')
    assert.ok(replacement, 'the fixture must actually restart the native executable')
    assert.notEqual(original.pid, replacement.pid)
    assert.match(log, new RegExp(`observed native pid=${original.pid} `))
  })

  await check('launcher exit is detected while a child still owns its stdout and stderr', async () => {
    const options = await makeCase('launcher-exit')
    const started = Date.now()
    await failure({ ...options, timeoutMs: 3_000 }, /tauri dev exited: code=19/)
    assert.ok(Date.now() - started < 2_000, 'exit must be detected without waiting for stdio close or the startup deadline')
  })

  await check('TERM-ignoring descendants with ignored stdio receive KILL after launcher exit', async () => {
    const options = await makeCase('ignore-term')
    const result = await runNativeSmoke({ ...options, keepLog: true })
    const rows = await events(options.root)
    assert.ok(rows.some((row) => row.kind === 'worker-ready'))
    assert.ok(rows.some((row) => row.kind === 'term-ignored'))
    const log = await readFile(result.logPath, 'utf8')
    assert.match(log, /cleanup SIGTERM process group/)
    assert.match(log, /cleanup SIGKILL process group/)
    await assertClean(options.root)
  })

  await check('spawn failure retains a useful failure log', async () => {
    const options = await makeCase('vite-only')
    const { log } = await failure({ ...options, command: join(options.root, 'missing-command'), args: [] }, /ENOENT/)
    assert.match(log, /ENOENT/)
  })

  await check('hanging verification is bounded and its cancellation signal is aborted', async () => {
    const options = await makeCase('native')
    let verificationSignal
    let aborted = false
    const started = Date.now()
    await failure({
      ...options,
      verifyTimeoutMs: 120,
      verify: ({ signal }) => {
        verificationSignal = signal
        signal.addEventListener('abort', () => { aborted = true }, { once: true })
        return new Promise(() => {})
      },
    }, /native verification timed out after 120ms/)
    assert.equal(verificationSignal.aborted, true)
    assert.equal(aborted, true)
    assert.ok(Date.now() - started < 2_000, 'verification timeout must bound a callback that never returns')
  })

  await check('native death during a pending verification fails before its timeout', async () => {
    const options = await makeCase('native')
    let verificationSignal
    const started = Date.now()
    await failure({
      ...options,
      verifyTimeoutMs: 3_000,
      verify: ({ pid, signal }) => {
        verificationSignal = signal
        process.kill(pid, 'SIGKILL')
        return new Promise(() => {})
      },
    }, /native process \d+ exited or changed identity/)
    assert.equal(verificationSignal.aborted, true)
    assert.ok(Date.now() - started < 2_000, 'native liveness must still be checked while verification is pending')
  })

  await check('a successful verification return cannot hide death of the selected PID', async () => {
    const options = await makeCase('native')
    let verifiedPid
    let returned = false
    await failure({
      ...options,
      verify: ({ pid }) => {
        verifiedPid = pid
        process.kill(pid, 'SIGKILL')
        returned = true
      },
    }, /native process \d+ exited or changed identity/)
    assert.equal(returned, true)
    assert.equal(verifiedPid, (await events(options.root)).find((row) => row.kind === 'native').pid)
  })

  await check('two matching descendants are rejected as an ambiguous launch', async () => {
    const options = await makeCase('ambiguous')
    const { log } = await failure(options, /ambiguous native launch/)
    // The runner can observe both children and kill the launcher before its
    // second post-spawn event is written; the retained failure proves discovery.
    assert.match(log, /ambiguous native launch/)
  })

  await check('runtime failure signatures fail even when a native executable exists', async () => {
    const options = await makeCase('runtime-error')
    const { log } = await failure(options, /startup\/runtime failure signature/)
    assert.match(log, /synthetic runtime startup failure/)
  })

  await check('SIGTERM interrupts an isolated runner and cleans up its native group', async () => {
    const options = await makeCase('native')
    const isolatedRunner = join(options.root, 'isolated-runner.mjs')
    await writeFile(isolatedRunner, `
import { runNativeSmoke } from ${JSON.stringify(new URL('./lib/tauri-debug-runner.mjs', import.meta.url).href)}
try {
  await runNativeSmoke({
    root: process.cwd(), command: process.execPath,
    args: [process.env.SMOKE_FIXTURE_NPM], executable: process.env.SMOKE_FIXTURE_BINARY,
    timeoutMs: 2000, settleMs: 50, shutdownMs: 75, verifyTimeoutMs: 5000, pollMs: 15,
    verify: () => { process.send('verification-ready'); return new Promise(() => {}) },
  })
  process.exitCode = 2
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
process.disconnect()
`)
    const runner = spawn(process.execPath, [isolatedRunner], {
      cwd: options.root, detached: true,
      env: { ...options.env, SMOKE_FIXTURE_NPM: fakeNpm },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    directChildren.add(runner)
    let stderr = ''
    let ready = false
    runner.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    runner.stdout.resume()
    runner.on('message', (message) => { if (message === 'verification-ready') ready = true })
    const closed = once(runner, 'close')
    await waitUntil(() => ready, 'isolated runner must reach native verification', 3_000)
    runner.kill('SIGTERM')
    await waitUntil(() => runner.exitCode !== null || runner.signalCode !== null, 'interrupted runner must finish within its cleanup bound', 2_000)
    const [code, signal] = await closed
    directChildren.delete(runner)
    assert.equal(code, 1)
    assert.equal(signal, null, 'the runner must handle the signal and complete cleanup')
    assert.match(stderr, /native smoke interrupted by SIGTERM/)
    const logPath = stderr.match(/^Failure log retained at (.+)$/m)?.[1]
    assert.ok(logPath)
    assert.match(await readFile(logPath, 'utf8'), /cleanup SIGTERM process group/)
    await assertClean(options.root)
  })

  await check('binary resolution honors Cargo directories, build targets, and explicit overrides', async () => {
    assert.equal(nativeExecutable(fixtureRoot, {}), join(fixtureRoot, 'src-tauri', 'target', 'debug', 'hiven'))
    assert.equal(nativeExecutable(fixtureRoot, { CARGO_TARGET_DIR: '../build' }), join(fixtureRoot, 'build', 'debug', 'hiven'))
    const externalTarget = join(fixtureRoot, 'external target')
    assert.equal(nativeExecutable(fixtureRoot, { CARGO_TARGET_DIR: externalTarget }), join(externalTarget, 'debug', 'hiven'))
    assert.equal(nativeExecutable(fixtureRoot, { CARGO_TARGET_DIR: externalTarget, CARGO_BUILD_TARGET: 'aarch64-apple-darwin' }), join(externalTarget, 'aarch64-apple-darwin', 'debug', 'hiven'))
    assert.equal(nativeExecutable(fixtureRoot, { HIVEN_TAURI_SMOKE_BINARY: 'custom native', CARGO_TARGET_DIR: externalTarget, CARGO_BUILD_TARGET: 'ignored-target' }), join(fixtureRoot, 'custom native'))
  })

  async function entryOptions(mode) {
    const options = await makeCase(mode)
    const target = join(options.root, 'external target')
    const executable = join(target, 'debug', 'hiven')
    await mkdir(dirname(executable), { recursive: true })
    await copyFile(binary, executable)
    const env = {
      ...options.env, npm_execpath: fakeNpm, CARGO_TARGET_DIR: target,
      SMOKE_FIXTURE_BINARY: executable,
      HIVEN_TAURI_SMOKE_TIMEOUT_MS: '500', HIVEN_TAURI_SMOKE_SETTLE_MS: '75',
      HIVEN_TAURI_SMOKE_SHUTDOWN_MS: '75', HIVEN_TAURI_SMOKE_FORCE: '1',
    }
    delete env.HIVEN_TAURI_SMOKE_BINARY
    delete env.CARGO_BUILD_TARGET
    delete env.HIVEN_KEEP_TAURI_SMOKE_LOG
    return { options, env }
  }

  await check('the smoke entry launches only fake npm and observes an external Cargo target', async () => {
    const { options, env } = await entryOptions('native')
    const { stdout } = await exec(process.execPath, [join(root, 'scripts/test-tauri-debug-smoke.mjs')], { cwd: options.root, env, timeout: 3_000 })
    const native = (await events(options.root)).find((row) => row.kind === 'native')
    assert.ok(native)
    assert.match(stdout, new RegExp(`tauri debug smoke checks passed: native pid=${native.pid}`))
    await assertClean(options.root)
  })

  await check('the smoke entry rejects fake npm with Vite-only output and retains its failure log', async () => {
    const { options, env } = await entryOptions('vite-only')
    let rejected
    try {
      await exec(process.execPath, [join(root, 'scripts/test-tauri-debug-smoke.mjs')], { cwd: options.root, env, timeout: 3_000 })
    } catch (error) { rejected = error }
    assert.ok(rejected)
    assert.equal(rejected.code, 1)
    assert.match(rejected.stderr, /native startup timed out/)
    assert.doesNotMatch(rejected.stdout, /checks passed/)
    const logPath = rejected.stderr.match(/^Failure log retained at (.+)$/m)?.[1]
    assert.ok(logPath)
    assert.match(await readFile(logPath, 'utf8'), /VITE v9\.9\.9 ready/)
    await assertClean(options.root)
  })

  if (process.platform !== 'darwin') {
    await check('the runtime-state entry explicitly skips unsupported hosts without launching npm', async () => {
      const { options, env } = await entryOptions('native')
      const { stdout } = await exec(process.execPath, [join(root, 'scripts/test-tauri-debug-runtime-state.mjs')], { cwd: options.root, env, timeout: 3_000 })
      assert.match(stdout, /runtime-state skipped:.*requires macOS/)
      assert.doesNotMatch(stdout, /checks passed/)
      assert.deepEqual(await events(options.root), [])
    })
  }

  console.log(`tauri debug runner checks passed (${checks} synthetic process cases)`)
} finally {
  for (const child of directChildren) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  for (const caseRoot of caseRoots) await cleanupCase(caseRoot)
  await rm(fixtureRoot, { recursive: true, force: true })
}
