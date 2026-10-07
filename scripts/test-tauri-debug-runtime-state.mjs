#!/usr/bin/env node

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { duration, isPortBusy, nativeExecutable, runNativeSmoke, tauriCommand } from './lib/tauri-debug-runner.mjs'

if (process.platform !== 'darwin') {
  console.log(`tauri debug runtime-state skipped: System Events window verification requires macOS (current: ${process.platform})`)
} else if (process.env.HIVEN_TAURI_SMOKE_FORCE !== '1' && await isPortBusy(1420)) {
  console.log('tauri debug runtime-state skipped: port 1420 already in use')
} else {
  const root = process.cwd()
  const tauriConfig = JSON.parse(await readFile(join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
  const windows = tauriConfig.app?.windows ?? []
  assert.equal(windows.length, 1, 'debug runtime-state smoke expects only one initial runtime window')
  assert.equal(windows[0].label, 'launcher', 'initial runtime window must be launcher')
  assert.equal(windows[0].visible, false, 'initial launcher runtime window must be hidden')
  assert.ok(!windows.some((window) => window.label === 'main'), 'debug runtime-state smoke must not find a retired main window in config')

  const result = await runNativeSmoke({
    root, name: 'tauri-debug-runtime-state', ...tauriCommand(), executable: nativeExecutable(root),
    timeoutMs: duration(process.env.HIVEN_TAURI_RUNTIME_STATE_TIMEOUT_MS, 25_000, 'startup timeout'),
    settleMs: duration(process.env.HIVEN_TAURI_RUNTIME_STATE_SETTLE_MS, 1_500, 'settle duration'),
    shutdownMs: duration(process.env.HIVEN_TAURI_RUNTIME_STATE_SHUTDOWN_MS, 2_000, 'shutdown timeout'),
    verifyTimeoutMs: duration(process.env.HIVEN_TAURI_RUNTIME_STATE_VERIFY_TIMEOUT_MS, 5_000, 'window verification timeout'),
    keepLog: process.env.HIVEN_KEEP_TAURI_RUNTIME_STATE_LOG === '1',
    verify: async ({ pid, signal, timeoutMs, record }) => {
      // Use the exact PID observed by the runner, never a name/global pgrep match.
      const script = `tell application "System Events"\nset matches to every process whose unix id is ${pid}\nif (count of matches) is not 1 then error "native process missing or ambiguous"\nset p to item 1 of matches\nreturn "pid=${pid} windows=" & (count of windows of p)\nend tell`
      const { stdout, stderr } = await promisify(execFile)('/usr/bin/osascript', ['-e', script], { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', signal })
      record(`System Events: ${stdout}${stderr}`)
      assert.equal(stdout.trim(), `pid=${pid} windows=0`, 'hidden-launcher startup must not expose a visible main/editor/plugin window')
    },
  })
  console.log(`tauri debug runtime-state checks passed: native pid=${result.pid}`)
  if (result.logPath) console.log(`kept tauri debug runtime-state log at ${result.logPath}`)
}
