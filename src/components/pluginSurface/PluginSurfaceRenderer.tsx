import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { localized, useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import { t, pickLocale, type Locale } from '../../i18n'
import { makePluginT } from '../../i18n/pluginI18nRegistry'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore, type PluginSettingsDialogTarget } from '../../workspace/pluginSettingsStore'
import { getPluginPermissionSnapshot, missingPluginPermissions, describePluginPermission, usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { restartPluginBackground } from '../../workspace/pluginBackgroundManager'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import { createPluginClipboard } from '../../workspace/pluginClipboard'
import { showToast, dismissToast } from '../../workspace/toast'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { captureLauncherPasteOwner, combinePasteRecoveryOwners, createPasteRecoveryScope, isPasteRecoveryTemporaryHidden, observePasteRecoveryFocus } from '../../workspace/pasteRecovery'
import { createPluginNetwork } from '../../workspace/pluginNetwork'
import { createPluginAi } from '../../workspace/ai/runtime'
import { createPluginShell } from '../../workspace/pluginShell'
import { isCurrentBundledDefinition } from '../../workspace/bundledPluginIdentity'
import { createHistoryPasteQueueBridge } from '../../historyPasteQueueHandoff'
import { createHistoryDiffReturnReceipt, prepareHistoryDiffTarget } from '../../historyDiffHandoff'
import { createPluginSurfaceTextSaver } from '../../workspace/pluginSurfaceTextSave'
import { acquireLauncherNativeDialogFocus } from '../../workspace/launcherBlurGuard'
import { ensurePluginRuntimeReady } from '../../workspace/pluginRuntimeBootstrap'
import type {
  PluginDefinition,
  PluginObjectBlockInput,
  PluginPermission,
  PluginPermissionSnapshot,
  PluginSurfaceHostApi,
  PluginUiSurfaceContribution,
} from '../../workspace/pluginTypes'
import { createPluginSurfaceObjectBlock } from './pluginSurfaceObjectBlock'
import { clearPendingObjectBlock, setPendingObjectBlock } from '../../launcher/clipboard/pendingObjectBlock'
import { requestLauncherObjectHandoff, showLauncherAfterObjectHandoff } from '../../launcher/clipboard/launcherObjectHandoff'
import { isNativeDesktopRuntime } from '../../workspace/webNativeBridge'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LAUNCHER_WINDOW_LABEL } from '../../workspace/windowManager/windowLabels'
import { pluginSurfaceInstanceId } from '../../workspace/pluginSurfaceWindows'
import { PluginAppSettingsDialog } from './PluginAppSettingsDialog'

type ResolvedPluginSurface = {
  target: PluginSurfaceOpenTarget
  definition: PluginDefinition<unknown>
  surface: PluginUiSurfaceContribution<unknown>
  permissions: PluginPermissionSnapshot
  // One handle per resolved definition/permission lifetime, not per host render.
  ai: PluginSurfaceHostApi['ai']
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

/** Internal renderer identity, revoked on replacement, unload, or lifetime expiry. */
export type PluginSurfaceLeaveOwner = { isCurrent: () => boolean; interruptPending?: () => void }

export type PluginSurfaceRendererProps = {
  target: PluginSurfaceOpenTarget
  locale: Locale
  presentation: 'global-launcher' | 'plugin-surface-window' | 'editor-panel'
  contextSurfaceId: string
  onBack: () => void
  onClose: () => void
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean, owner: PluginSurfaceLeaveOwner) => void
  onRequestLeave?: (action: 'back' | 'close') => void
  suspended?: boolean
  onHandoffReady?: (ready: boolean) => void
}

