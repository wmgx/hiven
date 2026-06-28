import type { CSSProperties } from 'react'
import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'

export const GLOBAL_LAUNCHER_PANEL_WIDTH = 680
export const STANDALONE_LAUNCHER_WIDTH = 728
export const STANDALONE_LAUNCHER_MIN_HEIGHT = 294
export const STANDALONE_LAUNCHER_MAX_HEIGHT = 390
export const STANDALONE_SURFACE_MAX_WIDTH = 920
export const STANDALONE_SURFACE_MAX_HEIGHT = 760
export const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
export const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
export const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 300
export const GLOBAL_LAUNCHER_SETTINGS_WIDTH = 720
export const GLOBAL_LAUNCHER_SETTINGS_HEIGHT = 560

type LauncherSurfaceShell = PluginUiSurfaceContribution['shell']

export type GlobalLauncherPanelStyle = CSSProperties & Record<'--launcher-panel-width', string>

export function buildGlobalLauncherPanelStyle({
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
  standaloneLauncher,
}: {
  hostSurfaceTarget: unknown
  launcherSettingsTarget: unknown
  surfaceShell?: LauncherSurfaceShell
  standaloneLauncher: boolean
}): GlobalLauncherPanelStyle {
  return {
    background: 'var(--panel, #ffffff)',
    border: '1px solid var(--border, #ececed)',
    borderRadius: 'var(--radius, 10px)',
    '--launcher-panel-width': hostSurfaceTarget
      ? `${STANDALONE_SURFACE_MAX_WIDTH}px`
      : launcherSettingsTarget
      ? `${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px`
      : surfaceShell?.defaultWidth
      ? `${surfaceShell.defaultWidth}px`
      : `${GLOBAL_LAUNCHER_PANEL_WIDTH}px`,
    width: hostSurfaceTarget
      ? `min(${STANDALONE_SURFACE_MAX_WIDTH}px, calc(100vw - 24px))`
      : launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px, calc(100vw - 24px))`
      : surfaceShell?.defaultWidth
      ? `min(${surfaceShell.defaultWidth}px, calc(100vw - 24px))`
      : undefined,
    maxHeight: hostSurfaceTarget
      ? `min(${STANDALONE_SURFACE_MAX_HEIGHT}px, calc(100vh - 24px))`
      : launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_HEIGHT}px, calc(100vh - 24px))`
      : surfaceShell?.defaultHeight
      ? `min(${surfaceShell.defaultHeight}px, calc(100vh - 24px))`
      : undefined,
    left: '50%',
    top: standaloneLauncher ? 12 : 54,
    transform: 'translateX(-50%)',
  }
}

export function computeStandaloneLauncherSize({
  panel,
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
}: {
  panel: HTMLElement
  hostSurfaceTarget: unknown
  launcherSettingsTarget: unknown
  surfaceShell?: LauncherSurfaceShell
}) {
  const isSurfaceLike = Boolean(surfaceShell || launcherSettingsTarget || hostSurfaceTarget)
  const desiredPanelHeight = hostSurfaceTarget
    ? STANDALONE_SURFACE_MAX_HEIGHT
    : launcherSettingsTarget
    ? GLOBAL_LAUNCHER_SETTINGS_HEIGHT
    : surfaceShell?.defaultHeight
    ? surfaceShell.defaultHeight
    : measureStandaloneLauncherPanelHeight(panel)
  const height = clamp(
    Math.ceil(desiredPanelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
    STANDALONE_LAUNCHER_MIN_HEIGHT,
    isSurfaceLike ? STANDALONE_SURFACE_MAX_HEIGHT : STANDALONE_LAUNCHER_MAX_HEIGHT,
  )

  const desiredPanelWidth = hostSurfaceTarget
    ? STANDALONE_SURFACE_MAX_WIDTH
    : launcherSettingsTarget
    ? GLOBAL_LAUNCHER_SETTINGS_WIDTH
    : surfaceShell?.defaultWidth ?? GLOBAL_LAUNCHER_PANEL_WIDTH
  const width = clamp(
    Math.ceil(desiredPanelWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING),
    STANDALONE_LAUNCHER_WIDTH,
    isSurfaceLike ? STANDALONE_SURFACE_MAX_WIDTH : STANDALONE_LAUNCHER_WIDTH,
  )

  return { width, height }
}

export function measureStandaloneLauncherPanelHeight(panel: HTMLElement) {
  const header = panel.querySelector<HTMLElement>('.global-launcher-header')
  const body = panel.querySelector<HTMLElement>('.global-launcher-body')
  const footer = panel.querySelector<HTMLElement>('.global-launcher-footer')
  if (!header || !footer) return panel.getBoundingClientRect().height

  if (!body) return panel.getBoundingClientRect().height
  const bodyMaxHeight = readCssPixelValue(getComputedStyle(body).maxHeight, STANDALONE_LAUNCHER_LIST_MAX_HEIGHT)
  return header.offsetHeight + Math.min(body.scrollHeight, bodyMaxHeight) + footer.offsetHeight
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function readCssPixelValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
