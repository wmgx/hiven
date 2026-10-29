/**
 * The field a plugin marks `data-plugin-surface-autofocus` is the typing
 * target: typing while focus sits on a button, a list or the page goes into it.
 * A `"sticky"` field also takes focus back after clicks elsewhere. Other
 * fields keep focus when chosen.
 */
export const SURFACE_SHELL_SELECTOR = '.global-launcher-surface-shell, .global-launcher-settings-shell, .global-launcher-host-surface-shell'

const STICKY_SELECTOR = '[data-plugin-surface-autofocus="sticky"]'
const TYPING_SELECTOR = '[data-plugin-surface-autofocus]'
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'
const ACTIVATABLE_SELECTOR = 'button, a[href], summary, label, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"]'

function markedField(shell: HTMLElement, selector: string): HTMLElement | null {
  const element = shell.querySelector<HTMLElement>(selector)
  if (!element || element.matches(':disabled, [readonly]') || element.getClientRects().length === 0) return null
  if (element.closest('[inert], [hidden], [aria-hidden="true"]')) return null
  return element
}

function isEditable(element: Element | null): boolean {
  return element instanceof HTMLElement && (element.isContentEditable || element.matches('input, textarea, select'))
}

export function keepStickyFieldFocus(
  panel: HTMLElement,
  findShell = (root: HTMLElement) => root.querySelector<HTMLElement>(SURFACE_SHELL_SELECTOR),
): () => void {
  const document = panel.ownerDocument
  const view = document.defaultView
  if (!view) return () => {}
  let frame: number | null = null

  const target = (selector: string): HTMLElement | null => {
    // A listbox inside the panel is a result list, not a popup.
    const overlays = Array.from(document.querySelectorAll(OVERLAY_SELECTOR))
    if (overlays.some(element => element.getAttribute('role') !== 'listbox' || !panel.contains(element))) return null
    const shell = findShell(panel)
    return shell ? markedField(shell, selector) : null
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key.length !== 1 && event.key !== 'Process') return
    const active = document.activeElement
    if (isEditable(active) || !panel.contains(active ?? null) && active !== document.body) return
    // Space on a focused control is its keyboard activation.
    if (event.key === ' ' && active instanceof HTMLElement && active.matches(ACTIVATABLE_SELECTOR)) return
    // Focusing during keydown lets this keystroke land in the field.
    target(TYPING_SELECTOR)?.focus({ preventScroll: true })
  }

  function onClick(event: MouseEvent) {
    if (!(event.target instanceof Node) || !panel.contains(event.target)) return
    if (frame !== null) view!.cancelAnimationFrame(frame)
    // After the click's own handlers: a menu or dialog it opened keeps focus.
    frame = view!.requestAnimationFrame(() => {
      frame = null
      if (isEditable(document.activeElement)) return
      // Never collapse a text selection the user is making.
      if (view!.getSelection()?.isCollapsed === false) return
      target(STICKY_SELECTOR)?.focus({ preventScroll: true })
    })
  }

  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('click', onClick)
  return () => {
    if (frame !== null) view.cancelAnimationFrame(frame)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('click', onClick)
  }
}
