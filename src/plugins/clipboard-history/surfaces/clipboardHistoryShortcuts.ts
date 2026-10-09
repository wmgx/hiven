export type ClipboardHistoryShortcutFocus = {
  withinSurface: boolean
  nativeButton: boolean
  editing: boolean
}

export function readClipboardHistoryShortcutFocus(
  surface: HTMLElement,
  target: Element | null,
  activeElement: Element | null = target,
): ClipboardHistoryShortcutFocus {
  return {
    withinSurface: target !== null && surface.contains(target),
    nativeButton: Boolean(target?.closest('button') && !target.closest('.clipboard-history-item')),
    // Match the existing Delete/Backspace ownership, including SELECT controls.
    editing: activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'SELECT',
  }
}

export function getClipboardHistoryShortcuts({
  hasSelection,
  loading,
  enabled,
  blocked,
  focus,
}: {
  hasSelection: boolean
  loading: boolean
  enabled: boolean
  blocked: boolean
  focus: ClipboardHistoryShortcutFocus
}) {
  const available = hasSelection && !loading && enabled && !blocked && focus.withinSurface && !focus.nativeButton
  return {
    paste: available,
    returnToLauncher: available,
    delete: available && !focus.editing,
  }
}

/** Observe this surface only; a reused webview can retain or move focus outside it. */
export function observeClipboardHistoryShortcutFocus(
  surface: HTMLElement,
  onChange: (focus: ClipboardHistoryShortcutFocus) => void,
): () => void {
  const ownerDocument = surface.ownerDocument
  const ownerWindow = ownerDocument.defaultView
  if (!ownerWindow) return () => {}

  let disposed = false
  let windowFocused = ownerDocument.hasFocus()
  let pageShown = true
  let previous: ClipboardHistoryShortcutFocus | undefined
  const sync = () => {
    if (disposed) return
    const activeElement = windowFocused && pageShown && ownerDocument.visibilityState !== 'hidden'
      ? ownerDocument.activeElement
      : null
    const next = readClipboardHistoryShortcutFocus(surface, activeElement)
    if (previous && previous.withinSurface === next.withinSurface && previous.nativeButton === next.nativeButton && previous.editing === next.editing) return
    previous = next
    onChange(next)
  }
  const onFocusIn = () => {
    windowFocused = ownerDocument.hasFocus()
    sync()
  }
  // activeElement can still be the departing element during focusout.
  const onFocusOut = () => queueMicrotask(sync)
  const onWindowFocus = () => { windowFocused = true; sync() }
  const onWindowBlur = () => { windowFocused = false; sync() }
  const onPageShow = () => { pageShown = true; windowFocused = ownerDocument.hasFocus(); sync() }
  const onPageHide = () => { pageShown = false; sync() }
  const onVisibilityChange = () => { windowFocused = ownerDocument.hasFocus(); sync() }

  ownerDocument.addEventListener('focusin', onFocusIn)
  ownerDocument.addEventListener('focusout', onFocusOut)
  ownerDocument.addEventListener('visibilitychange', onVisibilityChange)
  ownerWindow.addEventListener('focus', onWindowFocus)
  ownerWindow.addEventListener('blur', onWindowBlur)
  ownerWindow.addEventListener('pageshow', onPageShow)
  ownerWindow.addEventListener('pagehide', onPageHide)
  // Removing a focused virtual row does not reliably emit focusout. Re-sample
  // after local DOM commits, without observing unrelated surfaces or attributes.
  const mutations = new ownerWindow.MutationObserver(sync)
  mutations.observe(surface, { childList: true, subtree: true })
  sync()
  return () => {
    disposed = true
    ownerDocument.removeEventListener('focusin', onFocusIn)
    ownerDocument.removeEventListener('focusout', onFocusOut)
    ownerDocument.removeEventListener('visibilitychange', onVisibilityChange)
    ownerWindow.removeEventListener('focus', onWindowFocus)
    ownerWindow.removeEventListener('blur', onWindowBlur)
    ownerWindow.removeEventListener('pageshow', onPageShow)
    ownerWindow.removeEventListener('pagehide', onPageHide)
    mutations.disconnect()
  }
}
