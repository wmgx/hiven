/**
 * Public Desktop Target API surface used by the plugin host SDK.
 * Keeps registry + bridge access in host; plugins contribute providers only.
 */

import {
  DESKTOP_BRIDGE_PORT,
  desktopBridgeStatus,
  focusDesktopBridgeTarget,
  invalidateDesktopBridgeListCache,
  listDesktopBridgeEvents,
  listDesktopBridgeHistory,
  listDesktopBridgeTargets,
  openDesktopBridgeUrl,
  setDesktopBridgeSourceConfig,
  type DesktopBridgeEventDto,
  type DesktopBridgeHistoryDto,
  type DesktopBridgeSourceConfig,
  type DesktopBridgeStatus,
  type DesktopBridgeTargetDto,
} from '../desktopControl/bridgeTargets'
import {
  registerDesktopTargetProvider,
  unregisterDesktopTargetProvider,
} from './registry'
import type { DesktopTargetProvider } from './types'

export type { DesktopTargetProvider } from './types'
export type {
  DesktopBridgeEventDto,
  DesktopBridgeHistoryDto,
  DesktopBridgeSourceConfig,
  DesktopBridgeStatus,
  DesktopBridgeTargetDto,
}

export type DesktopTargetsHostApi = {
  registerProvider: (provider: DesktopTargetProvider) => void
  unregisterProvider: (id: string) => void
  bridge: {
    port: number
    status: () => Promise<DesktopBridgeStatus | null>
    listTargets: (sourceId?: string) => Promise<DesktopBridgeTargetDto[]>
    listHistory: (sourceId?: string) => Promise<DesktopBridgeHistoryDto[]>
    listEvents: (sourceId?: string, sinceTs?: number) => Promise<DesktopBridgeEventDto[]>
    focusTarget: (sourceId: string, id: string, windowId?: string | null) => Promise<void>
    openUrl: (sourceId: string, url: string) => Promise<void>
    setSourceConfig: (sourceId: string, config: DesktopBridgeSourceConfig) => Promise<void>
    invalidateCache: () => void
  }
  /**
   * Materialize the first-party Chromium extension package under the user
   * config dir and open it in the system file manager (for "Load unpacked").
   */
  openChromiumExtensionInstallFolder: () => Promise<{ path: string }>
  /** Best-effort open of chrome://extensions (may be blocked; UI still shows steps). */
  openChromiumExtensionsPage: () => Promise<void>
}

export function createDesktopTargetsHostApi(): DesktopTargetsHostApi {
  return {
    registerProvider(provider) {
      registerDesktopTargetProvider(provider)
    },
    unregisterProvider(id) {
      unregisterDesktopTargetProvider(id)
    },
    bridge: {
      port: DESKTOP_BRIDGE_PORT,
      status: () => desktopBridgeStatus(),
      listTargets: (sourceId) => listDesktopBridgeTargets(sourceId),
      listHistory: (sourceId) => listDesktopBridgeHistory(sourceId),
      listEvents: (sourceId, sinceTs) => listDesktopBridgeEvents(sourceId, sinceTs),
      focusTarget: (sourceId, id, windowId) => focusDesktopBridgeTarget(sourceId, id, windowId),
      openUrl: (sourceId, url) => openDesktopBridgeUrl(sourceId, url),
      setSourceConfig: (sourceId, config) => setDesktopBridgeSourceConfig(sourceId, config),
      invalidateCache: () => invalidateDesktopBridgeListCache(),
    },
    async openChromiumExtensionInstallFolder() {
      if (!isTauriRuntime()) {
        throw new Error('Desktop app required')
      }
      const { invoke } = await import('@tauri-apps/api/core')
      const path = await invoke<string>('prepare_chromium_extension_package')
      await invoke('reveal_path_in_file_manager', { path })
      return { path }
    },
    async openChromiumExtensionsPage() {
      if (!isTauriRuntime()) return
      try {
        const { open } = await import('@tauri-apps/plugin-shell')
        // Chrome may ignore chrome: URLs from outside; still best-effort.
        await open('chrome://extensions')
      } catch {
        // ignore — settings UI shows manual steps
      }
    },
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
