#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const root = process.cwd()
const tempDir = join(root, 'temp')
mkdirSync(tempDir, { recursive: true })

const logPath = join(tempDir, `tauri-debug-runtime-state-${Date.now()}.log`)
const timeoutMs = Number(process.env.HIVEN_TAURI_RUNTIME_STATE_TIMEOUT_MS ?? 25_000)
const settleMs = Number(process.env.HIVEN_TAURI_RUNTIME_STATE_SETTLE_MS ?? 1_500)
const shutdownMs = Number(process.env.HIVEN_TAURI_RUNTIME_STATE_SHUTDOWN_MS ?? 2_000)
const suspiciousPattern = /Unhandled rejection|ReferenceError|TypeError|panic|panicked|compilation failed|error:/i
const packageManagerPath = process.env.npm_execpath ?? ''
const userAgent = process.env.npm_config_user_agent ?? ''
const isPnpm = /pnpm/i.test(packageManagerPath) || /pnpm\//i.test(userAgent)
const npmCommand = packageManagerPath
  ? process.execPath
  : isPnpm
    ? 'pnpm'
    : 'npm'
const npmArgs = packageManagerPath
  ? isPnpm
    ? [packageManagerPath, 'run', 'tauri', 'dev']
    : [packageManagerPath, 'run', 'tauri', '--', 'dev']
  : isPnpm
    ? ['run', 'tauri', 'dev']
    : ['run', 'tauri', '--', 'dev']
const pathEntries = [
  process.env.npm_node_execpath ? dirname(process.env.npm_node_execpath) : '',
  '/opt/homebrew/bin',
  process.env.PATH ?? '',
].filter(Boolean)

const tauriConfig = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
const windows = tauriConfig.app?.windows ?? []
assert.equal(windows.length, 1, 'debug runtime-state smoke expects only one initial runtime window')
assert.equal(windows[0].label, 'launcher', 'initial runtime window must be launcher')
assert.equal(windows[0].visible, false, 'initial launcher runtime window must be hidden') // visible: false
assert.ok(!windows.some((window) => window.label === 'main'), 'debug runtime-state smoke must not find a retired main window in config')

const child = spawn(npmCommand, npmArgs, {
  cwd: root,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    NO_COLOR: process.env.NO_COLOR ?? '1',
    PATH: pathEntries.join(':'),
  },
})

let output = ''
child.stdout.on('data', (chunk) => { output += chunk.toString() })
child.stderr.on('data', (chunk) => { output += chunk.toString() })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const closePromise = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))

async function stopChild() {
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
  await Promise.race([closePromise, sleep(shutdownMs)])
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
    await Promise.race([closePromise, sleep(1_000)])
  }
}

let earlyExit = null
try {
  await Promise.race([
    closePromise.then((result) => { earlyExit = result }),
    sleep(timeoutMs),
  ])

  if (earlyExit) {
    assert.fail(`tauri dev exited before runtime-state timeout: code=${earlyExit.code} signal=${earlyExit.signal}`)
  }

  await sleep(settleMs)

  const processOutput = execFileSync('pgrep', ['-fl', 'target/debug/hiven|hiven'], { encoding: 'utf8' })
  assert.match(processOutput, /target\/debug\/hiven/, 'debug runtime-state smoke must observe target/debug/hiven process')

  const systemEvents = spawnSync('osascript', ['-e', 'tell application "System Events" to repeat with p in (every process whose name contains "hiven" or name contains "Hiven")\n  set n to name of p\n  set w to count of windows of p\n  log n & " windows=" & w\nend repeat'], {
    encoding: 'utf8',
  })
  const systemEventsOutput = `${systemEvents.stdout ?? ''}${systemEvents.stderr ?? ''}`
  assert.equal(systemEvents.status, 0, `System Events process/window check failed: ${systemEventsOutput}`)
  assert.match(systemEventsOutput, /hiven windows=0/, 'hidden-launcher startup must not expose a visible main/editor/plugin window')
  // Static acceptance trace: target/debug/hiven -> hiven windows=0 -> visible: false

  assert.match(output, /VITE v[\s\S]*ready|Running DevCommand|Running `target\/debug\/hiven`/, 'tauri runtime-state smoke should reach dev/runtime startup path')
  assert.doesNotMatch(output, suspiciousPattern, 'tauri runtime-state smoke log must not contain startup/runtime failure signatures')

  console.log('tauri debug runtime-state checks passed')
} finally {
  await stopChild()
  await writeFile(logPath, output)
  if (existsSync(logPath)) {
    if (process.env.HIVEN_KEEP_TAURI_RUNTIME_STATE_LOG === '1') console.log(`kept tauri debug runtime-state log at ${logPath}`)
    else rmSync(logPath, { force: true })
  }
}
