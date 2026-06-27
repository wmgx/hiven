#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import net from 'node:net'

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

async function waitFor(url, timeoutMs = 15_000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`HTTP ${response.status} for ${url}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`)
}

async function main() {
  const port = await getFreePort()
  const baseUrl = `http://127.0.0.1:${port}`
  const vite = spawn(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let output = ''
  vite.stdout.on('data', (chunk) => { output += chunk.toString() })
  vite.stderr.on('data', (chunk) => { output += chunk.toString() })

  try {
    const html = await (await waitFor(`${baseUrl}/?window=launcher`)).text()
    assert.match(html, /id="root"/, 'launcher web route should serve the app root')
    assert.match(html, /\/src\/main\.tsx/, 'launcher web route should load the Vite entry')

    const mainSource = readFileSync('src/main.tsx', 'utf8')
    assert.match(mainSource, /document\.documentElement\.dataset\.window\s*=\s*['"]launcher['"]/, 'main entry should mark launcher documents')
    assert.match(mainSource, /windowType === ['"]plugin-surface['"]/, 'main entry should keep plugin surface routing')
    assert.match(mainSource, /windowType === ['"]editor['"]/, 'main entry should keep editor routing')

    const appSource = readFileSync('src/App.tsx', 'utf8')
    assert.match(appSource, /isLauncherWindow\(\)\s*\?\s*<LauncherWindowApp \/>/, 'App should route launcher windows to LauncherWindowApp')
    assert.match(appSource, /openGlobalLauncherOverlay\(['"]pinned-only['"]\)/, 'launcher window should open the standalone pinned launcher flow')
  } catch (error) {
    error.message = `${error.message}\n\nvite output:\n${output}`
    throw error
  } finally {
    vite.kill('SIGTERM')
  }

  console.log('launcher web smoke checks passed')
}

main()
