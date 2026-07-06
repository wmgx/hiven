#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
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
      const body = await response.text().catch(() => '')
      lastError = new Error(`HTTP ${response.status} for ${url}\n${body.slice(0, 600)}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw lastError ?? new Error(`timed out waiting for ${url}`)
}

async function fetchText(url) {
  const response = await waitFor(url)
  const text = await response.text()
  assert.doesNotMatch(text, /Internal server error|Pre-transform error|Failed to resolve import/i, `${url} should not contain Vite transform errors`)
  return text
}

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
  const routeUrls = [
    `${baseUrl}/?window=launcher`,
    `${baseUrl}/?window=quick-editor`,
    `${baseUrl}/?window=plugin-surface&source=builtin&pluginId=clipboard-history&surfaceId=history`,
  ]

  for (const url of routeUrls) {
    const html = await fetchText(url)
    assert.match(html, /id="root"/, `${url} should serve the app root`)
    assert.match(html, /\/src\/main\.tsx/, `${url} should load the shared Vite entry`)
  }

  const mainModule = await fetchText(`${baseUrl}/src/main.tsx`)
  assert.match(mainModule, /windowType === ['"]plugin-surface['"][\s\S]*PluginSurfaceWindow\.tsx/, 'main module should lazy-load PluginSurfaceWindow for plugin surface entries')
  assert.match(mainModule, /windowType === ['"]quick-editor['"][\s\S]*QuickEditorDetachedView\.tsx/, 'main module should lazy-load EditorWindow for editor entries')
  assert.match(mainModule, /App\.tsx/, 'main module should lazy-load App for launcher entries')

  const entryModules = [
    ['/src/App.tsx', /LauncherRuntimeApp|GlobalLauncher/],
    ['/src/views/QuickEditorDetachedView.tsx', /QuickEditorDetachedView|QuickEditorPanel/],
    ['/src/components/PluginSurfaceWindow.tsx', /PluginSurfaceWindow|PluginSurfaceRenderer/],
  ]

  for (const [path, expected] of entryModules) {
    const moduleText = await fetchText(`${baseUrl}${path}`)
    assert.match(moduleText, expected, `${path} should transform the expected window entry module`)
  }
} catch (error) {
  error.message = `${error.message}\n\nvite output:\n${output}`
  throw error
} finally {
  vite.kill('SIGTERM')
}

console.log('window entry runtime smoke checks passed')
