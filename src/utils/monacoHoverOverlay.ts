import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import { IHoverService } from 'monaco-editor/esm/vs/platform/hover/browser/hover.js'

const OVERLAY_ID = 'fluxtext-monaco-hover-overlay'
const PATCH_MARKER = Symbol.for('fluxtext.monacoHoverOverlayPatched')

type HoverOptions = {
  container?: HTMLElement
  [key: string]: unknown
}

type HoverServiceWithPatch = {
  [PATCH_MARKER]?: boolean
  showInstantHover: (options: HoverOptions, ...args: unknown[]) => unknown
  showDelayedHover: (options: HoverOptions, ...args: unknown[]) => unknown
}

type ServiceAccessor = {
  get: (serviceId: unknown) => unknown
}

type EditorWithServiceContext = {
  invokeWithinContext?: (callback: (accessor: ServiceAccessor) => unknown) => unknown
}

function getOverlayContainer() {
  let overlay = document.getElementById(OVERLAY_ID)
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    overlay.className = 'monaco-hover-overlay'
    document.body.appendChild(overlay)
  }
  return overlay
}

function getHoverService(editor?: EditorWithServiceContext) {
  const scopedHoverService = editor?.invokeWithinContext?.((accessor) => accessor.get(IHoverService))
  return (scopedHoverService ?? StandaloneServices.get(IHoverService)) as HoverServiceWithPatch
}

export function installMonacoHoverOverlay(editor?: EditorWithServiceContext) {
  if (typeof document === 'undefined') return

  const overlay = getOverlayContainer()
  const hoverService = getHoverService(editor)
  if (hoverService[PATCH_MARKER]) return

  const showInstantHover = hoverService.showInstantHover.bind(hoverService)
  hoverService.showInstantHover = (options, ...args) => (
    showInstantHover({ ...options, container: overlay }, ...args)
  )
  const showDelayedHover = hoverService.showDelayedHover.bind(hoverService)
  hoverService.showDelayedHover = (options, ...args) => (
    showDelayedHover({ ...options, container: overlay }, ...args)
  )
  hoverService[PATCH_MARKER] = true
}
