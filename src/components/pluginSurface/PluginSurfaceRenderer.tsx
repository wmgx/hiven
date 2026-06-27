import { Component, useEffect, useMemo, useState, type CSSProperties, type ErrorInfo, type ReactNode } from 'react'
import { useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import { t, type Locale } from '../../i18n'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { resolvePluginSettings } from '../../workspace/pluginSettingsStore'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import { createPluginClipboard } from '../../workspace/pluginClipboard'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { createPluginNetwork } from '../../workspace/pluginNetwork'
import { restartPluginBackground } from '../../workspace/pluginBackgroundManager'
import {
  describePluginPermission,
  getPluginPermissionSnapshot,
  missingPluginPermissions,
  usePluginPermissionStore,
} from '../../workspace/pluginPermissions'
import type { PluginPermission, PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import { resolvePluginSurface } from './pluginSurfaceResolver'

type PluginSurfaceRendererProps = {
  target: PluginSurfaceOpenTarget
  locale: Locale
  className?: string
  style?: CSSProperties
  bodyClassName?: string
  bodyStyle?: CSSProperties
  notFoundFallback?: ReactNode
  loadingFallback?: ReactNode
  showPermissionBack?: boolean
  onBack: () => void
  onClose: () => void
  onOpenSettings: () => void
}

export function PluginSurfaceRenderer({
  target,
  locale,
  className,
  style,
  bodyClassName,
  bodyStyle,
  notFoundFallback,
  loadingFallback,
  showPermissionBack = true,
  onBack,
  onClose,
  onOpenSettings,
}: PluginSurfaceRendererProps) {
  const registryVersion = usePluginRegistryVersion()
  const permissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPermissions = usePluginPermissionStore((s) => s.grantPermissions)

  const resolved = useMemo(() => {
    void registryVersion
    return resolvePluginSurface(target)
  }, [target, registryVersion])

  const requestedPermissions = useMemo(() => {
    void registryVersion
    return pluginRegistry.getPluginPermissions(target.pluginId, target.source)
  }, [target, registryVersion])

  const permissions = useMemo(() => {
    void permissionVersion
    return getPluginPermissionSnapshot(target.source, target.pluginId, requestedPermissions)
  }, [target, requestedPermissions, permissionVersion])

  const missingPermissions = useMemo(() => {
    return missingPluginPermissions(permissions, requestedPermissions)
  }, [permissions, requestedPermissions])

  const settings = useMemo(() => {
    const settingsContribution = resolved?.definition.settings
    return settingsContribution
      ? resolvePluginSettings(target.source, target.pluginId, settingsContribution).value
      : {}
  }, [target, resolved])

  const storage = useMemo(() => {
    return createPluginPrivateStorage(target.source, target.pluginId, permissions)
  }, [target, permissions])

  const clipboard = useMemo(() => {
    return createPluginClipboard(target.pluginId, permissions, storage)
  }, [target.pluginId, permissions, storage])

  const paste = useMemo(() => {
    return createPluginPaste(permissions, storage)
  }, [permissions, storage])

  const network = useMemo(() => {
    return createPluginNetwork(permissions)
  }, [permissions])

  const pluginT = useMemo(() => {
    return makePluginT(target.pluginId, locale)
  }, [target.pluginId, locale])

  const missingPermissionsKey = missingPermissions.join('|')

  if (!resolved) {
    return notFoundFallback ?? <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>Surface not found</div>
  }

  const beforeOpenKey = [
    target.source,
    target.pluginId,
    target.surfaceId,
    locale,
    registryVersion,
    permissionVersion,
    missingPermissionsKey,
  ].join(':')

  return (
    <PluginSurfaceErrorBoundary pluginId={target.pluginId} onBack={onBack}>
      <div className={className} style={style} tabIndex={-1}>
        <div className={bodyClassName} style={bodyStyle}>
          {missingPermissions.length > 0 ? (
            <PluginSurfacePermissionGate
              permissions={missingPermissions}
              locale={locale}
              onBack={onBack}
              onGrant={() => {
                grantPermissions(target.source, target.pluginId, missingPermissions)
                void restartPluginBackground(target.pluginId, target.source)
              }}
              showBack={showPermissionBack}
            />
          ) : (
            <PluginSurfaceReadyContent
              key={beforeOpenKey}
              target={target}
              locale={locale}
              pluginT={pluginT}
              settings={settings}
              permissions={permissions}
              storage={storage}
              clipboard={clipboard}
              paste={paste}
              network={network}
              surface={resolved.surface}
              loadingFallback={loadingFallback}
              onBack={onBack}
              onClose={onClose}
              onOpenSettings={onOpenSettings}
            />
          )}
        </div>
      </div>
    </PluginSurfaceErrorBoundary>
  )
}

function PluginSurfaceReadyContent({
  target,
  locale,
  pluginT,
  settings,
  permissions,
  storage,
  clipboard,
  paste,
  network,
  surface,
  loadingFallback,
  onBack,
  onClose,
  onOpenSettings,
}: {
  target: PluginSurfaceOpenTarget
  locale: Locale
  pluginT: ReturnType<typeof makePluginT>
  settings: Record<string, unknown>
  permissions: ReturnType<typeof getPluginPermissionSnapshot>
  storage: ReturnType<typeof createPluginPrivateStorage>
  clipboard: ReturnType<typeof createPluginClipboard>
  paste: ReturnType<typeof createPluginPaste>
  network: ReturnType<typeof createPluginNetwork>
  surface: PluginUiSurfaceContribution<unknown>
  loadingFallback?: ReactNode
  onBack: () => void
  onClose: () => void
  onOpenSettings: () => void
}) {
  const [ready, setReady] = useState(() => !surface.beforeOpen)
  const SurfaceComponent = surface.component

  useEffect(() => {
    if (!surface.beforeOpen) return

    let cancelled = false
    Promise.resolve(surface.beforeOpen({
      pluginId: target.pluginId,
      surfaceId: target.surfaceId,
      source: target.source,
      locale,
      t: pluginT,
      settings,
      permissions,
      storage,
      clipboard,
      paste,
      network,
    }))
      .catch((error) => {
        console.warn(`[hiven] Plugin surface beforeOpen failed for "${target.pluginId}:${target.surfaceId}":`, error)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })

    return () => { cancelled = true }
  }, [
    target,
    surface,
    locale,
    pluginT,
    settings,
    permissions,
    storage,
    clipboard,
    paste,
    network,
  ])

  if (!ready) return loadingFallback ?? <div className="view-loading" />

  return (
    <SurfaceComponent
      pluginId={target.pluginId}
      surfaceId={target.surfaceId}
      locale={locale}
      t={pluginT}
      settings={settings}
      permissions={permissions}
      host={{
        close: onClose,
        requestBack: onBack,
        openSettings: onOpenSettings,
        showMessage: (message, level) => {
          useAppStore.getState().setLastCommandStatus({
            title: message,
            status: level === 'error' ? 'error' : 'success',
            message,
            updatedAt: Date.now(),
          })
        },
        storage,
        clipboard,
        paste,
        network,
      }}
    />
  )
}

export function PluginSurfacePermissionGate({
  permissions,
  locale,
  onBack,
  onGrant,
  showBack = true,
}: {
  permissions: PluginPermission[]
  locale: Locale
  onBack: () => void
  onGrant: () => void
  showBack?: boolean
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
        <button
          className="text-[12px] px-3 py-1.5 rounded"
          style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          onClick={onGrant}
        >
          {t(locale, 'palette.pluginPermissionAllow')}
        </button>
        {showBack && (
          <button
            className="text-[12px] px-3 py-1.5 rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }}
            onClick={onBack}
          >
            {t(locale, 'palette.pluginPermissionBack')}
          </button>
        )}
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
          <button
            className="text-[12px] px-3 py-1.5 rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }}
            onClick={this.props.onBack}
          >
            Back
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
