import type { PointerEvent } from 'react'
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
}: {
  inset?: number
  onResizeStart: (direction: WindowResizeDirection) => void
}) {
  const beginResize = (event: PointerEvent<HTMLDivElement>, direction: WindowResizeDirection) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onResizeStart(direction)
  }

  return (
    <div className="window-resize-handles" style={{ inset }} aria-hidden="true" data-no-drag>
      {resizeHandles.map(({ direction, edge }) => (
        <div
          key={direction}
          className={`window-resize-handle window-resize-handle--${edge}`}
          data-no-drag
          onPointerDown={(event) => beginResize(event, direction)}
        />
      ))}
    </div>
  )
}