export function PluginSurfaceRenderer({
  target,
  locale,
  presentation,
  contextSurfaceId,
  onBack,
  onClose,
  onUnsavedChangesChange,
  onRequestLeave,
  suspended = false,
  onHandoffReady,
}: PluginSurfaceRendererProps) {
  const suspensionOwner = useMemo(() => ({}), [suspended])
  const suspensionOwnerRef = useRef(suspensionOwner)
  suspensionOwnerRef.current = suspensionOwner
  const suspendedRef = useRef(suspended)
  suspendedRef.current = suspended
  const [detaching, setDetaching] = useState(false)
  const detachRef = useRef<AbortController | null>(null)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const permissionVersion = usePluginPermissionStore((s) => s.version)
  const appearance = useAppStore((s) => s.settings)
  const launcherSessionId = useAppStore((s) => presentation === 'global-launcher' ? s.globalLauncherSessionId : undefined)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const openSettingsDialog = usePluginSettingsStore((s) => s.openSettingsDialog)
  const launcherSettingsTarget = usePluginSettingsStore((s) => presentation === 'global-launcher' ? s.settingsDialogTarget : null)
  // Settings dialogs can overlay a mounted surface. Observe just its record so
  // saving applies immediately without remounting or discarding its local input.
  usePluginSettingsStore((s) => s.pluginSettings[target.source][target.pluginId])
  const crashedRef = useRef(false)
  const [surfaceState, setSurfaceState] = useState<PluginSurfaceRendererState>({ status: 'loading-runtime' })
  const activeTargetRef = useRef(target)
  activeTargetRef.current = target
  const activeStateRef = useRef(surfaceState)
  activeStateRef.current = surfaceState
  const mountedRef = useRef(false)
  const hiddenRef = useRef(false)
  const leaveIntentListeners = useMemo(() => new Set<() => void>(), [target, surfaceState, suspensionOwner])
  const leaveOwner = useMemo<PluginSurfaceLeaveOwner>(() => {
    const lifetime = pluginRegistry.getPluginLifetime(target.pluginId, target.source)
    const owner: PluginSurfaceLeaveOwner = {
      isCurrent: () => mountedRef.current && activeTargetRef.current === target
        && activeStateRef.current === surfaceState && surfaceState.status === 'ready'
        && surfaceState.target === target && !hiddenRef.current && !suspendedRef.current && suspensionOwnerRef.current === suspensionOwner && lifetime.active,
      interruptPending: () => {
        if (!owner.isCurrent()) return
        for (const listener of leaveIntentListeners) {
          // A plugin may revoke its work, but cannot veto the host's navigation.
          try { listener() } catch { /* Continue notifying and honour the user's exit. */ }
        }
        interruptSettingsRef.current()
        refreshPasteOwner((version) => version + 1)
      },
    }
    return owner
  }, [target, surfaceState, suspensionOwner, leaveIntentListeners])
  const subscribeLeaveIntent = useCallback((listener: () => void) => {
    if (!leaveOwner.isCurrent()) return () => {}
    leaveIntentListeners.add(listener)
    return () => { leaveIntentListeners.delete(listener) }
  }, [leaveOwner, leaveIntentListeners])
  useLayoutEffect(() => () => leaveIntentListeners.clear(), [leaveIntentListeners])
  const setUnsavedChanges = useCallback((hasUnsavedChanges: boolean) => {
    if (leaveOwner.isCurrent()) onUnsavedChangesChange?.(hasUnsavedChanges, leaveOwner)
  }, [leaveOwner, onUnsavedChangesChange])
  const pasteScope = useMemo(() => createPasteRecoveryScope(), [target, surfaceState, suspended])
  const preparationScopeRef = useRef<ReturnType<typeof createPasteRecoveryScope> | null>(null)
  const [pasteOwnerVersion, refreshPasteOwner] = useState(0)
  const exportSessionRef = useRef(0)
  const textSaverRef = useRef(createPluginSurfaceTextSaver())
  const localeRef = useRef(locale)
  localeRef.current = locale
  const ownedSettingsTargetRef = useRef<PluginSettingsDialogTarget>(null)
  const sessionRef = useRef<AppSettingsSession | null>(null)
  const handoffRef = useRef<{ controller: AbortController; promise: Promise<boolean> } | null>(null)
  const deliveredHandoffRef = useRef<{ owner: PluginSurfaceRendererState; input: string; block: ReturnType<typeof createPluginSurfaceObjectBlock> } | null>(null)
  type HistoryDiffSession = { target: PluginSurfaceOpenTarget; owner: PluginSurfaceRendererState; finish: (accepted: boolean) => void }
  const [historyDiff, setHistoryDiff] = useState<HistoryDiffSession | null>(null)
  const historyDiffRef = useRef<HistoryDiffSession | null>(null)
  const [appSettingsSession, setAppSettingsSession] = useState<AppSettingsSession | null>(null)
  const finishAppSettings = useCallback((session: AppSettingsSession | null, completed = false) => {
    if (!session || sessionRef.current !== session) return
    sessionRef.current = null
    if (mountedRef.current) setAppSettingsSession(null)
    if (completed) session.resolve()
    else session.reject(settingsInterrupted())
  }, [])

  const closeOwnedSettings = useCallback(() => {
    const ownedTarget = ownedSettingsTargetRef.current
    ownedSettingsTargetRef.current = null
    const store = usePluginSettingsStore.getState()
    // An unrelated opener may already have replaced this surface's dialog.
    if (ownedTarget && store.settingsDialogTarget === ownedTarget) store.closeSettingsDialog()
  }, [])
  const interruptSettings = useCallback(() => {
    historyDiffRef.current?.finish(false)
    pasteScope.invalidate()
    // A closed/replaced surface cannot resume an old native save dialog after reopening.
    exportSessionRef.current += 1
    detachRef.current?.abort()
    handoffRef.current?.controller.abort()
    handoffRef.current = null
    deliveredHandoffRef.current = null
    closeOwnedSettings()
    finishAppSettings(sessionRef.current)
  }, [closeOwnedSettings, finishAppSettings, pasteScope])

  useLayoutEffect(() => {
    // Revoke synchronously on registry/permission changes, before React can
    // commit a replacement renderer while native delivery is still pending.
    const stopRegistry = pluginRegistry.subscribe(() => pasteScope.invalidate())
    const stopPermissions = usePluginPermissionStore.subscribe(() => pasteScope.invalidate())
    return () => { stopRegistry(); stopPermissions() }
  }, [pasteScope])

  const interruptSettingsRef = useRef(interruptSettings)
  interruptSettingsRef.current = interruptSettings
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      preparationScopeRef.current?.invalidate()
      interruptSettingsRef.current()
    }
  }, [])
  useLayoutEffect(() => () => preparationScopeRef.current?.invalidate(), [target])
  // The renderer owns cleanup; retained plugin setters cannot clear a newer owner.
  useLayoutEffect(() => () => onUnsavedChangesChange?.(false, leaveOwner), [leaveOwner, onUnsavedChangesChange])

  // External tool shortcuts replace target without resetting the launcher session.
  useLayoutEffect(() => () => interruptSettings(), [target, surfaceState, interruptSettings])

  useEffect(() => {
    hiddenRef.current = false
    let visibilityRevoked = false
    const interrupt = () => {
      if (!isPasteRecoveryTemporaryHidden()) {
        preparationScopeRef.current?.invalidate()
        interruptSettings()
      }
    }
    const pageHide = () => { preparationScopeRef.current?.invalidate(); interruptSettings() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (!isPasteRecoveryTemporaryHidden()) {
          visibilityRevoked = true
          interrupt()
        }
      } else if (visibilityRevoked) {
        visibilityRevoked = false
        refreshPasteOwner((version) => version + 1)
      }
    }
    window.addEventListener('pagehide', pageHide)
    document.addEventListener('visibilitychange', onVisibilityChange)
    let disposed = false
    let unlisten: (() => void) | undefined
    let unlistenFocus: (() => void) | undefined
    // Native independent windows can hide without unmounting or a DOM visibility event.
    // Only their existing registry lifecycle is observed; blur during OAuth is not hide.
    if (presentation === 'plugin-surface-window' && '__TAURI_INTERNALS__' in window) {
      void getCurrentWindow().onFocusChanged(({ payload }) => {
        if (!disposed) observePasteRecoveryFocus(payload)
      }).then((stop) => {
        if (disposed) stop()
        else unlistenFocus = stop
      }).catch((error) => console.warn('[hiven] Could not observe plugin paste focus:', error))
      const id = pluginSurfaceInstanceId(target)
      type Mutation = { type?: string; id?: string; state?: string; surface?: { id?: string; state?: string } }
      void import('@tauri-apps/api/event').then(({ listen }) => listen<Mutation>('hiven://surface-registry-sync', ({ payload }) => {
        if (disposed || activeTargetRef.current !== target || !payload) return
        const matches = payload.type === 'upsert' ? payload.surface?.id === id : payload.id === id
        if (!matches) return
        const state = payload.type === 'upsert' ? payload.surface?.state : payload.state
        if (state === 'visible') {
          preparationScopeRef.current?.invalidate()
          pasteScope.invalidate()
          hiddenRef.current = false
          refreshPasteOwner((version) => version + 1)
        }
        if (state === 'hidden' || state === 'destroyed' || payload.type === 'remove') {
          if (state === 'hidden' && isPasteRecoveryTemporaryHidden()) return
          hiddenRef.current = true
          preparationScopeRef.current?.invalidate()
          interruptSettings()
        }
      })).then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      }).catch((error) => console.warn('[hiven] Could not observe plugin settings window lifecycle:', error))
    }
    return () => {
      disposed = true
      unlisten?.()
      unlistenFocus?.()
      window.removeEventListener('pagehide', pageHide)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [target, presentation, interruptSettings, pasteScope])

  useEffect(() => {
    let disposed = false
    const preparationScope = createPasteRecoveryScope()
    preparationScopeRef.current = preparationScope
    const launcherOwner = presentation === 'global-launcher' ? captureLauncherPasteOwner() : undefined
    const preparationOwner = combinePasteRecoveryOwners(launcherOwner, preparationScope.capture(() => !disposed && mountedRef.current && activeTargetRef.current === target))
    let stopRegistry: (() => void) | undefined
    let stopPermissions: (() => void) | undefined

    async function openSurface() {
      setSurfaceState({ status: 'loading-runtime' })

      try {
        await ensurePluginRuntimeReady(target.source)
        if (disposed) return
        stopRegistry = pluginRegistry.subscribe(() => preparationScope.invalidate())
        stopPermissions = usePluginPermissionStore.subscribe(() => preparationScope.invalidate())

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
          ai: createPluginAi(target.pluginId, target.source, permissions),
          missingPermissions,
        }

        if (missingPermissions.length > 0) {
          setSurfaceState({ status: 'permission-gate', ...resolved })
          return
        }

        setSurfaceState({ status: 'before-open', ...resolved })

        const settingsContribution = definition.settings
        const settings = settingsContribution ? resolvePluginSettings(target.source, target.pluginId, settingsContribution).value : {}
        const storage = createPluginPrivateStorage(target.source, target.pluginId, permissions, {
          // Preparation has no presented surface owner for an interactive save.
          capture: () => () => false,
        })
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
          paste: createPluginPaste(permissions, storage, {
            ownerSource: {
              capture: () => {
                if (presentation === 'global-launcher' && !launcherOwner) return undefined
                return preparationOwner
              },
            },
          }),
          network: createPluginNetwork(permissions),
          shell: createPluginShell(permissions),
          ai: resolved.ai,
        })

        preparationScope.invalidate()
        if (!disposed) {
          setSurfaceState({ status: 'ready', ...resolved })
        }
      } catch (error) {
        preparationScope.invalidate()
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

    return () => { disposed = true; preparationScope.invalidate(); stopRegistry?.(); stopPermissions?.() }
  }, [target, pluginRegistryVersion, permissionVersion, locale, presentation])

  const deliveryFeedbackOwner = useMemo<NonNullable<PluginSurfaceHostApi['deliveryFeedbackOwner']>>(() => {
    const lifetime = pluginRegistry.getPluginLifetime(target.pluginId, target.source)
    const surfaceOwner = pasteScope.capture(() => mountedRef.current
      && activeTargetRef.current === target && activeStateRef.current === surfaceState
      && surfaceState.status === 'ready' && surfaceState.target === target
      && !hiddenRef.current && !suspendedRef.current && suspensionOwnerRef.current === suspensionOwner && !sessionRef.current && lifetime.active)
    const launcherOwner = presentation === 'global-launcher' ? captureLauncherPasteOwner({ complete: false }) : undefined
    const owner = combinePasteRecoveryOwners(surfaceOwner, launcherOwner)
    return {
      isCurrent: () => owner.isCurrent() && (presentation !== 'global-launcher' || launcherOwner !== undefined),
      subscribeInvalidation: owner.subscribeInvalidation,
    }
  }, [target, surfaceState, pasteScope, presentation, pasteOwnerVersion, appSettingsSession, launcherSettingsTarget, launcherSessionId])

  // Stable within the presented owner, including ordinary theme/status rerenders.
  // Retained callbacks never capture a replacement generation at invocation time.
  const saveText = useMemo<NonNullable<PluginSurfaceHostApi['saveText']>>(() => {
    const lifetime = pluginRegistry.getPluginLifetime(target.pluginId, target.source)
    const surfaceOwner = pasteScope.capture(() => mountedRef.current
      && activeTargetRef.current === target && activeStateRef.current === surfaceState
      && surfaceState.status === 'ready' && surfaceState.target === target
      && !hiddenRef.current && !suspendedRef.current && suspensionOwnerRef.current === suspensionOwner && !sessionRef.current && lifetime.active
      && (!ownedSettingsTargetRef.current || usePluginSettingsStore.getState().settingsDialogTarget !== ownedSettingsTargetRef.current))
    const launcherOwner = presentation === 'global-launcher' ? captureLauncherPasteOwner({ complete: false }) : undefined
    const owner = combinePasteRecoveryOwners(surfaceOwner, launcherOwner)
    const originalLauncher = useAppStore.getState()
    const isCurrentLauncherLifetime = () => {
      const current = useAppStore.getState()
      return current.globalLauncherOpen && current.globalLauncherSessionId === originalLauncher.globalLauncherSessionId
    }
    return (snapshot, options) => textSaverRef.current(snapshot, options, {
      owner: {
        ...owner,
        isCurrent: () => owner.isCurrent() && (presentation !== 'global-launcher' || launcherOwner !== undefined),
      },
      dialogTitle: t(localeRef.current, 'palette.surfaceTextSaveDialogTitle'),
      acquireFocusLease: () => presentation === 'global-launcher'
        ? acquireLauncherNativeDialogFocus(isCurrentLauncherLifetime) : () => {},
    })
  }, [target, surfaceState, pasteScope, presentation, pasteOwnerVersion, appSettingsSession, launcherSettingsTarget, launcherSessionId])

  useEffect(() => {
    if (surfaceState.status === 'error' || surfaceState.status === 'surface-not-found' || surfaceState.status === 'permission-gate') onHandoffReady?.(false)
  }, [surfaceState, target, onHandoffReady])

  const historyPasteQueue = useMemo(() => target.pluginId === 'clipboard-history'
    && surfaceState && 'definition' in surfaceState
    && isCurrentBundledDefinition(target.pluginId, target.source, surfaceState.definition)
    ? createHistoryPasteQueueBridge({ source: target.source, pluginId: target.pluginId,
      isCurrent: deliveryFeedbackOwner.isCurrent, subscribeInvalidation: deliveryFeedbackOwner.subscribeInvalidation }) : undefined,
  [target, surfaceState, deliveryFeedbackOwner])

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
  const SurfaceComponent = surfaceState.surface.component
  const lifetime = pluginRegistry.getPluginLifetime(target.pluginId, target.source)
  const isCurrentSurface = () => mountedRef.current && activeTargetRef.current === target && activeStateRef.current === surfaceState && !hiddenRef.current && !suspendedRef.current && suspensionOwnerRef.current === suspensionOwner && lifetime.active
  // Bind this host object now. A retained callback from before hide/reopen must
  // not capture the replacement generation when it eventually calls paste.
  const surfaceOwner = pasteScope.capture(
    () => isCurrentSurface() && !historyDiffRef.current,
    presentation === 'plugin-surface-window' ? () => { hiddenRef.current = true } : undefined,
  )
  const launcherPasteOwner = presentation === 'global-launcher' ? captureLauncherPasteOwner({ complete: false }) : undefined
  const pasteOwner = combinePasteRecoveryOwners(launcherPasteOwner, surfaceOwner)
  const hostStorage = createPluginPrivateStorage(target.source, target.pluginId, surfaceState.permissions, {
    capture: () => {
      const exportSession = exportSessionRef.current
      return () => isCurrentSurface() && exportSessionRef.current === exportSession
    },
  })
  const leaveSurface = (action: () => void) => {
    if (!isCurrentSurface()) return
    interruptSettings()
    action()
  }
  const requestLeave = (action: 'back' | 'close') => {
    if (!isCurrentSurface()) return
    // Keep this renderer intact until the Launcher decides whether to leave.
    if (onRequestLeave) onRequestLeave(action)
    else leaveSurface(action === 'back' ? onBack : onClose)
  }

  return (
    <PluginSurfaceErrorBoundary
      pluginId={target.pluginId}
      locale={locale}
      onBack={onBack}
      onError={() => {
        crashedRef.current = true
        interruptSettings()
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
        <div style={{ display: 'contents' }} inert={detaching || suspended} aria-busy={detaching || undefined}>
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
            historyPasteQueue,
            compareHistoryTexts: target.pluginId === 'clipboard-history' && isCurrentBundledDefinition(target.pluginId, target.source, surfaceState.definition) ? async (snapshots, options) => {
              const owner = deliveryFeedbackOwner
              if (!owner.isCurrent() || options?.signal?.aborted || historyDiffRef.current) return false
              const diffTarget = prepareHistoryDiffTarget(target.source, target.pluginId, snapshots)
              await ensurePluginRuntimeReady('builtin')
              if (!owner.isCurrent() || options?.signal?.aborted || historyDiffRef.current) return false
              const definition = pluginRegistry.getPluginDefinition('text-diff', 'builtin')
              if (!isCurrentBundledDefinition('text-diff', 'builtin', definition) || !definition?.ui?.surfaces?.some((surface) => surface.id === 'main')) return false
              const receipt = createHistoryDiffReturnReceipt(owner, options?.signal, () => {
                if (historyDiffRef.current !== session) return
                historyDiffRef.current = null
                if (mountedRef.current) setHistoryDiff(null)
              })
              const session: HistoryDiffSession = { target: diffTarget, owner: surfaceState, finish: receipt.finish }
              historyDiffRef.current = session
              receipt.start()
              if (historyDiffRef.current === session) setHistoryDiff(session)
              return receipt.promise
            } : undefined,
            openHistoryTextInQuickEditor: target.pluginId === 'clipboard-history' && isCurrentBundledDefinition(target.pluginId, target.source, surfaceState.definition) ? async (snapshot, options) => {
              const owner = deliveryFeedbackOwner
              if (!owner.isCurrent() || options?.signal?.aborted) return false
              try {
                const { overwriteQuickEditorText } = await import('../../workspace/quickEditor/quickEditorRequests')
                if (!owner.isCurrent() || options?.signal?.aborted) return false
                await overwriteQuickEditorText(snapshot, { source: 'history-item' }, {
                  signal: options?.signal,
                  isCurrent: owner.isCurrent,
                  onCommit: options?.commit,
                })
                return true
              } catch (error) {
                console.warn('[hiven] Failed to open History text in Quick Editor:', error)
                return false
              }
            } : undefined,
            deliveryFeedbackOwner,
            close: () => requestLeave('close'),
            complete: () => {
              if (presentation === 'global-launcher' && surfaceOwner.isCurrent()) leaveSurface(onClose)
            },
            requestBack: () => requestLeave('back'),
            setUnsavedChanges: onUnsavedChangesChange ? setUnsavedChanges : undefined,
            subscribeLeaveIntent: onUnsavedChangesChange ? subscribeLeaveIntent : undefined,
            openSettings: (options) => {
              if (!isCurrentSurface()) return
              interruptSettings()
              refreshPasteOwner((version) => version + 1)
              const settingsTarget: NonNullable<PluginSettingsDialogTarget> = {
                pluginId: target.pluginId,
                source: target.source,
                presentation: presentation === 'editor-panel' || (presentation === 'global-launcher' && options?.preserveSurface === true) ? 'dialog' : presentation,
                context: { surfaceId: contextSurfaceId as never },
              }
              if (settingsTarget.presentation === 'dialog') ownedSettingsTargetRef.current = settingsTarget
              openSettingsDialog(settingsTarget)
            },
            openAppSettings: ({ section }) => {
              if (section !== 'ai' || !isCurrentSurface() || document.visibilityState === 'hidden') return Promise.reject(settingsInterrupted())
              if (sessionRef.current) return sessionRef.current.promise
              pasteScope.invalidate()
              closeOwnedSettings()
              let resolve!: () => void
              let reject!: (error: Error) => void
              const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
              const session: AppSettingsSession = { target, owner: surfaceState, promise, resolve, reject }
              sessionRef.current = session
              setAppSettingsSession(session)
              return promise
            },
            detachToWindow: (initialText?: string) => {
              if (!isCurrentSurface() || detachRef.current) return
              interruptSettings()
              refreshPasteOwner((version) => version + 1)
              const controller = new AbortController()
              detachRef.current = controller
              setDetaching(true)
              const windowTarget = { ...target, initialText: initialText ?? target.initialText ?? '' }
              const current = () => isCurrentSurface() && !controller.signal.aborted && detachRef.current === controller
              const releaseFocus = presentation === 'global-launcher' ? acquireLauncherNativeDialogFocus(current) : () => {}
              void (async () => {
                try {
                  const { showPluginSurfaceWindow } = await import('../../workspace/windowManager/pluginSurfaceWindows')
                  await showPluginSurfaceWindow(windowTarget, { signal: controller.signal, isCurrent: current })
                  if (current()) onClose()
                } catch (error) {
                  if (current()) showToast(t(localeRef.current, String(error).includes('PluginSurfaceHandoffTooLarge')
                    ? 'palette.surfaceWindowHandoffTooLarge' : 'palette.surfaceWindowHandoffFailed'), 'error')
                } finally {
                  releaseFocus()
                  if (detachRef.current === controller) {
                    detachRef.current = null
                    if (mountedRef.current) setDetaching(false)
                  }
                }
              })()
            },
            showMessage: (message, level) => {
              if (!surfaceOwner.isCurrent() || (presentation === 'global-launcher' && launcherPasteOwner?.isCurrent() !== true)) return
              showToast(message, level ?? 'info')
            },
            showToast: (message, level, options) => {
              if (!surfaceOwner.isCurrent() || (presentation === 'global-launcher' && launcherPasteOwner?.isCurrent() !== true)) return ''
              return showToast(message, level, options)
            },
            dismissToast,
            saveText,
            returnToLauncherWithObject: (input: PluginObjectBlockInput, options?: { signal?: AbortSignal }) => {
              if (!isCurrentSurface() || options?.signal?.aborted) return Promise.resolve(false)
              if (handoffRef.current) return handoffRef.current.promise
              const inputKey = JSON.stringify(input)
              const delivered = deliveredHandoffRef.current?.owner === surfaceState && deliveredHandoffRef.current.input === inputKey
                ? deliveredHandoffRef.current : null
              interruptSettings()
              const block = delivered?.block ?? createPluginSurfaceObjectBlock(input)
              // Handoff revokes pending output attempts, but a rejected handoff
              // leaves this surface usable for a fresh explicit delivery.
              refreshPasteOwner((version) => version + 1)
              const controller = new AbortController()
              const handoff = { controller, promise: Promise.resolve(false) }
              handoffRef.current = handoff
              const abortHandoff = () => {
                controller.abort()
                if (handoffRef.current === handoff) handoffRef.current = null
              }
              options?.signal?.addEventListener('abort', abortHandoff, { once: true })
              handoff.promise = (async () => {
                try {
                  const crossWindow = isNativeDesktopRuntime() && getCurrentWindow().label !== LAUNCHER_WINDOW_LABEL
                  if (crossWindow) {
                    const accepted = await requestLauncherObjectHandoff(block, {
                      signal: controller.signal,
                      isCurrent: () => isCurrentSurface() && handoffRef.current === handoff,
                    })
                    if (!accepted) return false
                  } else if (!crossWindow) {
                    useAppStore.getState().openGlobalLauncherOverlay()
                    // Let a previously closed in-app launcher mount its receiver.
                    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
                    if (!isCurrentSurface() || controller.signal.aborted || handoffRef.current !== handoff) return false
                    // Only the material hook can confirm synchronous acceptance.
                    if (!setPendingObjectBlock(block, { persist: true })) {
                      clearPendingObjectBlock(block)
                      return false
                    }
                  }
                  if (!isCurrentSurface() || controller.signal.aborted || handoffRef.current !== handoff) return false
                  handoffRef.current = null
                  hiddenRef.current = true
                  const stillOwned = () => mountedRef.current && activeTargetRef.current === target && activeStateRef.current === surfaceState && !controller.signal.aborted
                  // After delivery, native blur-hide is expected. Do not explicitly
                  // leave or clear the source draft until visibility is confirmed.
                  if (crossWindow && !await showLauncherAfterObjectHandoff(stillOwned)) {
                    if (!stillOwned()) return false
                    if (presentation === 'plugin-surface-window') {
                      try {
                        if (!await getCurrentWindow().isVisible()) {
                          const { showPluginSurfaceWindow } = await import('../../workspace/windowManager/pluginSurfaceWindows')
                          await showPluginSurfaceWindow(target)
                        }
                      } catch (error) {
                        console.warn('[hiven] Could not restore the source after launcher show failed:', error)
                      }
                    }
                    if (!stillOwned()) return false
                    hiddenRef.current = false
                    deliveredHandoffRef.current = { owner: surfaceState, input: inputKey, block }
                    showToast(pickLocale(locale, '材料已带回，但无法显示 Launcher，请重试', 'Material delivered, but Launcher could not be shown. Please retry.'), 'error')
                    return false
                  }
                  if (!stillOwned()) return false
                  useAppStore.getState().clearPluginSurfaceTool()
                  useAppStore.setState({ previousLauncherHostSurfaceTarget: null })
                  onBack()
                  return true
                } catch (error) {
                  console.warn('[hiven] Failed to return object to launcher:', error)
                  return false
                }
              })().then((accepted) => {
                options?.signal?.removeEventListener('abort', abortHandoff)
                if (handoffRef.current === handoff) {
                  handoffRef.current = null
                  if (!accepted && isCurrentSurface() && !controller.signal.aborted) {
                    showToast(pickLocale(locale, '无法带回 Launcher，请重试', 'Could not return to Launcher. Please retry.'), 'error')
                  }
                }
                return accepted
              })
              return handoff.promise
            },
            storage: hostStorage,
            clipboard: createPluginClipboard(target.pluginId, surfaceState.permissions, hostStorage, {
              source: target.source,
              isCurrent: () => surfaceOwner.isCurrent()
                && (presentation !== 'global-launcher' || launcherPasteOwner?.isCurrent() === true),
            }),
            paste: createPluginPaste(surfaceState.permissions, hostStorage, {
              keepOpen: presentation !== 'global-launcher' && target.pluginId !== 'clipboard-history',
              ownerSource: {
                capture: () => {
                  if (!surfaceOwner.isCurrent()) return undefined
                  if (presentation === 'global-launcher' && !launcherPasteOwner) return undefined
                  return pasteOwner
                },
              },
            }),
            network: createPluginNetwork(surfaceState.permissions),
            shell: createPluginShell(surfaceState.permissions),
            ai: surfaceState.ai,
          }}
        />
        {onHandoffReady && <PluginSurfaceCommitted onCommit={() => { if (!crashedRef.current && activeStateRef.current === surfaceState) onHandoffReady(true) }} />}
        </div>
      )}
      {historyDiff && historyDiff.owner === surfaceState && (
        <PluginSurfaceRenderer
          target={historyDiff.target} locale={locale} presentation={presentation}
          contextSurfaceId={contextSurfaceId}
          onBack={() => historyDiff.finish(true)} onClose={() => historyDiff.finish(true)}
        />
      )}
      {appSettingsSession && appSettingsSession.target === target && appSettingsSession.owner === surfaceState && (
        <PluginAppSettingsDialog locale={locale} onClose={() => finishAppSettings(appSettingsSession, isCurrentSurface() && document.visibilityState !== 'hidden')} />
      )}
    </PluginSurfaceErrorBoundary>
  )
}

function PluginSurfaceCommitted({ onCommit }: { onCommit: () => void }) {
  useEffect(onCommit, [onCommit])
  return null
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
