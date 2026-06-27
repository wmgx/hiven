import type {
  CompositionEventHandler,
  CSSProperties,
  KeyboardEventHandler,
  MouseEventHandler,
  PointerEventHandler,
  ReactNode,
  RefObject,
} from 'react'

export function LauncherShell({
  open,
  overlayClassName,
  panelClassName,
  style,
  panelStyle,
  panelRef,
  children,
  onOverlayClick,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  onPointerDown,
  onContextMenu,
}: {
  open: boolean
  overlayClassName: string
  panelClassName: string
  style?: CSSProperties
  panelStyle?: CSSProperties
  panelRef?: RefObject<HTMLDivElement | null>
  children: ReactNode
  onOverlayClick?: MouseEventHandler<HTMLDivElement>
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
  onCompositionStart?: CompositionEventHandler<HTMLDivElement>
  onCompositionEnd?: CompositionEventHandler<HTMLDivElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onContextMenu?: MouseEventHandler<HTMLDivElement>
}) {
  if (!open) return null

  return (
    <div
      className={overlayClassName}
      style={style}
      onClick={onOverlayClick}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={panelClassName}
        style={panelStyle}
        onKeyDown={onKeyDown}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        onPointerDown={onPointerDown}
        onContextMenu={onContextMenu}
      >
        {children}
      </div>
    </div>
  )
}
