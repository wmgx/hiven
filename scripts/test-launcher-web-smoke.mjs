#!/usr/bin/env node
/**
 * Optional vite smoke for launcher-only window entries.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'

// --- optional live vite smoke (best-effort; skip if vite fails to bind) ---
async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port)
        else reject(new Error('failed to allocate a local port'))
      })
    })
    server.on('error', reject)
  })
}

async function waitFor(url, timeoutMs = 12_000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw lastError ?? new Error(`timeout waiting for ${url}`)
}

const runLive = process.env.HIVEN_WEB_SMOKE_LIVE === '1'
if (!runLive) {
  console.log('launcher web smoke skipped (set HIVEN_WEB_SMOKE_LIVE=1 for vite probe)')
  process.exit(0)
}

const port = await getFreePort()
const baseUrl = `http://127.0.0.1:${port}`
const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
})
let output = ''
vite.stdout.on('data', (chunk) => { output += chunk.toString() })
vite.stderr.on('data', (chunk) => { output += chunk.toString() })

try {
  await waitFor(`${baseUrl}/`)
  for (const path of ['/?window=launcher', '/?window=quick-editor']) {
    const res = await fetch(`${baseUrl}${path}`)
    assert.ok(res.ok, `${path} should respond ok`)
  }
  console.log('launcher web smoke live checks passed')
} catch (error) {
  error.message = `${error.message}\n\nvite output:\n${output.slice(-2000)}`
  throw error
} finally {
  vite.kill('SIGTERM')
}
