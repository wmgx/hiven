import assert from 'node:assert/strict'
import { createNativeDiagnostics } from '../src/workspace/debugSnapshot.ts'

const diagnostics = createNativeDiagnostics()
for (let i = 0; i < 25; i++) diagnostics.record('clipboard_read_public_text', new Error('private clipboard contents'))
diagnostics.record('plugin:global-shortcut|register', 'private error', ['Control+Shift+V'])
assert.equal(diagnostics.errors().length, 20)
assert.equal(diagnostics.registrationFailure('Control+Shift+V'), 'ShortcutRegistrationFailed')
assert.equal(diagnostics.errors().at(-1)?.code, 'NativeCommandFailed')
assert.equal(JSON.stringify(diagnostics.errors()).includes('private'), false)
console.log('PASS native diagnostics: bounded ring and fixed codes without error content')
