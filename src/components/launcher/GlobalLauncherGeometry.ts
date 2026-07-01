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

export const STANDALONE_QUICK_EDITOR_WIDTH = 720
export const STANDALONE_QUICK_EDITOR_HEIGHT = 480
export const STANDALONE_QUICK_EDITOR_MAX_HEIGHT = 720

type LauncherSurfaceShell = PluginUiSurfaceContribution['shell']

export type StandaloneLauncherGeometryInput = {
  panel: HTMLElement
  hostSurfaceTarget: unknown
  launcherSettingsTarget: unknown
  surfaceShell?: LauncherSurfaceShell
  mode?: string
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
  mode,
  currentWindowWidth = window.innerWidth,
}: StandaloneLauncherGeometryInput): StandaloneLauncherGeometry {
  if (mode === 'quick-editor') {
    return {
      width: STANDALONE_QUICK_EDITOR_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING,
      height: STANDALONE_QUICK_EDITOR_HEIGHT + STANDALONE_LAUNCHER_VERTICAL_PADDING,
    }
  }

  const isSurfaceLike = Boolean(surfaceShell || launcherSettingsTarget || hostSurfaceTarget)
  const measured = measureLauncherPanelParts(panel)

  const height = isSurfaceLike
    ? clamp(
        Math.ceil(
          (hostSurfaceTarget
            ? STANDALONE_SURFACE_MAX_HEIGHT
            : launcherSettingsTarget
            ? GLOBAL_LAUNCHER_SETTINGS_HEIGHT
            : surfaceShell?.defaultHeight ?? measured.panelHeight
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
    : launcherSettingsTarget
    ? GLOBAL_LAUNCHER_SETTINGS_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
    : surfaceShell?.defaultWidth
    ? surfaceShell.defaultWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
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
