import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { localized, useAppStore, type PluginSurfaceOpenTarget } from '../store'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore, type PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { getPluginPermissionSnapshot, missingPluginPermissions, describePluginPermission, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { restartPluginBackground } from '../workspace/pluginBackgroundManager'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createPluginClipboard } from '../workspace/pluginClipboard'
import { createPluginPaste } from '../workspace/pluginPaste'
import { createPluginNetwork } from '../workspace/pluginNetwork'
import { ensurePluginRuntimeReady } from '../workspace/pluginRuntimeBootstrap'
import { PluginSettingsDialog } from './PluginSettingsDialog'
import type { PluginDefinition, PluginPermission, PluginPermissionSnapshot, PluginUiSurfaceContribution } from '../workspace/pluginTypes'
import './PluginSurfaceWindow.css'

type ResolvedSurfaceWindow = {
  definition: PluginDefinition<unknown>
  surface: PluginUiSurfaceContribution<unknown>
  permissions: PluginPermissionSnapshot
  missingPermissions: PluginPermission[]
}

type SurfaceWindowState =
  | { status: 'loading-runtime' }
  | { status: 'surface-not-found'; message: string }
  | ({ status: 'permission-gate' } & ResolvedSurfaceWindow)
  | ({ status: 'before-open' } & ResolvedSurfaceWindow)
  | ({ status: 'ready' } & ResolvedSurfaceWindow)
  | { status: 'error'; title: string; message: string }

export function PluginSurfaceWindow() {
  const locale = useAppStore((s) => s.locale)
  const theme = useAppStore((s) => s.settings.theme)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const permissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const openSettingsDialog = usePluginSettingsStore((s) => s.openSettingsDialog)
  const target = useMemo(() => parseTargetFromUrl(), [])
  const [surfaceState, setSurfaceState] = useState<SurfaceWindowState>(
    target
      ? { status: 'loading-runtime' }
      : { status: 'surface-not-found', message: 'Invalid plugin surface target' },
  )

  useEffect(() => {
    let disposed = false

    async function openSurfaceWindow() {
      if (!target) {
        setSurfaceState({ status: 'surface-not-found', message: 'Invalid plugin surface target' })
        return
      }

      setSurfaceState({ status: 'loading-runtime' })

      try {
        await ensurePluginRuntimeReady()
        if (disposed) return

        const definition = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
        const surface = definition?.ui?.surfaces?.find((item) => item.id === target.surfaceId) as PluginUiSurfaceContribution<unknown> | undefined
        if (!definition || !surface) {
          setSurfaceState({ status: 'surface-not-found', message: `${target.pluginId}:${target.surfaceId}` })
          return
        }

        const requestedPermissions = pluginRegistry.getPluginPermissions(target.pluginId, target.source)
        const permissions = getPluginPermissionSnapshot(target.source, target.pluginId, requestedPermissions)
        const missingPermissions = missingPluginPermissions(permissions, requestedPermissions)
        const resolved: ResolvedSurfaceWindow = {
          definition,
          surface,
          permissions,
          missingPermissions,
        }

        if (missingPermissions.length > 0) {
          setSurfaceState({ status: 'permission-gate', ...resolved })
          return
        }

        setSurfaceState({ status: 'before-open', ...resolved })

        const settingsContribution = definition.settings
        const settings = settingsContribution ? resolvePluginSettings(target.source, target.pluginId, settingsContribution).value : {}
        const storage = createPluginPrivateStorage(target.source, target.pluginId, permissions)
        const pluginT = makePluginT(target.pluginId, locale)

        await surface.beforeOpen?.({
          pluginId: target.pluginId,
          surfaceId: target.surfaceId,
          source: target.source,
          locale,
          t: pluginT,
          settings,
          permissions,
          storage,
          clipboard: createPluginClipboard(target.pluginId, permissions, storage),
          paste: createPluginPaste(permissions, storage),
          network: createPluginNetwork(permissions),
        })

        if (!disposed) {
          setSurfaceState({ status: 'ready', ...resolved })
        }
      } catch (error) {
        if (!disposed) {
          setSurfaceState({
            status: 'error',
            title: 'Plugin surface failed to open',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }

    void openSurfaceWindow()

    return () => { disposed = true }
  }, [target, pluginRegistryVersion, permissionVersion, locale])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      void hideCurrentWindow()
    }
    window.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [])

  if (!target) {
    return <WindowMessage title="Invalid plugin surface target" />
  }
  if (surfaceState.status === 'loading-runtime') {
    return <WindowMessage title="Loading plugin surface…" />
  }
  if (surfaceState.status === 'error') {
    return <WindowMessage title={surfaceState.title} message={surfaceState.message} />
  }
  if (surfaceState.status === 'surface-not-found') {
    return <WindowMessage title="Plugin surface not found" message={surfaceState.message} />
  }
  if (surfaceState.status === 'before-open') {
    return <WindowMessage title="Opening plugin surface…" />
  }

  const settingsContribution = surfaceState.definition.settings
  const settings = settingsContribution ? resolvePluginSettings(target.source, target.pluginId, settingsContribution).value : {}
  const pluginT = makePluginT(target.pluginId, locale)
  const hostStorage = createPluginPrivateStorage(target.source, target.pluginId, surfaceState.permissions)
  const SurfaceComponent = surfaceState.surface.component
  const title = localized(surfaceState.surface.title, surfaceState.surface.titleI18n, locale)
  const usesPluginTitlebar = surfaceState.surface.shell?.rendersTitlebar === true

  return (
    <div className="flux-spatial-shell plugin-surface-window-shell" data-theme={theme}>
      <div className="plugin-surface-window-frame">
        {!usesPluginTitlebar && (
          <div className="plugin-surface-window-titlebar" data-tauri-drag-region>
            <div className="plugin-surface-window-title" data-tauri-drag-region>{title}</div>
            <button className="plugin-surface-window-close" type="button" onClick={() => { void hideCurrentWindow() }}>×</button>
          </div>
        )}
        <PluginSurfaceErrorBoundary pluginId={target.pluginId} onBack={() => { void hideCurrentWindow() }}>
          <div className="plugin-surface-window-body">
            {surfaceState.status === 'permission-gate' ? (
              <PluginSurfacePermissionGate
                permissions={surfaceState.missingPermissions}
                locale={locale}
                onBack={() => { void hideCurrentWindow() }}
                onGrant={() => {
                  grantPluginPermissions(target.source, target.pluginId, surfaceState.missingPermissions)
                  void restartPluginBackground(target.pluginId, target.source)
                }}
              />
            ) : (
              <SurfaceComponent
                pluginId={target.pluginId}
                surfaceId={target.surfaceId}
                locale={locale}
                t={pluginT}
                settings={settings}
                permissions={surfaceState.permissions}
                host={{
                  close: () => { void hideCurrentWindow() },
                  requestBack: () => { void hideCurrentWindow() },
                  openSettings: () => {
                    openSettingsDialog({
                      pluginId: target.pluginId,
                      source: target.source,
                      presentation: 'dialog',
                      context: { surfaceId: 'global-launcher' },
                    })
                  },
                  showMessage: (message, level) => {
                    useAppStore.getState().setLastCommandStatus({
                      title: message,
                      status: level === 'error' ? 'error' : 'success',
                      message,
                      updatedAt: Date.now(),
                    })
                  },
                  storage: hostStorage,
                  clipboard: createPluginClipboard(target.pluginId, surfaceState.permissions, hostStorage),
                  paste: createPluginPaste(surfaceState.permissions, hostStorage),
                  network: createPluginNetwork(surfaceState.permissions),
                }}
              />
            )}
          </div>
        </PluginSurfaceErrorBoundary>
      </div>
      <PluginSettingsDialog />
    </div>
  )
}

function parseTargetFromUrl(): PluginSurfaceOpenTarget | null {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')
  const pluginId = params.get('pluginId')
  const surfaceId = params.get('surfaceId')
  if (!isPluginSettingsSource(source) || !pluginId || !surfaceId) return null
  return { source, pluginId, surfaceId }
}

function isPluginSettingsSource(value: string | null): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function hideCurrentWindow(): Promise<void> {
  if (isTauriRuntime()) {
    await getCurrentWindow().hide().catch(() => undefined)
    return
  }
  window.close()
}

function WindowMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flux-spatial-shell plugin-surface-window-shell">
      <div className="plugin-surface-window-frame">
        <div className="plugin-surface-window-titlebar" data-tauri-drag-region>
          <div className="plugin-surface-window-title" data-tauri-drag-region>{title}</div>
          <button className="plugin-surface-window-close" type="button" onClick={() => { void hideCurrentWindow() }}>×</button>
        </div>
        <div className="plugin-surface-window-message">
          <div>{title}</div>
          {message && <small>{message}</small>}
        </div>
      </div>
    </div>
  )
}

