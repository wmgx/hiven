import { isImageDataUrl } from './qrCore'

function isEditing(event: Event): boolean {
  return event.composedPath().some((target) => (
    target instanceof Element && Boolean(target.closest('input, textarea, [contenteditable]'))
  ))
}

/** A registered native paste action owns its following DOM paste until the gesture ends. */
export function createQrPasteHandlers(actions: {
  nativeAvailable: () => boolean
  native: () => void
  blob: (blob: Blob) => void
  dataUrl: (text: string) => void
  unreadable: () => void
}) {
  let nativeGesture = false
  let composing = false
  return {
    shortcut() {
      if (nativeGesture || composing || !actions.nativeAvailable()) return
      nativeGesture = true
      actions.native()
    },
    keyup(event: KeyboardEvent) {
      if (['v', 'control', 'meta'].includes(event.key.toLowerCase())) nativeGesture = false
    },
    compositionstart() {
      composing = true
      nativeGesture = false
    },
    compositionend() { composing = false },
    blur() {
      nativeGesture = false
      composing = false
    },
    paste(event: ClipboardEvent) {
      if (event.defaultPrevented || composing || isEditing(event)) return
      if (nativeGesture) {
        event.preventDefault()
        return
      }
      const clipboard = event.clipboardData
      if (!clipboard) return
      for (const item of Array.from(clipboard.items)) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        event.preventDefault()
        actions.blob(file)
        return
      }
      const text = clipboard.getData('text/plain')
      event.preventDefault()
      if (isImageDataUrl(text)) actions.dataUrl(text)
      else actions.unreadable()
    },
  }
}
