/**
 * hiven Plugin System - Plugin Settings Dialog
 * A global singleton dialog that renders a plugin's settings body component.
 * The host provides the dialog shell (title, close, scroll, error boundary).
 * The plugin provides the body content via its settings.component.
 */

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { t } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { useAppStore } from '../store'
import { showToast } from '../workspace/toast'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import {
  usePluginSettingsStore,
  type PluginSettingsSource,
  type PluginSettingsFieldTarget,
} from '../workspace/pluginSettingsStore'
import { openExternalUrl } from '../workspace/effectRunner'
import type { PluginSettingsContribution } from '../workspace/pluginTypes'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createPluginNetwork } from '../workspace/pluginNetwork'
import { createPluginAi } from '../workspace/ai/runtime'
import { createPluginShell } from '../workspace/pluginShell'
import { getPluginPermissionSnapshot, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { PluginSettingsSchemaRenderer } from './PluginSettingsSchemaRenderer'
import { resolvePluginSettingsModal, type ResolvedPluginSettingsModal } from './pluginSettingsModalResolution'
import { readSettingsConfirmationSnapshot } from './pluginSettingsConfirmation'
import { navigateToPluginSettingsField } from './pluginSettingsFieldNavigation'

// ─── Error Boundary ──────────────────────────────────────────────────────────

type ErrorBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

class SettingsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[hiven] Plugin settings component crashed:', error, info)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

// ─── Dialog Component ────────────────────────────────────────────────────────

export function PluginSettingsDialog() {
  const locale = useAppStore((s) => s.locale)
  const target = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const [renderedTarget, setRenderedTarget] = useState(target)
  const [isClosing, setIsClosing] = useState(false)
  const titleId = 'plugin-settings-dialog-title'

  useEffect(() => {
    if (target) {
      setRenderedTarget(target)
      setIsClosing(false)
      return
    }
    if (!renderedTarget) return
    setIsClosing(true)
    const timer = window.setTimeout(() => {
      setRenderedTarget(null)
      setIsClosing(false)
    }, 90)
    return () => window.clearTimeout(timer)
  }, [renderedTarget, target])

  const activeTarget = target ?? renderedTarget
  if (!activeTarget) return null
  if (activeTarget.presentation === 'global-launcher') return null
  const fillsPluginWindow = activeTarget.presentation === 'plugin-surface-window'

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !isClosing) closeSettingsDialog() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={`plugin-settings-dialog-backdrop fixed inset-0 bg-black/40 z-[1200]${isClosing ? ' is-closing' : ''}`} />
        <Dialog.Popup
          aria-labelledby={titleId}
          initialFocus={activeTarget.target ? false : () => document.querySelector<HTMLElement>('[data-settings-dialog-close]')}
          className={`fixed left-1/2 top-1/2 z-[1201] -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden plugin-settings-dialog-panel${isClosing ? ' is-closing' : ''}`}
          style={{
            width: fillsPluginWindow ? '100vw' : 'min(780px, calc(100vw - 40px))',
            height: fillsPluginWindow ? '100vh' : 'min(680px, calc(100vh - 48px))',
            maxHeight: fillsPluginWindow ? '100vh' : 'min(680px, calc(100vh - 48px))',
            background: 'var(--panel, var(--bg-surface, #ffffff))',
            border: '1px solid var(--border, var(--color-border-secondary))',
            borderRadius: fillsPluginWindow ? 0 : '14px',
            boxShadow: 'var(--shadow-panel, 0 20px 50px -12px rgba(18, 22, 28, 0.22), 0 0 0 1px rgba(18, 22, 28, 0.06))',
            outline: 'none',
          }}
        >
          <PluginSettingsContent
            pluginId={activeTarget.pluginId}
            source={activeTarget.source}
            target={target?.target}
            locale={locale}
            onClose={closeSettingsDialog}
            titleId={titleId}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// ─── Dialog Content ──────────────────────────────────────────────────────────

export function PluginSettingsContent({
  pluginId,
  source,
  target,
  locale,
  onClose,
  titleId,
}: {
  pluginId: string
  source: PluginSettingsSource
  target?: PluginSettingsFieldTarget
  locale: 'zh' | 'en'
  onClose: () => void
  titleId?: string
}) {
  // Resolve the plugin's settings contribution from the registry
  const registryVersion = usePluginRegistryVersion()
  const contribution = useMemo(() => {
    const registrySource = source === 'dev' ? 'dev' : 'production'
    const allCommands = pluginRegistry.getAllCommands()
    // Find plugin definition by pluginId - look through registered contributions
    for (const entry of allCommands) {
      if (entry.meta.pluginId === pluginId && entry.meta.source === registrySource) {
        // Found a command from this plugin; now get the definition
        const def = pluginRegistry.getPluginDefinition(pluginId, registrySource)
        return def?.settings as PluginSettingsContribution<unknown> | undefined
      }
    }
    // Also try directly via definition lookup
    const def = pluginRegistry.getPluginDefinition(pluginId, source === 'dev' ? 'dev' : 'production')
    return def?.settings as PluginSettingsContribution<unknown> | undefined
  }, [pluginId, source, registryVersion])

  if (!contribution) {
    return (
      <div className="p-6 text-center" style={{ color: 'var(--color-text-secondary)' }}>
        <p>{t(locale, 'scripts.settingsNoSettings')}</p>
        <button
          className="mt-4 px-3 py-1.5 rounded-md text-[13px]"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)' }}
          onClick={onClose}
          data-settings-dialog-close
        >
          {t(locale, 'scripts.settingsClose')}
        </button>
      </div>
    )
  }

  return (
    <SettingsDialogBody
      key={`${source}:${pluginId}`}
      pluginId={pluginId}
      source={source}
      target={target}
      contribution={contribution}
      locale={locale}
      onClose={onClose}
      titleId={titleId}
    />
  )
}