function PluginSurfacePermissionGate({
  permissions,
  locale,
  onBack,
  onGrant,
}: {
  permissions: PluginPermission[]
  locale: Locale
  onBack: () => void
  onGrant: () => void
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: 'var(--color-text-secondary)' }}>
      <div className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t(locale, 'palette.pluginPermissionTitle')}</div>
      <div className="max-w-[420px] text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {t(locale, 'palette.pluginPermissionDescription')}
      </div>
      <div className="max-w-[420px] flex flex-col gap-1 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        {permissions.map((permission) => (
          <div key={permission}>
            {describePluginPermission(permission, locale)}
            <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}> {permission}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button className="text-[12px] px-3 py-1.5 rounded" style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }} onClick={onGrant}>
          {t(locale, 'palette.pluginPermissionAllow')}
        </button>
        <button className="text-[12px] px-3 py-1.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }} onClick={onBack}>
          {t(locale, 'palette.pluginPermissionBack')}
        </button>
      </div>
    </div>
  )
}

type SurfaceErrorBoundaryProps = {
  pluginId: string
  onBack: () => void
  children: ReactNode
}

type SurfaceErrorBoundaryState = {
  hasError: boolean
  error?: string
}

class PluginSurfaceErrorBoundary extends Component<SurfaceErrorBoundaryProps, SurfaceErrorBoundaryState> {
  state: SurfaceErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): SurfaceErrorBoundaryState {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[hiven] Plugin surface "${this.props.pluginId}" crashed:`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="text-[13px]">Plugin surface crashed</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{this.state.error}</span>
          <button className="text-[12px] px-3 py-1.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }} onClick={this.props.onBack}>
            Back
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
