let findHandler: (() => void) | null = null
let focusHandler: (() => void) | null = null
let overlayEscapeHandler: ((event: KeyboardEvent) => boolean) | null = null

export const quickEditorImperative = {
  registerFind: (fn: () => void) => { findHandler = fn },
  unregisterFind: () => { findHandler = null },
  triggerFind: () => { findHandler?.() },
  registerFocus: (fn: () => void) => { focusHandler = fn },
  unregisterFocus: () => { focusHandler = null },
  triggerFocus: () => { focusHandler?.() },
  registerOverlayEscape: (fn: (event: KeyboardEvent) => boolean) => { overlayEscapeHandler = fn },
  unregisterOverlayEscape: () => { overlayEscapeHandler = null },
  handleOverlayEscape: (event: KeyboardEvent): boolean => overlayEscapeHandler?.(event) ?? false,
}
