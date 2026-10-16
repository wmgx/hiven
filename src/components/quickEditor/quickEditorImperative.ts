import type { QuickEditorCommandOwner, QuickEditorCommandTarget } from '../../workspace/quickEditor/quickEditorCommandTarget'

let findHandler: (() => void) | null = null
let focusHandler: (() => void) | null = null
let overlayEscapeHandler: ((event: KeyboardEvent) => boolean) | null = null
const commandTargetHandlers = new Map<string, (owner: QuickEditorCommandOwner) => QuickEditorCommandTarget>()
const paneFocusHandlers = new Map<string, () => void>()

export const quickEditorImperative = {
  registerFind: (fn: () => void) => { findHandler = fn },
  unregisterFind: () => { findHandler = null },
  triggerFind: () => { findHandler?.() },
  registerFocus: (fn: () => void) => { focusHandler = fn },
  unregisterFocus: () => { focusHandler = null },
  triggerFocus: (paneId?: string) => { (paneId ? paneFocusHandlers.get(paneId) : focusHandler)?.() },
  registerPaneFocus: (paneId: string, fn: () => void) => { paneFocusHandlers.set(paneId, fn) },
  unregisterPaneFocus: (paneId: string) => { paneFocusHandlers.delete(paneId) },
  registerCommandTarget: (paneId: string, fn: (owner: QuickEditorCommandOwner) => QuickEditorCommandTarget) => {
    commandTargetHandlers.set(paneId, fn)
  },
  unregisterCommandTarget: (paneId: string) => { commandTargetHandlers.delete(paneId) },
  captureCommandTarget: (owner: QuickEditorCommandOwner, paneId: string) => commandTargetHandlers.get(paneId)?.(owner) ?? null,
  registerOverlayEscape: (fn: (event: KeyboardEvent) => boolean) => { overlayEscapeHandler = fn },
  unregisterOverlayEscape: () => { overlayEscapeHandler = null },
  handleOverlayEscape: (event: KeyboardEvent): boolean => overlayEscapeHandler?.(event) ?? false,
}
