import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(path, 'utf8')
}

const packageJson = JSON.parse(read('package.json'))
const packageLock = JSON.parse(read('package-lock.json'))
const tauriConfig = JSON.parse(read('src-tauri/tauri.conf.json'))

assert.equal(packageJson.name, 'hiven-app', 'package.json should use the hiven app package name')
assert.equal(packageLock.name, 'hiven-app', 'package-lock root name should use hiven-app')
assert.equal(packageLock.packages[''].name, 'hiven-app', 'package-lock package metadata should use hiven-app')

assert.equal(tauriConfig.productName, 'Hiven', 'Tauri productName should be Hiven')
assert.equal(tauriConfig.identifier, 'com.hiven.app', 'Tauri bundle identifier should be com.hiven.app')
assert.ok(!tauriConfig.app.windows.some((window) => window.label === 'main'), 'retired main window should not be declared after window architecture refactor')
assert.equal(tauriConfig.app.windows.find((window) => window.label === 'launcher')?.title, 'Hiven Launcher', 'launcher window title should be Hiven Launcher')
assert.deepEqual(tauriConfig.plugins.updater.endpoints, [
  'https://proxy.github.wmgx.top/github/wmgx/hiven/releases/latest/download/latest.json',
  'https://github.com/wmgx/hiven/releases/latest/download/latest.json',
], 'updater endpoints should target the renamed hiven GitHub repo through the new proxy first')

console.log('hiven brand migration checks passed')
