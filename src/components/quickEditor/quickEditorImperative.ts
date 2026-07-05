let findHandler: (() => void) | null = null
let focusHandler: (() => void) | null = null

export const quickEditorImperative = {
  registerFind: (fn: () => void) => { findHandler = fn },
  unregisterFind: () => { findHandler = null },
  triggerFind: () => { findHandler?.() },
  registerFocus: (fn: () => void) => { focusHandler = fn },
  unregisterFocus: () => { focusHandler = null },
  triggerFocus: () => { focusHandler?.() },
}
