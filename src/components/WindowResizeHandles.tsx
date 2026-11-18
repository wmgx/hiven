import { useRef, type PointerEvent } from 'react'
import './WindowResizeHandles.css'

export type WindowResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest'
  | 'South' | 'SouthEast' | 'SouthWest' | 'West'

const resizeHandles: ReadonlyArray<{ direction: WindowResizeDirection; edge: string }> = [
  { direction: 'North', edge: 'n' },
  { direction: 'South', edge: 's' },
  { direction: 'West', edge: 'w' },
  { direction: 'East', edge: 'e' },
  { direction: 'NorthWest', edge: 'nw' },
  { direction: 'NorthEast', edge: 'ne' },
  { direction: 'SouthWest', edge: 'sw' },
  { direction: 'SouthEast', edge: 'se' },
]

/** Transparent window-edge hit areas; native resize owns the pointer gesture. */
export function WindowResizeHandles({
  inset = 0,
  onResizeStart,
  onSouthEastResize,
}: {
  inset?: number
  onResizeStart: (direction: WindowResizeDirection) => void
  onSouthEastResize?: (size: { width: number; height: number }) => void
}) {
  const southEastDrag = useRef<{ pointerId: number; x: number; y: number; width: number; height: number } | null>(null)
  const beginResize = (event: PointerEvent<HTMLDivElement>, direction: WindowResizeDirection) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (direction === 'SouthEast' && onSouthEastResize) {
      event.currentTarget.setPointerCapture(event.pointerId)
      southEastDrag.current = {
        pointerId: event.pointerId,
        x: event.screenX,
        y: event.screenY,
        width: window.innerWidth,
        height: window.innerHeight,
      }
      return
    }
    onResizeStart(direction)
  }

  const moveSouthEast = (event: PointerEvent<HTMLDivElement>) => {
    const drag = southEastDrag.current
    if (!drag || drag.pointerId !== event.pointerId) return
    onSouthEastResize?.({
      width: drag.width + event.screenX - drag.x,
      height: drag.height + event.screenY - drag.y,
    })
  }

  const endSouthEast = (event: PointerEvent<HTMLDivElement>) => {
    if (southEastDrag.current?.pointerId === event.pointerId) southEastDrag.current = null
  }

  return (
    <div className="window-resize-handles" style={{ inset }} aria-hidden="true" data-no-drag>
      {resizeHandles.map(({ direction, edge }) => (
        <div
          key={direction}
          className={`window-resize-handle window-resize-handle--${edge}`}
          data-no-drag
          onPointerDown={(event) => beginResize(event, direction)}
          onPointerMove={direction === 'SouthEast' ? moveSouthEast : undefined}
          onPointerUp={direction === 'SouthEast' ? endSouthEast : undefined}
          onPointerCancel={direction === 'SouthEast' ? endSouthEast : undefined}
        />
      ))}
    </div>
  )
}
