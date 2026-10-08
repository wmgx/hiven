import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { localized, useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import { t, pickLocale, type Locale } from '../../i18n'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { getPluginPermissionSnapshot, missingPluginPermissions, describePluginPermission, usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { restartPluginBackground } from '../../workspace/pluginBackgroundManager'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import { createPluginClipboard } from '../../workspace/pluginClipboard'
import { showToast, dismissToast } from '../../workspace/toast'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { createPluginNetwork } from '../../workspace/pluginNetwork'
import { createPluginAi } from '../../workspace/ai/runtime'
import { createPluginShell } from '../../workspace/pluginShell'
import { ensurePluginRuntimeReady } from '../../workspace/pluginRuntimeBootstrap'
import type {
  PluginDefinition,
  PluginObjectBlockInput,
  PluginPermission,
  PluginPermissionSnapshot,
  PluginUiSurfaceContribution,
} from '../../workspace/pluginTypes'
import { createPluginSurfaceObjectBlock } from './pluginSurfaceObjectBlock'
import { setPendingObjectBlock } from '../../launcher/clipboard/pendingObjectBlock'
import { showLauncherWindow } from '../../workspace/windowManager/launcherWindow'
import { pluginSurfaceInstanceId } from '../../workspace/pluginSurfaceWindows'
import { PluginAppSettingsDialog } from './PluginAppSettingsDialog'

type ResolvedPluginSurface = {
  target: PluginSurfaceOpenTarget
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

type AppSettingsSession = {
  target: PluginSurfaceOpenTarget
  owner: PluginSurfaceRendererState
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

function settingsInterrupted(): Error {
  return Object.assign(new Error('App settings surface interrupted'), { name: 'AbortError' })
}

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
  const appearance = useAppStore((s) => s.settings)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const openSettingsDialog = usePluginSettingsStore((s) => s.openSettingsDialog)
  const [surfaceState, setSurfaceState] = useState<PluginSurfaceRendererState>({ status: 'loading-runtime' })
  const activeTargetRef = useRef(target)
  activeTargetRef.current = target
  const activeStateRef = useRef(surfaceState)
  activeStateRef.current = surfaceState
  const mountedRef = useRef(false)
  const hiddenRef = useRef(false)
  const sessionRef = useRef<AppSettingsSession | null>(null)
  const [appSettingsSession, setAppSettingsSession] = useState<AppSettingsSession | null>(null)
  const finishAppSettings = useCallback((session: AppSettingsSession | null, completed = false) => {
    if (!session || sessionRef.current !== session) return
    sessionRef.current = null
    if (mountedRef.current) setAppSettingsSession(null)
    if (completed) session.resolve()
    else session.reject(settingsInterrupted())
  }, [])

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      finishAppSettings(sessionRef.current)
    }
  }, [finishAppSettings])

  useLayoutEffect(() => () => finishAppSettings(sessionRef.current), [target, surfaceState, finishAppSettings])

  useEffect(() => {
    hiddenRef.current = false
    const interrupt = () => finishAppSettings(sessionRef.current)
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') interrupt() }
    window.addEventListener('pagehide', interrupt)
    document.addEventListener('visibilitychange', onVisibilityChange)
    let disposed = false
    let unlisten: (() => void) | undefined
    // Native independent windows can hide without unmounting or a DOM visibility event.
    // Only their existing registry lifecycle is observed; blur during OAuth is not hide.
    if (presentation === 'plugin-surface-window' && '__TAURI_INTERNALS__' in window) {
      const id = pluginSurfaceInstanceId(target)
      type Mutation = { type?: string; id?: string; state?: string; surface?: { id?: string; state?: string } }
      void import('@tauri-apps/api/event').then(({ listen }) => listen<Mutation>('hiven://surface-registry-sync', ({ payload }) => {
        if (disposed || activeTargetRef.current !== target || !payload) return
        const matches = payload.type === 'upsert' ? payload.surface?.id === id : payload.id === id
        if (!matches) return
        const state = payload.type === 'upsert' ? payload.surface?.state : payload.state
        if (state === 'visible') hiddenRef.current = false
        if (state === 'hidden' || state === 'destroyed' || payload.type === 'remove') {
          hiddenRef.current = true
          interrupt()
        }
      })).then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      }).catch((error) => console.warn('[hiven] Could not observe plugin settings window lifecycle:', error))
    }
    return () => {
      disposed = true
      unlisten?.()
      window.removeEventListener('pagehide', interrupt)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [target, presentation, finishAppSettings])

  useEffect(() => {
    let disposed = false

    async function openSurface() {
      setSurfaceState({ status: 'loading-runtime' })

      try {
        await ensurePluginRuntimeReady(target.source)
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
          target,
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
          initialText: target.initialText,
          storage,
          clipboard: createPluginClipboard(target.pluginId, permissions, storage),
          paste: createPluginPaste(permissions, storage),
          network: createPluginNetwork(permissions),
          shell: createPluginShell(permissions),
          ai: createPluginAi(target.pluginId, target.source, permissions),
        })

        if (!disposed) {
          setSurfaceState({ status: 'ready', ...resolved })
        }
      } catch (error) {
        console.error(`[hiven] Plugin surface failed to open (${target.pluginId}):`, error)
        if (!disposed) {
          setSurfaceState({
            status: 'error',
            title: t(locale, 'palette.surfaceOpenFailed'),
            message: '',
          })
        }
      }
    }

    void openSurface()

    return () => { disposed = true }
  }, [target, pluginRegistryVersion, permissionVersion, locale])

  if (surfaceState.status === 'loading-runtime' || ('target' in surfaceState && surfaceState.target !== target)) {
    return <PluginSurfaceMessage title={t(locale, 'palette.surfaceLoading')} />
  }
  if (surfaceState.status === 'error') {
    return <PluginSurfaceMessage title={surfaceState.title} message={surfaceState.message} variant="error" onBack={onBack} backLabel={t(locale, 'palette.back')} />
  }
  if (surfaceState.status === 'surface-not-found') {
    return <PluginSurfaceMessage title={t(locale, 'palette.surfaceNotFound')} message={surfaceState.message} variant="error" onBack={onBack} backLabel={t(locale, 'palette.back')} />
  }
  if (surfaceState.status === 'before-open') {
    return <PluginSurfaceMessage title={t(locale, 'palette.surfaceOpening')} />
  }

  const settingsContribution = surfaceState.definition.settings
  const settings = settingsContribution ? resolvePluginSettings(target.source, target.pluginId, settingsContribution).value : {}
  const pluginT = makePluginT(target.pluginId, locale)
  const hostStorage = createPluginPrivateStorage(target.source, target.pluginId, surfaceState.permissions)
  const SurfaceComponent = surfaceState.surface.component
  const isCurrentSurface = () => mountedRef.current && activeTargetRef.current === target && activeStateRef.current === surfaceState && !hiddenRef.current
  const leaveSurface = (action: () => void) => {
    if (!isCurrentSurface()) return
    finishAppSettings(sessionRef.current)
    action()
  }

  return (
    <PluginSurfaceErrorBoundary
      pluginId={target.pluginId}
      locale={locale}
      onBack={onBack}
      onError={() => {
        finishAppSettings(sessionRef.current)
        setSurfaceState({ status: 'error', title: t(locale, 'palette.surfaceCrashed'), message: '' })
      }}
    >
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
          appearance={appearance}
          permissions={surfaceState.permissions}
          initialText={target.initialText}
          host={{
            close: () => leaveSurface(onClose),
            complete: () => {
              if (presentation === 'global-launcher') leaveSurface(onClose)
            },
            requestBack: () => leaveSurface(onBack),
            openSettings: () => {
              if (!isCurrentSurface()) return
              finishAppSettings(sessionRef.current)
              openSettingsDialog({
                pluginId: target.pluginId,
                source: target.source,
                presentation: presentation === 'editor-panel' ? 'dialog' : presentation,
                context: { surfaceId: contextSurfaceId as never },
              })
            },
            openAppSettings: ({ section }) => {
              if (section !== 'ai' || !isCurrentSurface() || document.visibilityState === 'hidden') return Promise.reject(settingsInterrupted())
              if (sessionRef.current) return sessionRef.current.promise
              let resolve!: () => void
              let reject!: (error: Error) => void
              const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
              const session: AppSettingsSession = { target, owner: surfaceState, promise, resolve, reject }
              sessionRef.current = session
              setAppSettingsSession(session)
              return promise
            },
            detachToWindow: (initialText?: string) => {
              if (!isCurrentSurface()) return
              finishAppSettings(sessionRef.current)
              const windowTarget = { ...target, initialText: initialText ?? target.initialText }
              import('../../workspace/windowManager/pluginSurfaceWindows').then(({ showPluginSurfaceWindow }) => {
                void showPluginSurfaceWindow(windowTarget)
              })
              onClose()
            },
            showMessage: (message, level) => {
              showToast(message, level ?? 'info')
            },
            showToast: (message, level, options) => showToast(message, level, options),
            dismissToast,
            returnToLauncherWithObject: (input: PluginObjectBlockInput) => {
              if (!isCurrentSurface()) return
              finishAppSettings(sessionRef.current)
              const block = createPluginSurfaceObjectBlock(input)

              // Always persist: history is often a separate webview; hide/show races
              // used to drop in-memory-only pending before Global Launcher reopened.
              setPendingObjectBlock(block, { persist: true })

              // Leave tool surface / clear host target but keep launcher session when possible
              useAppStore.getState().clearPluginSurfaceTool()
              onBack()

              useAppStore.getState().openGlobalLauncherOverlay()
              void showLauncherWindow().catch((error) => {
                console.warn('[hiven] Failed to show launcher after returnToLauncherWithObject:', error)
                showToast(
                  pickLocale(locale, '无法带回 Launcher', 'Could not return to Launcher'),
                  'error',
                )
              })
            },
            storage: hostStorage,
            clipboard: createPluginClipboard(target.pluginId, surfaceState.permissions, hostStorage),
            paste: createPluginPaste(surfaceState.permissions, hostStorage, {
              keepOpen: presentation !== 'global-launcher' && target.pluginId !== 'clipboard-history',
            }),
            network: createPluginNetwork(surfaceState.permissions),
            shell: createPluginShell(surfaceState.permissions),
            ai: createPluginAi(target.pluginId, target.source, surfaceState.permissions),
          }}
        />
      )}
      {appSettingsSession && appSettingsSession.target === target && appSettingsSession.owner === surfaceState && (
        <PluginAppSettingsDialog locale={locale} onClose={() => finishAppSettings(appSettingsSession, isCurrentSurface() && document.visibilityState !== 'hidden')} />
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
    <div className="min-h-full flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: 'var(--color-text-secondary)' }}>
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

function PluginSurfaceMessage({ title, message, variant, onBack, backLabel }: { title: string; message?: string; variant?: 'loading' | 'error'; onBack?: () => void; backLabel?: string }) {
  return (
    <div className="plugin-surface-window-message">
      {variant === 'error' ? (
        <AlertTriangle size={18} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
      ) : (
        <div className="plugin-surface-window-message__indicator" />
      )}
      <div>{title}</div>
      {message && <small>{message}</small>}
      {onBack && <button type="button" onClick={onBack}>{backLabel}</button>}
    </div>
  )
}

type SurfaceErrorBoundaryProps = {
  pluginId: string
  locale: Locale
  onBack: () => void
  onError: () => void
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
    this.props.onError()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="plugin-surface-window-message">
          <div>{t(this.props.locale, 'palette.surfaceCrashed')}</div>
          <button type="button" onClick={this.props.onBack}>{t(this.props.locale, 'palette.back')}</button>
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