// ─── Dialog Body (with resolved settings) ────────────────────────────────────

function SettingsDialogBody({
  pluginId,
  source,
  target,
  contribution,
  locale,
  onClose,
  titleId,
}: {
  pluginId: string
  source: PluginSettingsSource
  target?: PluginSettingsFieldTarget
  contribution: PluginSettingsContribution<unknown>
  locale: 'zh' | 'en'
  onClose: () => void
  titleId?: string
}) {
  const setPluginSettings = usePluginSettingsStore((s) => s.setPluginSettings)
  const bodyRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (target && bodyRef.current) return navigateToPluginSettingsField(bodyRef.current, target)
  }, [target])
  // Subscribe to the store record reactively so UI updates on setValue
  const storedRecord = usePluginSettingsStore((s) => s.pluginSettings[source][pluginId])
  // Observe the record itself so persisted/rehydrated grants update the body too.
  const pluginPermissions = usePluginPermissionStore((s) => s.permissions[source][pluginId])
  const [settingsModalTarget, setSettingsModalTarget] = useState<ResolvedPluginSettingsModal<unknown> | null>(null)
  const [renderedSettingsModalTarget, setRenderedSettingsModalTarget] = useState<ResolvedPluginSettingsModal<unknown> | null>(null)
  const [isSettingsModalClosing, setIsSettingsModalClosing] = useState(false)
  void pluginPermissions

  const currentVersion = contribution.version ?? 1

  const { value, migrationError } = useMemo(() => {
    if (!storedRecord) {
      return { value: contribution.defaultValue }
    }
    const storedVersion = storedRecord.version ?? 1
    if (storedVersion === currentVersion) {
      return { value: storedRecord.value }
    }
    if (storedVersion > currentVersion) {
      return { value: contribution.defaultValue, migrationError: 'settings_version_higher_than_plugin' }
    }
    if (contribution.migrate) {
      try {
        const migrated = contribution.migrate(storedRecord.value, storedVersion)
        if (migrated == null) {
          return { value: contribution.defaultValue, migrationError: 'migration_returned_null' }
        }
        return { value: migrated }
      } catch (error) {
        return { value: contribution.defaultValue, migrationError: error instanceof Error ? error.message : String(error) }
      }
    }
    return { value: storedRecord.value }
  }, [storedRecord, currentVersion, contribution])

  const title = contribution.titleI18n?.[locale] ?? contribution.title ?? t(locale, 'scripts.settingsDialogTitle')
  const pluginT = useMemo(() => makePluginT(pluginId, locale), [pluginId, locale])
  const requestedPermissions = useMemo(() => pluginRegistry.getPluginPermissions(pluginId, source), [pluginId, source])
  const permissions = getPluginPermissionSnapshot(source, pluginId, requestedPermissions)
  const settingsHost = useMemo(() => ({
    t: pluginT,
    permissions,
    storage: createPluginPrivateStorage(source, pluginId, permissions),
    ai: createPluginAi(pluginId, source, permissions),
    showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error') {
      showToast(message, level ?? 'info')
    },
  }), [source, pluginId, permissions, pluginT])

  const settingsNetwork = useMemo(
    () => createPluginNetwork(permissions),
    [permissions],
  )
  const settingsShell = useMemo(
    () => createPluginShell(permissions),
    [permissions],
  )

  const notifySettingsChange = useCallback((next: unknown) => {
    if (!contribution.onChange) return
    void Promise.resolve(
      contribution.onChange({
        value: next,
        pluginId,
        source,
        storage: settingsHost.storage,
        network: settingsNetwork,
        shell: settingsShell,
        ai: settingsHost.ai,
      }),
    ).catch((error) => {
      console.warn(`[hiven] Plugin settings onChange failed for "${pluginId}":`, error)
    })
  }, [contribution, pluginId, source, settingsHost.ai, settingsHost.storage, settingsNetwork, settingsShell])

  const setValue = useCallback(
    (next: unknown) => {
      setPluginSettings(source, pluginId, next, currentVersion)
      notifySettingsChange(next)
    },
    [setPluginSettings, source, pluginId, currentVersion, notifySettingsChange]
  )

  const updateValue = useCallback(
    (patch: Partial<unknown>) => {
      const current = usePluginSettingsStore.getState().getPluginSettings(source, pluginId)
      const currentValue = current?.value ?? contribution.defaultValue
      const next = { ...(currentValue as Record<string, unknown>), ...(patch as Record<string, unknown>) }
      setPluginSettings(source, pluginId, next, currentVersion)
      notifySettingsChange(next)
    },
    [setPluginSettings, source, pluginId, currentVersion, contribution.defaultValue, notifySettingsChange]
  )

  // Only schema fields explicitly opting in use this UI gate. The store and
  // ordinary settings callbacks retain their existing persistence semantics.
  type PendingDecrease = { key: string; from: number; to: number; fingerprint: string; generation: number; title: string; message: string }
  const [pendingDecrease, setPendingDecrease] = useState<PendingDecrease | null>(null)
  const [confirmationError, setConfirmationError] = useState('')
  const settingsOwner = usePluginSettingsStore((state) => state.settingsDialogTarget)
  const confirmationGeneration = useRef(0)
  const confirmationActive = useRef(false)
  const cancelConfirmationButton = useRef<HTMLButtonElement>(null)
  const cancelDecrease = useCallback(() => {
    confirmationGeneration.current++
    setPendingDecrease(null)
  }, [])
  useLayoutEffect(() => {
    confirmationActive.current = true
    cancelDecrease()
    setConfirmationError('')
    return () => { confirmationActive.current = false; confirmationGeneration.current++ }
  }, [settingsOwner, contribution, cancelDecrease])
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') cancelDecrease() }
    window.addEventListener('pagehide', cancelDecrease)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', cancelDecrease)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [cancelDecrease])
  const confirmationCurrent = () => document.visibilityState !== 'hidden' && confirmationActive.current && !!settingsOwner
    && settingsOwner.source === source && settingsOwner.pluginId === pluginId
    && usePluginSettingsStore.getState().settingsDialogTarget === settingsOwner
    && pluginRegistry.getPluginDefinition(pluginId, source)?.settings === contribution
  const refreshConfirmationConflict = () => {
    cancelDecrease()
    void usePluginSettingsStore.persist.rehydrate()
    setConfirmationError(t(locale, 'scripts.settingsConfirmConflict'))
  }
  useLayoutEffect(() => {
    if (pendingDecrease && JSON.stringify(storedRecord ?? null) !== pendingDecrease.fingerprint) {
      cancelDecrease()
      setConfirmationError(t(locale, 'scripts.settingsConfirmConflict'))
    }
  }, [storedRecord, pendingDecrease, cancelDecrease, locale])
  const schemaUpdateValue = (patch: Partial<unknown>) => {
    const keys = Object.keys(patch)
    const field = keys.length === 1 ? contribution.schema?.sections.flatMap(section => section.fields)
      .find(candidate => 'key' in candidate && candidate.key === keys[0]) : undefined
    if (field?.kind !== 'number' || !field.confirmDecrease) { updateValue(patch); return }
    if (!confirmationCurrent()) return
    cancelDecrease(); setConfirmationError('')
    try {
      const snapshot = readSettingsConfirmationSnapshot(window.localStorage, source, pluginId, contribution)
      // Include other fields/version in the baseline, not only the displayed number.
      if (snapshot.fingerprint !== JSON.stringify(storedRecord ?? null)) { refreshConfirmationConflict(); return }
      const from = snapshot.value[field.key]
      const to = (patch as Record<string, unknown>)[field.key]
      if (typeof from !== 'number' || !Number.isFinite(from) || typeof to !== 'number' || !Number.isFinite(to)) throw new Error('Invalid numeric setting')
      if (to >= from) {
        try { updateValue(patch) } catch { setConfirmationError(t(locale, 'scripts.settingsConfirmSaveFailed')) }
        return
      }
      setPendingDecrease({ key: field.key, from, to, fingerprint: snapshot.fingerprint,
        generation: confirmationGeneration.current, ...field.confirmDecrease })
    } catch { setConfirmationError(t(locale, 'scripts.settingsConfirmReadFailed')) }
  }
  const confirmDecrease = (candidate: PendingDecrease) => {
    if (!confirmationCurrent() || candidate.generation !== confirmationGeneration.current) return
    let snapshot: ReturnType<typeof readSettingsConfirmationSnapshot>
    try { snapshot = readSettingsConfirmationSnapshot(window.localStorage, source, pluginId, contribution) }
    catch { setConfirmationError(t(locale, 'scripts.settingsConfirmReadFailed')); return }
    if (snapshot.fingerprint !== candidate.fingerprint || snapshot.value[candidate.key] !== candidate.from) {
      refreshConfirmationConflict(); return
    }
    // Synchronous preflight only, not atomic against another webview's write.
    cancelDecrease(); setConfirmationError('')
    try { setValue({ ...snapshot.value, [candidate.key]: candidate.to }) }
    catch { setConfirmationError(t(locale, 'scripts.settingsConfirmSaveFailed')) }
  }

  const resetValue = useCallback(() => {
    setPluginSettings(source, pluginId, contribution.defaultValue, currentVersion)
    notifySettingsChange(contribution.defaultValue)
  }, [setPluginSettings, source, pluginId, contribution.defaultValue, currentVersion, notifySettingsChange])

  const openExternal = useCallback(async (url: string) => {
    await openExternalUrl(url)
  }, [])

  const SettingsComponent = contribution.component
  useEffect(() => {
    if (settingsModalTarget) {
      setRenderedSettingsModalTarget(settingsModalTarget)
      setIsSettingsModalClosing(false)
      return
    }
    if (!renderedSettingsModalTarget) return
    setIsSettingsModalClosing(true)
    const timer = window.setTimeout(() => {
      setRenderedSettingsModalTarget(null)
      setIsSettingsModalClosing(false)
    }, 90)
    return () => window.clearTimeout(timer)
  }, [renderedSettingsModalTarget, settingsModalTarget])

  const activeSettingsModalTarget = settingsModalTarget ?? renderedSettingsModalTarget
  const SettingsModalComponent = activeSettingsModalTarget?.modal.component
  const settingsModalTitle = activeSettingsModalTarget
    ? activeSettingsModalTarget.modal.titleI18n?.[locale] ?? activeSettingsModalTarget.modal.title
    : ''
  const settingsModalTitleId = 'plugin-settings-modal-title'

  const errorFallback = (
    <div className="p-4 text-[13px]" style={{ color: 'var(--color-error)' }}>
      {t(locale, 'scripts.settingsRenderError')}
    </div>
  )

  const settingsBodyProps = {
    pluginId,
    source,
    locale,
    t: pluginT,
    value,
    defaultValue: contribution.defaultValue,
    setValue,
    updateValue,
    resetValue,
    openExternal,
    host: settingsHost,
  }

  return (
    <>
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 shrink-0"
        style={{ borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}
      >
        <h2
          id={titleId}
          className="text-[15px] font-semibold m-0"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {title}
        </h2>
        <button
          className="flex items-center justify-center w-7 h-7 rounded-md"
          style={{ color: 'var(--color-text-tertiary)', background: 'transparent' }}
          onClick={() => { cancelDecrease(); onClose() }}
          title={t(locale, 'scripts.settingsClose')}
          aria-label={t(locale, 'scripts.settingsClose')}
          data-settings-dialog-close
        >
          <X size={16} />
        </button>
      </div>

      {/* Migration warning */}
      {migrationError && (
        <div
          className="px-5 py-2 text-[12px]"
          style={{ background: 'var(--color-warning-light, rgba(255,200,0,0.1))', color: 'var(--color-warning, #b58900)' }}
        >
          {migrationError === 'settings_version_higher_than_plugin'
            ? t(locale, 'scripts.settingsVersionHigher')
            : t(locale, 'scripts.settingsMigrationError')}
        </div>
      )}

      {confirmationError && !pendingDecrease && <p role="alert" className="px-5 text-[13px]">{confirmationError}</p>}
      {/* Body */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-5 py-4" data-launcher-scrollable data-settings-navigation-root={target ? '' : undefined} tabIndex={-1}>
        <SettingsErrorBoundary fallback={errorFallback}>
          {/* Prefer custom body when present (install guides, connection UI).
              Schema-only plugins keep the generated form renderer. */}
          {SettingsComponent ? (
            <SettingsComponent {...settingsBodyProps} />
          ) : contribution.schema ? (
            <PluginSettingsSchemaRenderer
              schema={contribution.schema}
              locale={locale}
              translateText={pluginT}
              value={value}
              updateValue={schemaUpdateValue}
              onOpenModal={(field) => setSettingsModalTarget(resolvePluginSettingsModal(contribution, field))}
              onRunAction={async (field, reportProgress) => {
                await field.run({ ...settingsBodyProps, reportProgress })
              }}
              permissions={permissions}
            />
          ) : (
            <div className="text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
              {t(locale, 'scripts.settingsRenderError')}
            </div>
          )}
        </SettingsErrorBoundary>
      </div>

      {pendingDecrease && <Dialog.Root open onOpenChange={(open) => { if (!open) cancelDecrease() }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-[1220]" />
          <Dialog.Popup className="plugin-settings-modal-panel fixed left-1/2 top-1/2 z-[1221] -translate-x-1/2 -translate-y-1/2 w-[min(440px,calc(100%-40px))] rounded-lg p-5"
            style={{ background: 'var(--panel)', border: '1px solid var(--border)' }} initialFocus={cancelConfirmationButton}>
            <Dialog.Title className="text-[14px] font-semibold">{pluginT(pendingDecrease.title, { from: pendingDecrease.from, to: pendingDecrease.to })}</Dialog.Title>
            <Dialog.Description className="mt-3 text-[13px]">{pluginT(pendingDecrease.message)}</Dialog.Description>
            {confirmationError && <p role="alert" className="mt-3 text-[13px]">{confirmationError}</p>}
            <div className="mt-4 flex justify-end gap-3">
              <button ref={cancelConfirmationButton} type="button" onClick={cancelDecrease}>{t(locale, 'scripts.cancel')}</button>
              <button type="button" onClick={() => confirmDecrease(pendingDecrease)}>{t(locale, 'scripts.settingsConfirmSave')}</button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>}

      {activeSettingsModalTarget && SettingsModalComponent && (
        <Dialog.Root open onOpenChange={(open) => { if (!open && !isSettingsModalClosing) setSettingsModalTarget(null) }}>
          <Dialog.Portal>
            <Dialog.Backdrop className={`plugin-settings-modal-backdrop fixed inset-0 bg-black/40 z-[1210]${isSettingsModalClosing ? ' is-closing' : ''}`} />
            <Dialog.Popup
              aria-labelledby={settingsModalTitleId}
              initialFocus={() => document.querySelector<HTMLElement>('[data-settings-modal-close]')}
              className={`plugin-settings-modal-panel fixed left-1/2 top-1/2 z-[1211] -translate-x-1/2 -translate-y-1/2 flex max-h-[calc(100%-48px)] w-[min(520px,calc(100%-48px))] flex-col overflow-hidden rounded-lg${isSettingsModalClosing ? ' is-closing' : ''}`}
              style={{
                background: 'var(--panel, var(--bg-surface, #ffffff))',
                border: 'var(--hairline) solid var(--color-border-secondary)',
                boxShadow: 'var(--shadow-panel, 0 20px 44px rgba(0, 0, 0, 0.22))',
                outline: 'none',
              }}
            >
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}
              >
                <h3 id={settingsModalTitleId} className="m-0 text-[14px] font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                  {settingsModalTitle}
                </h3>
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md"
                  style={{ color: 'var(--color-text-tertiary)', background: 'transparent' }}
                  onClick={() => setSettingsModalTarget(null)}
                  title={t(locale, 'scripts.settingsClose')}
                  data-settings-modal-close
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <SettingsErrorBoundary fallback={errorFallback}>
                  <SettingsModalComponent
                    {...settingsBodyProps}
                    modalId={activeSettingsModalTarget.modal.id}
                    context={activeSettingsModalTarget.field.context}
                    close={() => setSettingsModalTarget(null)}
                  />
                </SettingsErrorBoundary>
              </div>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  )
}
