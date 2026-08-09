#!/usr/bin/env node
/**
 * Static + optional vite smoke for launcher-only window entries.
 * Avoids retired CommandPalette / EditorWindow / SurfaceShell routes.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'

const read = (path) => readFileSync(path, 'utf8')

// --- static contracts ---
assert.equal(existsSync('src/components/CommandPalette.tsx'), false)
assert.equal(existsSync('src/components/EditorWindow.tsx'), false)
assert.equal(existsSync('src/surfaces/SurfaceShell.tsx'), false)

const app = read('src/App.tsx')
const main = read('src/main.tsx')
const host = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const globalLauncher = read('src/components/GlobalLauncher.tsx')

assert.match(app, /GlobalLauncher|LauncherRuntimeApp|registerBundledPluginPackages/)
assert.match(main, /windowType|launcher|quick-editor|plugin-surface/)
assert.match(globalLauncher, /GlobalLauncherHost/)
assert.match(host, /useLauncherSession|show_launcher|GlobalLauncher/)
assert.doesNotMatch(host, /openGlobalLauncherOverlay\(['"]pinned-only['"]\)/, 'pinned-only overlay mode retired')

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
  console.log('launcher web smoke static checks passed (set HIVEN_WEB_SMOKE_LIVE=1 for vite probe)')
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
