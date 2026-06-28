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

    const pluginSurfaceHtml = await (await waitFor(`${baseUrl}/?window=plugin-surface&source=builtin&pluginId=clipboard-history&surfaceId=history`)).text()
    assert.match(pluginSurfaceHtml, /id="root"/, 'plugin surface web route should serve the app root')

    const editorHtml = await (await waitFor(`${baseUrl}/?window=editor`)).text()
    assert.match(editorHtml, /id="root"/, 'editor web route should serve the app root')

    const appSource = readFileSync('src/App.tsx', 'utf8')
    assert.match(appSource, /return\s+<LauncherRuntimeApp \/>/, 'App should mount the launcher runtime directly')
    assert.doesNotMatch(appSource, /isLauncherWindow\(\)|function MainApp/, 'App should not keep a retired main-window branch')
    assert.match(appSource, /openGlobalLauncherOverlay\(['"]pinned-only['"]\)/, 'launcher window should open the standalone pinned launcher flow')

    const surfaceShell = readFileSync('src/surfaces/SurfaceShell.tsx', 'utf8')
    assert.match(surfaceShell, /data-surface-id/, 'app surfaces should stamp a surface id for runtime inspection')
    assert.match(surfaceShell, /data-surface-kind/, 'app surfaces should stamp a surface kind for runtime inspection')

    const settingsSurface = readFileSync('src/surfaces/SettingsSurface.tsx', 'utf8')
    const pluginsSurface = readFileSync('src/surfaces/PluginsSurface.tsx', 'utf8')
    const pluginEditorSurface = readFileSync('src/surfaces/PluginEditorSurface.tsx', 'utf8')
    assert.match(settingsSurface, /<SurfaceShell[\s\S]*id="settings"/, 'Settings route should render through the Settings surface shell')
    assert.match(pluginsSurface, /<SurfaceShell[\s\S]*id="plugins"/, 'Plugins route should render through the Plugins surface shell')
    assert.match(pluginEditorSurface, /<SurfaceShell[\s\S]*id="plugin-editor"/, 'Plugin editor route should render through the PluginEditor surface shell')

    const editorBridge = readFileSync('src/workspace/editorBridge.ts', 'utf8')
    assert.match(editorBridge, /createEditorPane[\s\S]*sendEditorBridgeRequest\(['"]createEditorPane['"]/, 'launcher-to-editor pane creation should go through the editor bridge request path')
    assert.match(editorBridge, /registerEditorBridgeHandlers/, 'editor runtime should expose bridge handlers for launcher requests')

    const surfaceRegistry = readFileSync('src/surfaces/registry.ts', 'utf8')
    assert.match(surfaceRegistry, /surface_registry_snapshot/, 'surface registry should hydrate from Rust side state')
    assert.match(surfaceRegistry, /surface_registry_upsert/, 'surface registry should persist upserts into Rust side state')
  } catch (error) {
    error.message = `${error.message}\n\nvite output:\n${output}`
    throw error
  } finally {
    vite.kill('SIGTERM')
  }

  console.log('launcher web smoke checks passed')
}

main()
