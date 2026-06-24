#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const files = {
  packageJson: read('package.json'),
  pluginTypes: read('src/workspace/pluginTypes.ts'),
  pluginPermissions: read('src/workspace/pluginPermissions.ts'),
  globalLauncher: read('src/components/GlobalLauncher.tsx'),
  tauriLib: read('src-tauri/src/lib.rs'),
  translateManifest: read('src/plugins/translate/manifest.json'),
  translateAdapters: read('src/plugins/translate/providers/adapters.ts'),
  translateSurface: read('src/plugins/translate/surfaces/TranslateSurface.tsx'),
}

assert.equal(
  JSON.parse(files.packageJson).scripts?.['test:plugin-network-proxy'],
  'node scripts/test-plugin-network-proxy.mjs',
  'package.json must expose test:plugin-network-proxy',
)

assert.match(files.pluginTypes, /PluginNetworkApi/, 'pluginTypes must define PluginNetworkApi')
assert.match(files.pluginTypes, /network:\s*PluginNetworkApi/, 'PluginSurfaceHostApi must expose host.network')
assert.match(files.pluginTypes, /'network\.request'/, 'PluginPermission must include network.request')
assert.match(files.pluginPermissions, /'network\.request'/, 'ALL_PLUGIN_PERMISSIONS must include network.request')
assert.match(files.pluginPermissions, /Network request|访问网络|网络请求/, 'network.request must have localized permission labels')

assert.match(files.globalLauncher, /network:\s*createPluginNetwork\(/, 'GlobalLauncher surface host must pass createPluginNetwork')
assert.match(files.globalLauncher, /import\s*\{\s*createPluginNetwork\s*\}/, 'GlobalLauncher must import createPluginNetwork')

assert.match(files.tauriLib, /struct\s+ProxyHttpRequest/, 'Tauri must model ProxyHttpRequest')
assert.match(files.tauriLib, /struct\s+ProxyHttpResponse/, 'Tauri must model ProxyHttpResponse')
assert.match(files.tauriLib, /async\s+fn\s+plugin_http_request\b/, 'Tauri must expose plugin_http_request command')
assert.match(files.tauriLib, /generate_handler!\[[\s\S]*plugin_http_request/, 'plugin_http_request must be registered')
assert.match(files.tauriLib, /matches!\([^\n]*"http"\s*\|\s*"https"/, 'proxy must only allow http/https URLs')
assert.match(files.tauriLib, /reqwest::Method::from_bytes/, 'proxy must pass through request method')
assert.match(files.tauriLib, /headers/, 'proxy must pass headers')
assert.match(files.tauriLib, /body/, 'proxy must pass body')

const manifest = JSON.parse(files.translateManifest)
assert.ok(manifest.permissions?.includes('network.request'), 'translate manifest must request network.request')
assert.match(files.translateAdapters, /network:\s*PluginNetworkApi|PluginNetworkApi/, 'translate adapters must accept PluginNetworkApi')
assert.match(files.translateAdapters, /network\.request/, 'translate adapters must call host network proxy')
assert.doesNotMatch(files.translateAdapters, /\bfetch\(/, 'translate adapters must not call browser fetch directly')
assert.match(files.translateSurface, /network:\s*host\.network|host\.network/, 'TranslateSurface must pass host.network into adapter')

console.log('plugin network proxy checks passed')
