#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const port = Number(process.env.HIVEN_WEB_SMOKE_PORT ?? 1437)
const baseUrl = `http://127.0.0.1:${port}`

const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: process.cwd(),
  env: { ...process.env, BROWSER: 'none' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
server.stdout.on('data', (chunk) => { output += chunk.toString() })
server.stderr.on('data', (chunk) => { output += chunk.toString() })

try {
  await waitForServer(baseUrl, 20_000)

  for (const path of ['/?window=launcher', '/?window=editor', '/?window=plugin-surface&source=builtin&pluginId=clipboard-history&surfaceId=history']) {
    const html = await readText(`${baseUrl}${path}`)
    assert.match(html, /<div id="root"><\/div>/, `${path} should serve the React root`)
    assert.match(html, /\/src\/main\.tsx/, `${path} should serve the Vite main entry`)
    assert.match(html, /<title>Hiven<\/title>/, `${path} should keep the Hiven document title`)
  }

  const mainModule = await readText(`${baseUrl}/src/main.tsx`)
  assert.match(mainModule, /windowType\s*===\s*['"]plugin-surface['"]/, 'main entry should route plugin surface windows')
  assert.match(mainModule, /windowType\s*===\s*['"]editor['"]/, 'main entry should route editor windows')
  assert.match(mainModule, /import\(['"](?:\.\/|\/)src\/App\.tsx['"]\)/, 'main entry should route launcher/default windows to App')

  const appModule = await readText(`${baseUrl}/src/App.tsx`)
  assert.match(appModule, /function\s+LauncherWindowApp/, 'launcher App module should expose LauncherWindowApp')
  assert.match(appModule, /BackgroundRuntime/, 'launcher App module should mount BackgroundRuntime')
  assert.match(appModule, /GlobalLauncher/, 'launcher App module should mount GlobalLauncher')
  assert.doesNotMatch(appModule, /function\s+MainApp\(|isEditorFallbackWindow/, 'launcher App module should not include the retired main-window fallback')

  console.log('launcher web smoke checks passed')
} finally {
  server.kill('SIGTERM')
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1_000)
    server.once('exit', () => { clearTimeout(timer); resolve(undefined) })
  })
}


async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for Vite dev server at ${url}. Last error: ${lastError?.message ?? 'unknown'}\n${output}`)
}

async function readText(url) {
  const response = await fetch(url)
  assert.equal(response.status, 200, `${url} should return HTTP 200`)
  return response.text()
}
