import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import { surfaceHeight } from '../../workspace/surfaceGeometry'

export const GLOBAL_LAUNCHER_PANEL_WIDTH = 'calc(100vw / 3)'
export const GLOBAL_LAUNCHER_PANEL_WIDTH_PX = 680
export const STANDALONE_LAUNCHER_WIDTH = 728
export const STANDALONE_LAUNCHER_MIN_HEIGHT = 318
export const STANDALONE_LAUNCHER_MAX_HEIGHT = 640
export const STANDALONE_SURFACE_MAX_WIDTH = 920
export const STANDALONE_SURFACE_MAX_HEIGHT = 640
export const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
export const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
export const GLOBAL_LAUNCHER_SETTINGS_WIDTH = 720
export const GLOBAL_LAUNCHER_SETTINGS_HEIGHT = 560

type LauncherSurfaceShell = PluginUiSurfaceContribution['shell']

export type StandaloneLauncherGeometryInput = {
  panel: HTMLElement
  hostSurfaceTarget: unknown
  launcherSettingsTarget: unknown
  surfaceShell?: LauncherSurfaceShell
  currentWindowWidth?: number
  commandHeight?: number
}

export type StandaloneLauncherGeometry = {
  width: number
  height: number
  minWidth?: number
  minHeight?: number
}

/**
 * Lays the panel out for its window and returns the window size.
 *
 * Content-sized panels (the root list, result frames, command content) keep
 * `data-launcher-fit`: CSS holds them between the window's min and max, so the
 * panel's own height is the window's height. Every other panel fills a fixed
 * window.
 */
export function layoutStandaloneLauncher({
  panel,
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
  currentWindowWidth = window.innerWidth,
  commandHeight,
}: StandaloneLauncherGeometryInput): StandaloneLauncherGeometry {
  if (!hostSurfaceTarget && !launcherSettingsTarget && surfaceShell?.resizable === true) {
    // Shell dimensions describe the plugin panel. Native constraints include
    // the transparent host gutter; the native monitor work area applies the
    // final screen bounds without making these defaults a live viewport cap.
    setPanelLayout(panel, false)
    return {
      width: STANDALONE_LAUNCHER_WIDTH,
      height: surfaceHeight(positiveDimension(surfaceShell.inlineHeight, 480)) + STANDALONE_LAUNCHER_VERTICAL_PADDING,
      minWidth: STANDALONE_LAUNCHER_WIDTH,
      minHeight: STANDALONE_LAUNCHER_MIN_HEIGHT,
    }
  }

  const isSurfaceLike = Boolean((surfaceShell && surfaceShell.mode !== 'command') || launcherSettingsTarget || hostSurfaceTarget)
  const fit = !isSurfaceLike && (!surfaceShell || panel.querySelector('[data-command-content]') !== null)
  const fixedHeight = hostSurfaceTarget
    ? STANDALONE_SURFACE_MAX_HEIGHT
    : surfaceShell ? surfaceHeight(surfaceShell.inlineHeight)
    : GLOBAL_LAUNCHER_SETTINGS_HEIGHT
  // A height the user dragged to wins over both content and declared size.
  const requested = commandHeight ?? (fit ? undefined : fixedHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING)
  setPanelLayout(panel, fit, requested)
  const height = requested ?? clamp(
    Math.ceil(panel.getBoundingClientRect().height + STANDALONE_LAUNCHER_VERTICAL_PADDING),
    STANDALONE_LAUNCHER_MIN_HEIGHT,
    STANDALONE_LAUNCHER_MAX_HEIGHT,
  )
  if (fit) panel.parentElement?.style.setProperty('--launcher-command-height', `${height}px`)

  const desiredPanelWidth = hostSurfaceTarget
    ? STANDALONE_SURFACE_MAX_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
    : surfaceShell
    ? STANDALONE_LAUNCHER_WIDTH
    : launcherSettingsTarget
    ? GLOBAL_LAUNCHER_SETTINGS_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING
    : currentWindowWidth
  const maxWidth = isSurfaceLike ? STANDALONE_SURFACE_MAX_WIDTH + STANDALONE_LAUNCHER_HORIZONTAL_PADDING : currentWindowWidth
  const minWidth = isSurfaceLike ? STANDALONE_LAUNCHER_WIDTH : currentWindowWidth
  const width = clamp(Math.ceil(desiredPanelWidth), minWidth, maxWidth)

  return { width, height }
}

/** A requested window height pins the panel; without one the panel sizes itself. */
function setPanelLayout(panel: HTMLElement, fit: boolean, windowHeight?: number) {
  panel.toggleAttribute('data-launcher-fit', fit)
  if (windowHeight !== undefined) {
    panel.style.height = `${windowHeight - STANDALONE_LAUNCHER_VERTICAL_PADDING}px`
  } else if (panel.style.height.endsWith('px')) {
    // Only drop a height set here; a resizable surface's height is React's.
    panel.style.removeProperty('height')
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function positiveDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}
