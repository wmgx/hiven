let findHandler: (() => void) | null = null

export const quickEditorImperative = {
  registerFind: (fn: () => void) => { findHandler = fn },
  unregisterFind: () => { findHandler = null },
  triggerFind: () => { findHandler?.() },
}
