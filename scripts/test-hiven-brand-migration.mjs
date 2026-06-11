import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

function assertIncludes(source, needle, message) {
  assert.ok(source.includes(needle), message)
}

function assertNotIncludes(source, needle, message) {
  assert.ok(!source.includes(needle), message)
}

const packageJson = JSON.parse(read('package.json'))
const packageLock = JSON.parse(read('package-lock.json'))
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))
const cargoToml = read('src-tauri/Cargo.toml')
const tauriLib = read('src-tauri/src/lib.rs')
const hotkeys = read('src-tauri/src/hotkeys.rs')
const app = read('src/App.tsx')
const globalLauncher = read('src/components/GlobalLauncher.tsx')
const main = read('src/main.tsx')
const store = read('src/store.ts')
const pluginStore = read('src/workspace/pluginStore.ts')
const workspaceStore = read('src/workspace/workspaceStore.ts')
const cdnLoader = read('src/utils/cdnLoader.ts')
const pluginRuntime = read('src/workspace/pluginRuntime.ts')
const pluginHostSdk = read('src/pluginHostSdk.ts')
const pluginScaffold = read('src/workspace/pluginScaffold.ts')
const tsconfig = read('tsconfig.app.json')
const viteConfig = read('vite.config.ts')
const workflow = read('.github/workflows/build.yml')
const indexHtml = read('index.html')
const configInit = read('src/configInit.ts')

assert.equal(packageJson.name, 'hiven-app', 'package.json should use the hiven app package name')
assert.equal(packageLock.name, 'hiven-app', 'package-lock root name should use hiven-app')
assert.equal(packageLock.packages[''].name, 'hiven-app', 'package-lock package metadata should use hiven-app')
assertIncludes(indexHtml, '<title>hiven</title>', 'HTML title should use hiven')

assert.equal(tauriConfig.productName, 'hiven', 'Tauri productName should be hiven')
assert.equal(tauriConfig.identifier, 'com.hiven.app', 'Tauri bundle identifier should be com.hiven.app')
assert.equal(tauriConfig.app.windows.find((window) => window.label === 'main')?.title, 'hiven', 'main window title should be hiven')
assert.equal(tauriConfig.app.windows.find((window) => window.label === 'launcher')?.title, 'hiven Launcher', 'launcher window title should be hiven Launcher')
assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
  'https://proxy.github.wmgx.top/github/wmgx/hiven/releases/latest/download/latest.json',
  'https://github.com/wmgx/hiven/releases/latest/download/latest.json',
], 'updater endpoints should target the renamed hiven GitHub repo through the new proxy first')

assertIncludes(cargoToml, 'name = "hiven"', 'Cargo package name should be hiven')
assertIncludes(cargoToml, 'description = "hiven', 'Cargo description should use hiven')
assertIncludes(cargoToml, 'authors = ["hiven"]', 'Cargo authors should use hiven')

assertIncludes(tauriLib, 'join("hiven")', 'native config directory should point at ~/.local/hiven')
assertIncludes(tauriLib, 'join("fluxtext")', 'native config init should still know the legacy FluxText directory for migration')
assertIncludes(tauriLib, 'migrate_legacy_config_dir', 'native config init should migrate legacy config data')
assertIncludes(tauriLib, '[hiven]', 'native logs should use the hiven prefix')
assertIncludes(tauriLib, 'hiven://launcher-open', 'native launcher event should use hiven scheme')
assertNotIncludes(tauriLib, 'fluxtext://launcher-open', 'native launcher event should not use fluxtext scheme')
assertIncludes(hotkeys, 'hiven://double-modifier-hotkey-error', 'hotkey event should use hiven scheme')

assertIncludes(store, "watchDirectory: '~/.local/hiven/plugins/installed'", 'default watch directory should point at hiven plugins')
assertIncludes(store, "name: 'hiven-settings'", 'settings store should persist under hiven-settings')
assertIncludes(store, 'fluxtext-settings', 'settings store should read legacy FluxText settings during migration')
assertIncludes(pluginStore, "name: 'hiven-plugins'", 'plugin store should persist under hiven-plugins')
assertIncludes(pluginStore, 'fluxtext-plugins', 'plugin store should read legacy FluxText plugin data during migration')
assertIncludes(workspaceStore, "name: 'hiven-workspace'", 'workspace store should persist under hiven-workspace')
assertIncludes(workspaceStore, 'fluxtext-workspace', 'workspace store should read legacy FluxText workspace data during migration')
assertIncludes(cdnLoader, "const DB_NAME = 'hiven-cdn-cache'", 'CDN cache DB should use hiven')
assertIncludes(cdnLoader, 'fluxtext-cdn-cache', 'CDN cache should include a legacy migration path')
assertIncludes(main, "localStorage.getItem('hiven-settings')", 'theme bootstrap should read hiven settings')
assertIncludes(main, "localStorage.getItem('fluxtext-settings')", 'theme bootstrap should fall back to legacy FluxText settings')

assertIncludes(pluginRuntime, 'HivenPlugin?: PluginHostSdk', 'runtime should expose HivenPlugin on window')
assertIncludes(pluginRuntime, 'FluxTextPlugin?: PluginHostSdk', 'runtime should keep deprecated FluxTextPlugin compatibility')
assertIncludes(pluginRuntime, 'window.HivenPlugin = sdk', 'runtime should install HivenPlugin as the primary global')
assertIncludes(pluginHostSdk, 'window.HivenPlugin', 'SDK accessor should prefer HivenPlugin')
assertIncludes(pluginHostSdk, 'window.FluxTextPlugin', 'SDK accessor should keep legacy FluxTextPlugin fallback')
assertIncludes(pluginScaffold, 'globalThis.HivenPlugin', 'new plugin scaffold should use HivenPlugin')

assertIncludes(tsconfig, '"@hiven/plugin"', 'TypeScript paths should expose @hiven/plugin')
assertIncludes(tsconfig, '"@fluxtext/plugin"', 'TypeScript paths should keep @fluxtext/plugin compatibility')
assertIncludes(viteConfig, "'@hiven/plugin'", 'Vite alias should expose @hiven/plugin')
assertIncludes(viteConfig, "'@fluxtext/plugin'", 'Vite alias should keep @fluxtext/plugin compatibility')

for (const source of [app, globalLauncher]) {
  assertIncludes(source, 'hiven://', 'frontend events should use hiven scheme')
  assertNotIncludes(source, 'fluxtext://', 'frontend runtime events should not use fluxtext scheme')
}

assertIncludes(configInit, 'proxy.github.wmgx.top', 'builtin plugin downloads should use the new proxy host')
assertIncludes(configInit, 'wmgx/hiven', 'builtin plugin downloads should target the renamed hiven repository')
assertNotIncludes(configInit, 'proxy.flux.wmgx.top', 'builtin plugin downloads should not use the old proxy host')
assertIncludes(workflow, "releaseName: 'hiven ${{ github.ref_name }}'", 'GitHub release name should use hiven')
