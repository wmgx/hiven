import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'

export const GLOBAL_LAUNCHER_PANEL_WIDTH = 'calc(100vw / 3)'
export const GLOBAL_LAUNCHER_PANEL_WIDTH_PX = 680
export const STANDALONE_LAUNCHER_WIDTH = 728
export const STANDALONE_LAUNCHER_MIN_HEIGHT = 318
export const STANDALONE_LAUNCHER_MAX_HEIGHT = 560
export const STANDALONE_SURFACE_MAX_WIDTH = 920
export const STANDALONE_SURFACE_MAX_HEIGHT = 760
export const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
export const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
export const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 300
export const GLOBAL_LAUNCHER_SETTINGS_WIDTH = 720
export const GLOBAL_LAUNCHER_SETTINGS_HEIGHT = 560

type LauncherSurfaceShell = PluginUiSurfaceContribution['shell']

export type StandaloneLauncherGeometryInput = {
  panel: HTMLElement
  hostSurfaceTarget: unknown
  launcherSettingsTarget: unknown
  surfaceShell?: LauncherSurfaceShell
  currentWindowWidth?: number
}

export type StandaloneLauncherGeometry = {
  width: number
  height: number
  bodyMaxHeight?: number
}

export function computeStandaloneLauncherGeometry({
  panel,
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
  currentWindowWidth = window.innerWidth,
}: StandaloneLauncherGeometryInput): StandaloneLauncherGeometry {
  const isSurfaceLike = Boolean(surfaceShell || launcherSettingsTarget || hostSurfaceTarget)
  const measured = measureLauncherPanelParts(panel)

  const height = isSurfaceLike
    ? clamp(
        Math.ceil(
          (hostSurfaceTarget
            ? STANDALONE_SURFACE_MAX_HEIGHT
            : surfaceShell?.defaultHeight
            ?? (launcherSettingsTarget ? GLOBAL_LAUNCHER_SETTINGS_HEIGHT : measured.panelHeight)
          ) + STANDALONE_LAUNCHER_VERTICAL_PADDING,
        ),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        STANDALONE_SURFACE_MAX_HEIGHT,
      )
    : clamp(
        Math.ceil(measured.panelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        STANDALONE_LAUNCHER_MAX_HEIGHT,
      )

  const desiredPanelWidth = hostSurfaceTarget
    ? STANDALONE_SURFACE_MAX_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
    : surfaceShell?.defaultWidth
    ? surfaceShell.defaultWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
    : launcherSettingsTarget
    ? GLOBAL_LAUNCHER_SETTINGS_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
    : currentWindowWidth
  const maxWidth = isSurfaceLike ? STANDALONE_SURFACE_MAX_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING : currentWindowWidth
  const minWidth = isSurfaceLike ? STANDALONE_LAUNCHER_WIDTH : currentWindowWidth
  const width = clamp(Math.ceil(desiredPanelWidth), minWidth, maxWidth)

  return {
    width,
    height,
    bodyMaxHeight: isSurfaceLike ? undefined : measured.bodyMaxHeight,
  }
}

export function measureLauncherPanelParts(panel: HTMLElement) {
  const textResult = panel.querySelector<HTMLElement>('.launcher-result-text-frame')
  const preview = textResult?.querySelector<HTMLElement>('.launcher-preview-well')
  if (textResult && preview) {
    // A text result has several fixed rows, including optional parameters and
    // delivery status. Its constrained panel rect cannot tell us their total.
    const previewStyle = getComputedStyle(preview)
    const previewMargins = cssPixels(previewStyle.marginTop) + cssPixels(previewStyle.marginBottom)
    const chromeHeight = Array.from(textResult.children).reduce((height, child) => {
      if (!(child instanceof HTMLElement) || child === preview) return height
      const style = getComputedStyle(child)
      return height + child.offsetHeight + cssPixels(style.marginTop) + cssPixels(style.marginBottom)
    }, panel.offsetHeight - panel.clientHeight + previewMargins)
    const text = preview.querySelector<HTMLElement>('pre')
    // Measure the text, not the scrollport: a previous longer result may have
    // left an explicit scrollport height that must be allowed to shrink again.
    const contentHeight = (text?.offsetHeight ?? preview.scrollHeight)
      + cssPixels(previewStyle.paddingTop) + cssPixels(previewStyle.paddingBottom)
      + cssPixels(previewStyle.borderTopWidth) + cssPixels(previewStyle.borderBottomWidth)
    const availableHeight = Math.max(0,
      STANDALONE_LAUNCHER_MAX_HEIGHT - STANDALONE_LAUNCHER_VERTICAL_PADDING - chromeHeight,
    )
    const bodyMaxHeight = Math.min(Math.max(112, contentHeight), 320, availableHeight)
    return { panelHeight: chromeHeight + bodyMaxHeight, bodyMaxHeight }
  }

  const header = panel.querySelector<HTMLElement>('.global-launcher-header')
  const body = panel.querySelector<HTMLElement>('.global-launcher-body')
  const footer = panel.querySelector<HTMLElement>('.global-launcher-footer')
  if (!header || !footer || !body) {
    return {
      panelHeight: panel.getBoundingClientRect().height,
      bodyMaxHeight: undefined,
    }
  }

  const maxBodyHeight = Math.max(
    STANDALONE_LAUNCHER_MAX_HEIGHT -
      STANDALONE_LAUNCHER_VERTICAL_PADDING -
      header.offsetHeight -
      footer.offsetHeight,
    STANDALONE_LAUNCHER_LIST_MAX_HEIGHT,
  )
  const bodyMaxHeight = Math.min(body.scrollHeight, maxBodyHeight)

  return {
    panelHeight: header.offsetHeight + bodyMaxHeight + footer.offsetHeight,
    bodyMaxHeight,
  }
}

function cssPixels(value: string): number {
  return Number.parseFloat(value) || 0
}

export function applyStandaloneLauncherGeometry(panel: HTMLElement, geometry: StandaloneLauncherGeometry) {
  if (geometry.bodyMaxHeight != null) {
    panel.style.setProperty('--launcher-body-max-height', `${geometry.bodyMaxHeight}px`)
  } else {
    panel.style.removeProperty('--launcher-body-max-height')
  }
}

export const computeStandaloneLauncherSize = computeStandaloneLauncherGeometry

export function measureStandaloneLauncherPanelHeight(panel: HTMLElement) {
  return measureLauncherPanelParts(panel).panelHeight
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
