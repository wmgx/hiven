import type { ReactNode } from 'react'

export type SurfaceActionOrigin = 'click' | 'shortcut'

export type SurfaceActionDefinition = {
  id: string
  label: ReactNode
  shortcut?: string
  shortcutAliases?: readonly string[]
  disabled?: boolean
  shortcutDisabled?: boolean
  run(origin: SurfaceActionOrigin): void | Promise<void>
}

type ShortcutEvent = {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  target: EventTarget | null
}

export function shortcutKey(event: ShortcutEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(event.key.toLowerCase())
  return parts.join('+')
}

export function shortcutLabel(shortcut: string): string {
  const labels: Record<string, string> = {
    mod: '⌘', alt: '⌥', shift: '⇧', enter: '↵', escape: 'esc',
    backspace: '⌫', delete: '⌦', tab: '⇥', arrowup: '↑', arrowdown: '↓',
    arrowleft: '←', arrowright: '→',
  }
  return shortcut.split('+').map(part => labels[part] ?? part.toUpperCase()).join('')
}

export function shortcutYieldsToSelection(event: ShortcutEvent, key: string): boolean {
  if (key !== 'mod+c') return false
  const selected = typeof window !== 'undefined' ? window.getSelection()?.toString() : ''
  return Boolean(selected) || ((event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
    && event.target.selectionStart !== event.target.selectionEnd)
}

export function findSurfaceAction(actions: readonly SurfaceActionDefinition[], key: string): SurfaceActionDefinition | undefined {
  return actions.find(action => !action.disabled && !action.shortcutDisabled
    && (action.shortcut === key || action.shortcutAliases?.includes(key)))
}
