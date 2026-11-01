import { useRef, type CompositionEvent, type KeyboardEvent } from 'react'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'

/**
 * A key like "mod+shift+c", "enter", "alt+arrowup". `mod` is ⌘ on macOS and Ctrl elsewhere.
 * A handler returning false lets the key through (no preventDefault).
 */
export type ShortcutMap = Record<string, (event: KeyboardEvent) => void | boolean>

function keyOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey || event.ctrlKey) parts.push('mod')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(event.key.toLowerCase())
  return parts.join('+')
}

/**
 * Surface-level key bindings for plugins: IME composition never triggers them,
 * and mod+c yields to a real text selection. Spread `handlers` on the surface root.
 */
export function useShortcuts(map: ShortcutMap) {
  const composing = useRef(false)
  const latest = useRef(map)
  latest.current = map
  const handlers = {
    onCompositionStart: (_event: CompositionEvent) => startImeComposition(composing),
    onCompositionEnd: (_event: CompositionEvent) => finishImeComposition(composing),
    onKeyDown: (event: KeyboardEvent) => {
      if (event.defaultPrevented || shouldIgnoreImeKeyDown(event, composing)) return
      const key = keyOf(event)
      const handler = latest.current[key]
      if (!handler) return
      if (key === 'mod+c' && (window.getSelection()?.toString() || selectedInputText(event.target))) return
      if (handler(event) === false) return
      event.preventDefault()
      event.stopPropagation()
    },
  }
  return { composingRef: composing, handlers }
}

function selectedInputText(target: EventTarget | null): boolean {
  return (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
    && target.selectionStart !== target.selectionEnd
}
