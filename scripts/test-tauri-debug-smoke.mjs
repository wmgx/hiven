#!/usr/bin/env node

import { duration, isPortBusy, nativeExecutable, runNativeSmoke, tauriCommand } from './lib/tauri-debug-runner.mjs'

if (!['linux', 'darwin'].includes(process.platform)) {
  console.log(`tauri debug smoke skipped: native process probing is unsupported on ${process.platform}`)
} else if (process.env.HIVEN_TAURI_SMOKE_FORCE !== '1' && await isPortBusy(1420)) {
  console.log('tauri debug smoke skipped: port 1420 already in use (set HIVEN_TAURI_SMOKE_FORCE=1 to force)')
} else {
  const root = process.cwd()
  const result = await runNativeSmoke({
    root, ...tauriCommand(), executable: nativeExecutable(root),
    timeoutMs: duration(process.env.HIVEN_TAURI_SMOKE_TIMEOUT_MS, 25_000, 'startup timeout'),
    settleMs: duration(process.env.HIVEN_TAURI_SMOKE_SETTLE_MS, 1_500, 'settle duration'),
    shutdownMs: duration(process.env.HIVEN_TAURI_SMOKE_SHUTDOWN_MS, 2_000, 'shutdown timeout'),
    keepLog: process.env.HIVEN_KEEP_TAURI_SMOKE_LOG === '1',
  })
  console.log(`tauri debug smoke checks passed: native pid=${result.pid}`)
  if (result.logPath) console.log(`kept tauri debug smoke log at ${result.logPath}`)
}
