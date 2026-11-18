import assert from 'node:assert/strict'
import { findSurfaceAction, shortcutKey, shortcutLabel, type SurfaceActionDefinition } from '../src/ui/surfaceActions.ts'

const event = (key: string, modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
  key, target: null, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers,
})

assert.equal(shortcutKey(event('V', { metaKey: true })), 'mod+v')
assert.equal(shortcutKey(event('Enter', { ctrlKey: true, shiftKey: true })), 'mod+shift+enter')
assert.equal(shortcutLabel('mod+shift+enter'), '⌘⇧↵')
assert.equal(shortcutLabel('alt+arrowup'), '⌥↑')

const actions: SurfaceActionDefinition[] = [
  { id: 'copy', label: 'Copy', shortcut: 'enter', shortcutAliases: ['mod+c'], run() {} },
  { id: 'disabled', label: 'Disabled', shortcut: 'mod+s', disabled: true, run() {} },
]
assert.equal(findSurfaceAction(actions, 'mod+c')?.id, 'copy')
assert.equal(findSurfaceAction(actions, 'mod+s'), undefined)

console.log('surface action shortcut normalization checks passed')
