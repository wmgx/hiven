type Layer = {
  trigger: HTMLElement
  popup: HTMLElement
  isCurrent: () => boolean
  isComposing: () => boolean
  dismiss: () => void
}

const layers = new WeakMap<HTMLElement, Layer>()

/** A local popup declaration, never a window keyboard subscription. */
export function registerLocalEscapeLayer(layer: Layer): () => void {
  layers.set(layer.trigger, layer)
  layers.set(layer.popup, layer)
  return () => {
    if (layers.get(layer.trigger) === layer) layers.delete(layer.trigger)
    if (layers.get(layer.popup) === layer) layers.delete(layer.popup)
  }
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length) return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    if (node.hidden || node.inert || node.getAttribute('aria-hidden') === 'true') return false
    const style = node.ownerDocument.defaultView?.getComputedStyle(node)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false
  }
  return true
}

/** Only the active host's own focused, visible inline popup can take this Escape. */
export function consumeLocalEscapeLayer(event: KeyboardEvent, scope: HTMLElement | null): boolean {
  if (!scope || event.key !== 'Escape' || event.defaultPrevented) return false
  const focused = scope.ownerDocument.activeElement
  if (!focused || event.target !== focused || !scope.contains(focused)) return false
  for (let node: Element | null = focused; node && node !== scope; node = node.parentElement) {
    const layer = layers.get(node as HTMLElement)
    if (!layer || !layer.isCurrent() || !scope.contains(layer.trigger) || !scope.contains(layer.popup)
      || !visible(layer.trigger) || !visible(layer.popup)) continue
    // Composition owns Escape; don't dismiss the popup or let the host leave.
    if (event.isComposing || event.keyCode === 229 || layer.isComposing()) return true
    layers.delete(layer.trigger)
    layers.delete(layer.popup)
    event.preventDefault()
    event.stopPropagation()
    layer.dismiss()
    return true
  }
  return false
}
