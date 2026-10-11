import type { PluginSettingsFieldTarget } from '../workspace/pluginSettingsStore'

const controlKinds = new Set(['text', 'textarea', 'number', 'select', 'switch', 'list'])

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected || element.getClientRects().length === 0) return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false
  }
  return true
}

function isAvailableControl(element: HTMLElement): boolean {
  return isVisible(element) && !element.matches(':disabled, [disabled], [type="hidden"]')
    && !element.closest('[aria-disabled="true"], [inert]')
    && element.tabIndex >= 0
}

function focus(element: HTMLElement): boolean {
  element.focus({ preventScroll: true })
  return element.ownerDocument.activeElement === element
}

/**
 * Locate using schema identity, never text, values or an interpolated selector.
 * A disabled/compound/action field falls back to its readable section. Focusing
 * an action button or one arbitrary item in an object list would be misleading.
 */
export function resolvePluginSettingsFieldNavigation(root: HTMLElement, target: PluginSettingsFieldTarget): {
  section: HTMLElement | null
  field: HTMLElement | null
  control: HTMLElement | null
} {
  const section = Array.from(root.querySelectorAll<HTMLElement>('[data-settings-section-id]'))
    .find((node) => node.dataset.settingsSectionId === target.sectionId && isVisible(node)) ?? null
  const field = section
    ? Array.from(section.querySelectorAll<HTMLElement>('[data-settings-field-key]'))
      .find((node) => node.dataset.settingsFieldKey === target.fieldKey
        && node.closest('[data-settings-section-id]') === section && isVisible(node)) ?? null
    : null
  let control: HTMLElement | null = null
  if (field && field.dataset.settingsFieldDisabled !== 'true' && controlKinds.has(field.dataset.settingsFieldKind ?? '')) {
    // NumberField puts step buttons before the input; select the real editor.
    control = Array.from(field.querySelectorAll<HTMLElement>('input, textarea, select, [role="switch"], [role="combobox"]'))
      .find(isAvailableControl) ?? null
  }
  return { section, field, control }
}

/** One navigation request, including delayed DOM, cancelled on user interaction. */
export function navigateToPluginSettingsField(root: HTMLElement, target: PluginSettingsFieldTarget): () => void {
  const view = root.ownerDocument.defaultView
  if (!view) return () => {}
  let active = true
  let frame: number | null = null
  let fallbackFocused = false
  const document = root.ownerDocument
  const interactions = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
  const observer = new view.MutationObserver(schedule)

  function stop() {
    active = false
    if (frame !== null) view!.cancelAnimationFrame(frame)
    frame = null
    observer.disconnect()
    for (const event of interactions) document.removeEventListener(event, stop, true)
  }

  function attempt() {
    frame = null
    if (!active || !root.isConnected) return stop()
    if (!isVisible(root)) return
    const { section, field, control } = resolvePluginSettingsFieldNavigation(root, target)
    if (field || !fallbackFocused) {
      const destination = control ?? section ?? root
      ;(field ?? section ?? root).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
      if (!focus(destination) && section && destination !== section) focus(section)
      fallbackFocused = true
    }
    // Missing/hidden fields may render later. Observe only until they arrive or
    // the user takes over; normal re-renders must never pull the user back.
    if (field) stop()
  }

  function schedule() {
    if (active && frame === null) frame = view!.requestAnimationFrame(attempt)
  }

  observer.observe(root, { subtree: true, childList: true, attributes: true })
  for (const event of interactions) document.addEventListener(event, stop, { capture: true, passive: true })
  schedule()
  return stop
}
