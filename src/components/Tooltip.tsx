import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'

const SHOW_DELAY_MS = 150
const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 6

type TooltipPlacement = 'top' | 'bottom'

type TooltipChildProps = {
  ref?: React.Ref<HTMLElement>
  onMouseEnter?: (event: React.MouseEvent) => void
  onMouseLeave?: (event: React.MouseEvent) => void
  onFocus?: (event: React.FocusEvent) => void
  onBlur?: (event: React.FocusEvent) => void
}

/**
 * Lightweight hover/focus tooltip. Clones its single child to attach the
 * trigger events + a measuring ref (no wrapper DOM node, so it never
 * disturbs the child's own layout/flex sizing), then portals a fixed-position
 * bubble to <body> so it always escapes ancestor `overflow` clipping (e.g.
 * scrollable launcher lists).
 */
export function Tooltip({
  label,
  placement = 'top',
  children,
}: {
  label?: string
  placement?: TooltipPlacement
  children: ReactElement<TooltipChildProps>
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const elRef = useRef<HTMLElement | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current != null) {
      clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
  }, [])

  const show = useCallback(() => {
    clearShowTimer()
    showTimerRef.current = setTimeout(() => {
      showTimerRef.current = null
      if (elRef.current) setRect(elRef.current.getBoundingClientRect())
    }, SHOW_DELAY_MS)
  }, [clearShowTimer])

  const hide = useCallback(() => {
    clearShowTimer()
    setRect(null)
  }, [clearShowTimer])

  useEffect(() => clearShowTimer, [clearShowTimer])

  if (!label || !isValidElement(children)) return children ?? null

  const child = children
  const childProps = child.props as TooltipChildProps
  const merged = cloneElement(child, {
    ref: (node: HTMLElement | null) => {
      elRef.current = node
      const childRef = childProps.ref
      if (typeof childRef === 'function') childRef(node)
      else if (childRef && typeof childRef === 'object') (childRef as { current: HTMLElement | null }).current = node
    },
    onMouseEnter: (event: React.MouseEvent) => {
      childProps.onMouseEnter?.(event)
      show()
    },
    onMouseLeave: (event: React.MouseEvent) => {
      childProps.onMouseLeave?.(event)
      hide()
    },
    onFocus: (event: React.FocusEvent) => {
      childProps.onFocus?.(event)
      show()
    },
    onBlur: (event: React.FocusEvent) => {
      childProps.onBlur?.(event)
      hide()
    },
  } as TooltipChildProps)

  return (
    <>
      {merged}
      {rect ? createPortal(<TooltipBubble rect={rect} label={label} placement={placement} />, document.body) : null}
    </>
  )
}

function TooltipBubble({ rect, label, placement }: { rect: DOMRect; label: string; placement: TooltipPlacement }) {
  const fitsAbove = rect.top - TRIGGER_GAP >= VIEWPORT_MARGIN
  const resolvedPlacement: TooltipPlacement = placement === 'top' && !fitsAbove ? 'bottom' : placement
  const top = resolvedPlacement === 'top' ? rect.top - TRIGGER_GAP : rect.bottom + TRIGGER_GAP
  const left = Math.min(
    Math.max(rect.left + rect.width / 2, VIEWPORT_MARGIN),
    window.innerWidth - VIEWPORT_MARGIN,
  )

  return (
    <div
      className="hiven-tooltip"
      role="tooltip"
      style={{
        top,
        left,
        transform: resolvedPlacement === 'top' ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      {label}
    </div>
  )
}
