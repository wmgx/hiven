import type { CSSProperties } from 'react'
import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import {
  GLOBAL_LAUNCHER_PANEL_WIDTH,
  STANDALONE_LAUNCHER_VERTICAL_PADDING,
  STANDALONE_LAUNCHER_WIDTH,
  STANDALONE_SURFACE_MAX_HEIGHT,
} from './GlobalLauncherGeometry'
export {
  GLOBAL_LAUNCHER_PANEL_WIDTH,
  GLOBAL_LAUNCHER_PANEL_WIDTH_PX,
  STANDALONE_LAUNCHER_MAX_HEIGHT,
  STANDALONE_LAUNCHER_MIN_HEIGHT,
  STANDALONE_LAUNCHER_VERTICAL_PADDING,
  STANDALONE_LAUNCHER_WIDTH,
  STANDALONE_SURFACE_MAX_HEIGHT,
  layoutStandaloneLauncher,
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
  const validationBrowser = typeof window !== 'undefined' && (window.__HIVEN_WEB_NATIVE_BRIDGE__ === true || window.__HIVEN_SANDBOX__ === true)
  const panelWidth = `${STANDALONE_LAUNCHER_WIDTH - STANDALONE_LAUNCHER_VERTICAL_PADDING}px`
  // The standalone window is sized to the launcher width, so the panel fills it.
  // In overlay mode the list takes a third of the host window.
  const defaultPanelWidth = validationBrowser
    ? panelWidth
    : standaloneLauncher
    ? 'calc(100vw - 24px)'
    : GLOBAL_LAUNCHER_PANEL_WIDTH
  const fillsWindow = standaloneLauncher && !validationBrowser && !hostSurfaceTarget && !launcherSettingsTarget
    && surfaceShell?.resizable === true
  const isPage = Boolean(hostSurfaceTarget || launcherSettingsTarget || (surfaceShell && surfaceShell.mode !== 'command'))

  return {
    background: 'var(--panel, #ffffff)',
    border: '1px solid var(--border, #ececed)',
    borderRadius: 'var(--radius-lg)',
    '--launcher-panel-width': fillsWindow
      ? 'calc(100vw - 24px)'
      : hostSurfaceTarget || launcherSettingsTarget || surfaceShell
      ? panelWidth
      : defaultPanelWidth,
    width: fillsWindow
      ? 'calc(100vw - 24px)'
      : hostSurfaceTarget || launcherSettingsTarget || surfaceShell
      ? validationBrowser ? panelWidth : `min(${panelWidth}, calc(100vw - 24px))`
      : undefined,
    height: fillsWindow ? 'calc(100vh - 24px)' : undefined,
    maxHeight: fillsWindow
      ? 'calc(100vh - 24px)'
      : isPage
      ? `min(${STANDALONE_SURFACE_MAX_HEIGHT}px, calc(100vh - 24px))`
      : undefined,
    left: '50%',
    top: standaloneLauncher ? 12 : 54,
    transform: 'translateX(-50%)',
  }
}
