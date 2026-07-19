import type { CSSProperties } from 'react'
import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import {
  GLOBAL_LAUNCHER_PANEL_WIDTH,
  GLOBAL_LAUNCHER_SETTINGS_HEIGHT,
  GLOBAL_LAUNCHER_SETTINGS_WIDTH,
  STANDALONE_SURFACE_MAX_HEIGHT,
  STANDALONE_SURFACE_MAX_WIDTH,
} from './GlobalLauncherGeometry'
export {
  GLOBAL_LAUNCHER_PANEL_WIDTH,
  GLOBAL_LAUNCHER_PANEL_WIDTH_PX,
  GLOBAL_LAUNCHER_SETTINGS_HEIGHT,
  GLOBAL_LAUNCHER_SETTINGS_WIDTH,
  STANDALONE_LAUNCHER_HORIZONTAL_PADDING,
  STANDALONE_LAUNCHER_LIST_MAX_HEIGHT,
  STANDALONE_LAUNCHER_MAX_HEIGHT,
  STANDALONE_LAUNCHER_MIN_HEIGHT,
  STANDALONE_LAUNCHER_VERTICAL_PADDING,
  STANDALONE_LAUNCHER_WIDTH,
  STANDALONE_SURFACE_MAX_HEIGHT,
  STANDALONE_SURFACE_MAX_WIDTH,
  applyStandaloneLauncherGeometry,
  computeStandaloneLauncherGeometry,
  computeStandaloneLauncherSize,
  measureLauncherPanelParts,
  measureStandaloneLauncherPanelHeight,
} from './GlobalLauncherGeometry'

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
  // In standalone window mode, the Tauri window is already sized to 1/3 screen
  // width, so the panel fills the window. In overlay mode, use calc(100vw / 3)
  // to occupy 1/3 of the host window.
  const defaultPanelWidth = standaloneLauncher
    ? 'calc(100vw - 24px)'
    : GLOBAL_LAUNCHER_PANEL_WIDTH

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
      : defaultPanelWidth,
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
