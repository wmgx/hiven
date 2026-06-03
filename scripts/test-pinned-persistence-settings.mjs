import fs from 'node:fs'
import assert from 'node:assert/strict'

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function assertHas(source, pattern, message) {
  assert.match(source, pattern, message)
}

function readI18n() {
  const dir = 'src/i18n/locales'
  return fs.readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => fs.readFileSync(`${dir}/${f}`, 'utf8')).join('\n')
}

const files = {
  packageJson: read('package.json'),
  store: read('src/store.ts'),
  settingsView: read('src/views/SettingsView.tsx'),
  i18n: readI18n(),
}

assertHas(files.packageJson, /test:pinned-persistence-settings/, 'package.json should expose pinned persistence verifier')

for (const field of ['persistPinnedInput', 'persistPinnedTombstone', 'outputPreviewLimit', 'tombstoneTtlDays']) {
  assertHas(files.store, new RegExp(`${field}\\s*:`), `settings should include ${field}`)
}

assertHas(files.store, /pinnedTombstones:\s*state\.settings\.persistPinnedTombstone/, 'persist partialize should honor persistPinnedTombstone')
assertHas(files.store, /inputText:\s*state\.settings\.persistPinnedInput\s*\?/, 'persist partialize should honor persistPinnedInput')
assertHas(files.store, /slice\(0,\s*state\.settings\.outputPreviewLimit\)/, 'persist partialize should trim tombstone output preview')

assertHas(files.settingsView, /persistPinnedInput/, 'SettingsView should expose pinned input persistence')
assertHas(files.settingsView, /persistPinnedTombstone/, 'SettingsView should expose pinned tombstone persistence')
assertHas(files.settingsView, /getVersion\(\)\.then[\s\S]*\.catch/, 'SettingsView should not throw getVersion errors in non-Tauri browser smoke')
assertHas(files.i18n, /settings\.persistPinnedInput/, 'i18n should include pinned input setting label')
assertHas(files.i18n, /Pinned tools can remember input text/, 'i18n should include the pinned input privacy hint')

console.log('pinned persistence settings checks passed')
