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
const webNativeBridge = read('src/workspace/webNativeBridge.ts')
const desktopBridge = read('src-tauri/src/desktop_bridge.rs')
const viteConfig = read('vite.config.ts')
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const launcherLifecycle = read('src/components/launcher/GlobalLauncherHostLifecycle.ts')
const launcherHostSurfaceBridge = read('src/workspace/launcherHostSurfaceBridge.ts')
const pluginSurfaceOpenRequest = read('src/workspace/pluginSurfaceOpenRequest.ts')
const quickEditorRequests = read('src/workspace/quickEditor/quickEditorRequests.ts')
const launcherLayout = read('src/components/launcher/GlobalLauncherLayout.ts')
const indexCss = read('src/index.css')
const selectionController = read('src/components/launcher/useGlobalLauncherSelectionController.ts')
const launcherClose = read('src/components/launcher/GlobalLauncherClose.ts')
const launcherSurfaceFrame = read('src/components/launcher/GlobalLauncherSurfaceFrame.ts')
const launcherPluginSurfaceFrame = read('src/components/launcher/GlobalLauncherPluginSurfaceFrame.tsx')
const launcherSystemSurfaceFrame = read('src/components/launcher/GlobalLauncherSystemSurfaceFrame.tsx')

assert.match(app, /GlobalLauncher|LauncherRuntimeApp|registerBundledPluginPackages/)
assert.match(main, /windowType|launcher|quick-editor|plugin-surface/)
assert.match(main, /installWebNativeBridge/, 'browser entry should connect to the native validation bridge')
assert.match(main, /dataset\.webNativeBridge = 'true'/, 'browser validation should expose a stable layout marker')
assert.match(main, /isNativeTauriRuntime \? null : 'launcher'/, 'plain browser entry should use launcher window layout')
assert.match(main, /if \(isNativeTauriRuntime\) \{[\s\S]*contextmenu/, 'browser context menu should remain available for verification')
assert.match(globalLauncher, /GlobalLauncherHost/)
assert.match(host, /openExternalUrl/, 'launcher URL actions should use the host web fallback')
assert.doesNotMatch(host, /from '@tauri-apps\/plugin-shell'/, 'launcher host must not require Tauri for URL actions')
assert.match(host, /useLauncherSession|show_launcher|GlobalLauncher/)
assert.doesNotMatch(host, /openGlobalLauncherOverlay\(['"]pinned-only['"]\)/, 'pinned-only overlay mode retired')
assert.match(webNativeBridge, /startNativeValidationRelay/, 'desktop runtime should relay browser commands to real Tauri invoke')
assert.match(webNativeBridge, /plugin:event\|listen/, 'Tauri events should be relayed to browser callbacks')
assert.match(webNativeBridge, /__CHANNEL__:/, 'streaming command channels should be relayed')
assert.match(webNativeBridge, /shareDesktopLocalStorage/, 'browser should hydrate persisted desktop theme, locale, and settings')
assert.match(webNativeBridge, /try\s*\{\s*await shareDesktopLocalStorage\(\)[\s\S]*catch/, 'a stalled desktop snapshot must not block the browser mirror from mounting')
assert.match(webNativeBridge, /catch[\s\S]*__HIVEN_WEB_NATIVE_BRIDGE__ = false[\s\S]*delete[\s\S]*__TAURI_INTERNALS__[\s\S]*return false/, 'a stale desktop relay must fall back to browser-only mode')
assert.doesNotMatch(webNativeBridge, /nativeStorageCommands\.set/, 'validation browser must never write into desktop localStorage')
assert.match(desktopBridge, /cfg!\(debug_assertions\)/, 'validation HTTP routes must stay debug-only')
assert.match(desktopBridge, /invalid validation token/, 'validation HTTP routes must require the session token')
assert.match(desktopBridge, /origin not allowed/, 'validation HTTP routes must reject unrelated web origins')
assert.match(desktopBridge, /MAX_VALIDATION_RESULT_BODY_BYTES[\s\S]*64 \* 1024 \* 1024/, 'validation results must carry configured clipboard images')
assert.match(viteConfig, /host: 'localhost'/, 'Vite must preserve the desktop WebKit storage origin')
assert.equal(tauriConfig.build.devUrl, 'http://localhost:1420')
assert.match(app, /isNativeDesktopRuntime\(\) \? installGlobalPinnedLauncherHotkeys/, 'validation browser must not register desktop global shortcuts')
assert.match(launcherLifecycle, /!window\.__HIVEN_WEB_NATIVE_BRIDGE__/, 'validation browser must not control the desktop launcher window lifecycle')
assert.match(webNativeBridge, /export function isNativeDesktopRuntime[\s\S]*!window\.__HIVEN_WEB_NATIVE_BRIDGE__/, 'native UI ownership must exclude the validation browser')
for (const source of [launcherHostSurfaceBridge, pluginSurfaceOpenRequest, quickEditorRequests]) {
  assert.match(source, /isNativeDesktopRuntime/, 'browser UI routes must stay in the current browser launcher')
}
assert.match(launcherLayout, /validationBrowser[\s\S]*704px/, 'browser launcher should keep desktop panel width')
assert.match(indexCss, /data-web-native-bridge='true'[\s\S]*min-width: 944px/, 'DevTools must not compress browser validation surfaces')
assert.match(selectionController, /isNativeDesktopRuntime\(\)[\s\S]*showPluginSurfaceWindow/, 'window-presented plugins must stay in the validation browser')
assert.match(launcherClose, /__HIVEN_WEB_NATIVE_BRIDGE__[\s\S]*setOpen\(true\)/, 'validation launcher must remain visible after actions and dismissals')
assert.match(launcherSurfaceFrame, /scheduleSurfaceExit[\s\S]*setTimeout[\s\S]*90/, 'plugin surfaces should finish their short exit before navigation')
assert.match(launcherPluginSurfaceFrame, /global-launcher-surface-shell[\s\S]{0,100}is-exiting/, 'plugin surface shells should expose the shared exit state')
assert.match(host, /scheduleHostSurfaceExit[\s\S]*setTimeout[\s\S]*90/, 'system surfaces should finish their short exit before navigation')
assert.match(launcherSystemSurfaceFrame, /global-launcher-host-surface-shell[\s\S]{0,140}is-exiting/, 'settings, learned, and quick editor should share the host exit state')

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
