/** One opening owns one handoff to its explicitly marked, ready control. */
export function focusInitialSurfaceTarget(panel: HTMLElement, settingsOwnFocus = false): () => void {
  const document = panel.ownerDocument
  const view = document.defaultView
  if (!view) return () => {}
  let active = true
  let frame: number | null = null
  let shell: HTMLElement | null = null
  let fallbackFocused = false
  let focusing = false
  const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  const observer = new view.MutationObserver(schedule)
  const timeout = view.setTimeout(stop, 10_000)

  function stop() {
    active = false
    if (frame !== null) view!.cancelAnimationFrame(frame)
    frame = null
    observer.disconnect()
    view!.clearTimeout(timeout)
    for (const event of interactions) document.removeEventListener(event, stop, true)
    document.removeEventListener('focusin', onFocus, true)
    view!.removeEventListener('blur', stop)
  }

  function onFocus() {
    // React autoFocus or an explicit focus elsewhere also owns the handoff.
    if (!focusing) stop()
  }

  function focus(target: HTMLElement) {
    focusing = true
    try { target.focus({ preventScroll: true }) } finally { focusing = false }
  }

  function attempt() {
    frame = null
    if (!active || !panel.isConnected) return stop()
    const current = panel.querySelector<HTMLElement>('.global-launcher-surface-shell, .global-launcher-settings-shell, .global-launcher-host-surface-shell')
    if (shell && current !== shell) return stop()
    shell = current
    if (!shell) return
    if (settingsOwnFocus && shell.querySelector('[data-settings-navigation-root]')) return stop()
    // A child may have taken focus in its layout effect before we subscribed.
    if (document.activeElement !== shell && shell.contains(document.activeElement)) return stop()
    const target = shell.querySelector<HTMLElement>('[data-plugin-surface-autofocus]')
    if (target && target.isConnected && target.getClientRects().length > 0
      && !target.matches(':disabled, [disabled], [type="hidden"]')
      && !target.closest('[inert], [hidden], [aria-hidden="true"], [aria-disabled="true"]')
      && view!.getComputedStyle(target).visibility === 'visible') {
      if (document.activeElement !== target) focus(target)
      return stop()
    }
    if (!fallbackFocused) {
      focus(shell)
      fallbackFocused = true
    }
  }

  function schedule() {
    if (active && frame === null) frame = view!.requestAnimationFrame(attempt)
  }

  observer.observe(panel, { childList: true, subtree: true, attributes: true })
  for (const event of interactions) document.addEventListener(event, stop, { capture: true, passive: true })
  document.addEventListener('focusin', onFocus, true)
  view.addEventListener('blur', stop)
  schedule()
  return stop
}
