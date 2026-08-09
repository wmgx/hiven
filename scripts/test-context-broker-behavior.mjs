#!/usr/bin/env node
/** Context broker static contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const broker = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
assert.match(broker, /getActiveEditorContextSnapshot|getEditorContext/, 'reads editor context')
assert.match(broker, /WorkContextSnapshot|ContextSnapshotProvider/, 'snapshot types')
assert.match(broker, /isTauriRuntime|__TAURI_INTERNALS__/, 'tauri guard')
assert.match(broker, /typeof window|window\.location|getActiveEditorContextSnapshot/, 'safe window/editor access path')
console.log('context broker behavior (static) checks passed')
