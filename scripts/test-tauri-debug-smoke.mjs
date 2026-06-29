#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const root = process.cwd()
const tempDir = join(root, 'temp')
mkdirSync(tempDir, { recursive: true })

const logPath = join(tempDir, `tauri-debug-smoke-${Date.now()}.log`)
const timeoutMs = Number(process.env.HIVEN_TAURI_SMOKE_TIMEOUT_MS ?? 25_000)
const shutdownMs = Number(process.env.HIVEN_TAURI_SMOKE_SHUTDOWN_MS ?? 2_000)
const suspiciousPattern = /Unhandled rejection|ReferenceError|TypeError|panic|panicked|compilation failed|error:/i
const npmCommand = process.env.npm_execpath ? process.execPath : 'npm'
const npmArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, 'run', 'tauri', '--', 'dev']
  : ['run', 'tauri', '--', 'dev']
const pathEntries = [
  process.env.npm_node_execpath ? dirname(process.env.npm_node_execpath) : '',
  '/opt/homebrew/bin',
  process.env.PATH ?? '',
].filter(Boolean)

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
child.stdout.on('data', (chunk) => {
  output += chunk.toString()
})
child.stderr.on('data', (chunk) => {
  output += chunk.toString()
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const closePromise = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))

let earlyExit = null
await Promise.race([
  closePromise.then((result) => { earlyExit = result }),
  sleep(timeoutMs),
])

if (earlyExit) {
  await writeFile(logPath, output)
  try {
    assert.fail(`tauri dev exited before smoke timeout: code=${earlyExit.code} signal=${earlyExit.signal}`)
  } finally {
    if (!process.env.HIVEN_KEEP_TAURI_SMOKE_LOG && existsSync(logPath)) rmSync(logPath, { force: true })
  }
}

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

await writeFile(logPath, output)

try {
  assert.match(output, /VITE v[\s\S]*ready|Running DevCommand|Running `target\/debug\/hiven`/, 'tauri debug smoke should reach the dev/runtime startup path')
  assert.doesNotMatch(output, suspiciousPattern, 'tauri debug smoke log must not contain startup/runtime failure signatures')
  console.log('tauri debug smoke checks passed')
} finally {
  if (existsSync(logPath)) {
    const shouldKeep = process.env.HIVEN_KEEP_TAURI_SMOKE_LOG === '1'
    if (!shouldKeep) rmSync(logPath, { force: true })
    else console.log(`kept tauri debug smoke log at ${logPath}`)
  }
}
