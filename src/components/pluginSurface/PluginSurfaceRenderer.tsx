import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { localized, useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import { t, type Locale } from '../../i18n'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { getPluginPermissionSnapshot, missingPluginPermissions, describePluginPermission, usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { restartPluginBackground } from '../../workspace/pluginBackgroundManager'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import { createPluginClipboard } from '../../workspace/pluginClipboard'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { createPluginNetwork } from '../../workspace/pluginNetwork'
import { ensurePluginRuntimeReady } from '../../workspace/pluginRuntimeBootstrap'
import type { PluginDefinition, PluginPermission, PluginPermissionSnapshot, PluginUiSurfaceContribution } from '../../workspace/pluginTypes'

type ResolvedPluginSurface = {
  definition: PluginDefinition<unknown>
  surface: PluginUiSurfaceContribution<unknown>
  permissions: PluginPermissionSnapshot
  missingPermissions: PluginPermission[]
}

type PluginSurfaceRendererState =
  | { status: 'loading-runtime' }
  | { status: 'surface-not-found'; message: string }
  | ({ status: 'permission-gate' } & ResolvedPluginSurface)
  | ({ status: 'before-open' } & ResolvedPluginSurface)
  | ({ status: 'ready' } & ResolvedPluginSurface)
  | { status: 'error'; title: string; message: string }

export type PluginSurfaceRendererProps = {
  target: PluginSurfaceOpenTarget
  locale: Locale
  presentation: 'global-launcher' | 'plugin-surface-window' | 'editor-panel'
  contextSurfaceId: string
  onBack: () => void
  onClose: () => void
}

export function PluginSurfaceRenderer({
  target,
  locale,
  presentation,
  contextSurfaceId,
  onBack,
  onClose,
}: PluginSurfaceRendererProps) {
  const pluginRegistryVersion = usePluginRegistryVersion()
  const permissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const openSettingsDialog = usePluginSettingsStore((s) => s.openSettingsDialog)
  const [surfaceState, setSurfaceState] = useState<PluginSurfaceRendererState>({ status: 'loading-runtime' })

  useEffect(() => {
    let disposed = false

    async function openSurface() {
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
        const resolved: ResolvedPluginSurface = {
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

    void openSurface()

    return () => { disposed = true }
  }, [target, pluginRegistryVersion, permissionVersion, locale])

  if (surfaceState.status === 'loading-runtime') {
    return <PluginSurfaceMessage title="Loading plugin surface..." />
  }
  if (surfaceState.status === 'error') {
    return <PluginSurfaceMessage title={surfaceState.title} message={surfaceState.message} />
  }
  if (surfaceState.status === 'surface-not-found') {
    return <PluginSurfaceMessage title="Plugin surface not found" message={surfaceState.message} />
  }
  if (surfaceState.status === 'before-open') {
    return <PluginSurfaceMessage title="Opening plugin surface..." />
  }

  const settingsContribution = surfaceState.definition.settings
  const settings = settingsContribution ? resolvePluginSettings(target.source, target.pluginId, settingsContribution).value : {}
  const pluginT = makePluginT(target.pluginId, locale)
  const hostStorage = createPluginPrivateStorage(target.source, target.pluginId, surfaceState.permissions)
  const SurfaceComponent = surfaceState.surface.component

  return (
    <PluginSurfaceErrorBoundary pluginId={target.pluginId} onBack={onBack}>
      {surfaceState.status === 'permission-gate' ? (
        <PluginSurfacePermissionGate
          permissions={surfaceState.missingPermissions}
          locale={locale}
          onBack={onBack}
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
            close: onClose,
            requestBack: onBack,
            openSettings: () => {
              openSettingsDialog({
                pluginId: target.pluginId,
                source: target.source,
                presentation,
                context: { surfaceId: contextSurfaceId },
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
    </PluginSurfaceErrorBoundary>
  )
}

export function PluginSurfacePermissionGate({
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

function PluginSurfaceMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="plugin-surface-window-message">
      <div>{title}</div>
      {message && <small>{message}</small>}
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
    console.error(`[hiven] Plugin surface crashed (${this.props.pluginId}):`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="plugin-surface-window-message">
          <div>Plugin surface crashed</div>
          {this.state.error && <small>{this.state.error}</small>}
          <button type="button" onClick={this.props.onBack}>Back</button>
        </div>
      )
    }
    return this.props.children
  }
}

export function usePluginSurfaceTitle(target: PluginSurfaceOpenTarget | null, locale: Locale): string {
  const pluginRegistryVersion = usePluginRegistryVersion()
  return useMemo(() => {
    void pluginRegistryVersion
    if (!target) return ''
    const definition = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
    const surface = definition?.ui?.surfaces?.find((item) => item.id === target.surfaceId)
    return surface ? localized(surface.title, surface.titleI18n, locale) : ''
  }, [locale, pluginRegistryVersion, target])
}

export function usePluginSurfaceRendersTitlebar(target: PluginSurfaceOpenTarget | null): boolean {
  const pluginRegistryVersion = usePluginRegistryVersion()
  return useMemo(() => {
    void pluginRegistryVersion
    if (!target) return false
    const definition = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
    const surface = definition?.ui?.surfaces?.find((item) => item.id === target.surfaceId)
    return surface?.shell?.rendersTitlebar === true
  }, [pluginRegistryVersion, target])
}
