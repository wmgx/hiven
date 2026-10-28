/**
 * hiven Plugin System - Plugin Settings Dialog
 * A global singleton dialog that renders a plugin's settings body component.
 * The host provides the dialog shell (title, close, scroll, error boundary).
 * The plugin provides the body content via its settings.component.
 */

import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode, type RefObject } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { SurfaceBreadcrumbs } from '../ui/SurfaceHeaderActions'
import { SurfaceShell } from './pluginSurface/SurfaceShell'
import { t } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { useAppStore } from '../store'
import { showToast } from '../workspace/toast'
import { resolvePluginProductMetadata } from '../workspace/pluginProductCatalog'
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
  const backRef = useRef<(() => boolean) | null>(null)

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
    <Dialog.Root open onOpenChange={(open) => { if (!open && !isClosing && !backRef.current?.()) closeSettingsDialog() }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={`plugin-settings-dialog-backdrop fixed inset-0 z-[1200]${fillsPluginWindow ? '' : ' bg-black/40'}${isClosing ? ' is-closing' : ''}`} />
        <Dialog.Popup
          aria-labelledby={titleId}
          initialFocus={activeTarget.target ? false : () => document.querySelector<HTMLElement>('.surface-shell-tag')}
          className={`fixed left-1/2 top-1/2 z-[1201] -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden plugin-settings-dialog-panel${isClosing ? ' is-closing' : ''}`}
          style={{
            width: fillsPluginWindow ? '100vw' : 'min(780px, calc(100vw - 40px))',
            height: fillsPluginWindow ? '100vh' : 'min(680px, calc(100vh - 48px))',
            maxHeight: fillsPluginWindow ? '100vh' : 'min(680px, calc(100vh - 48px))',
            background: 'var(--panel, var(--bg-surface, #ffffff))',
            border: '1px solid var(--border, var(--color-border-secondary))',
            borderRadius: fillsPluginWindow ? 'var(--plugin-surface-window-radius, 12px)' : '14px',
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
            backRef={backRef}
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
  backRef,
}: {
  pluginId: string
  source: PluginSettingsSource
  target?: PluginSettingsFieldTarget
  locale: 'zh' | 'en'
  onClose: () => void
  titleId?: string
  backRef?: RefObject<(() => boolean) | null>
}) {
  // Resolve the plugin's settings contribution from the registry
  const registryVersion = usePluginRegistryVersion()
  const contribution = useMemo(() => {
    const def = pluginRegistry.getPluginDefinition(pluginId, source === 'dev' ? 'dev' : 'production')
    const metadata = resolvePluginProductMetadata(pluginId)
    return def?.settings as PluginSettingsContribution<unknown> | undefined
      ?? (pluginRegistry.getPluginPermissions(pluginId, source).includes('ai.use')
        ? { title: metadata.provider, titleI18n: { zh: metadata.providerZh }, defaultValue: {}, schema: { sections: [] } } : undefined)
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
      backRef={backRef}
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
  backRef,
}: {
  pluginId: string
  source: PluginSettingsSource
  target?: PluginSettingsFieldTarget
  contribution: PluginSettingsContribution<unknown>
  locale: 'zh' | 'en'
  onClose: () => void
  titleId?: string
  backRef?: RefObject<(() => boolean) | null>
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
  const [modalStack, setModalStack] = useState<ResolvedPluginSettingsModal<unknown>[]>([])
  const [listTarget, setListTarget] = useState<{ key: string; label: string } | null>(null)
  const goBack = useCallback(() => {
    if (modalStack.length) { setModalStack(stack => stack.slice(0, -1)); return true }
    if (listTarget) { setListTarget(null); return true }
    return false
  }, [modalStack.length, listTarget])
  useLayoutEffect(() => { if (backRef) backRef.current = goBack; return () => { if (backRef) backRef.current = null } }, [backRef, goBack])
  const openModal = (field: Parameters<typeof resolvePluginSettingsModal>[1]) => {
    const next = resolvePluginSettingsModal(contribution, field)
    if (next) setModalStack(stack => [...stack, next])
  }
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

  const resetValue = useCallback(() => {
    setPluginSettings(source, pluginId, contribution.defaultValue, currentVersion)
    notifySettingsChange(contribution.defaultValue)
  }, [setPluginSettings, source, pluginId, contribution.defaultValue, currentVersion, notifySettingsChange])

  const openExternal = useCallback(async (url: string) => {
    await openExternalUrl(url)
  }, [])

  const SettingsComponent = contribution.component
  const activeSettingsModalTarget = modalStack.at(-1)
  const SettingsModalComponent = activeSettingsModalTarget?.modal.component
  const displayedSchema = listTarget && contribution.schema ? { sections: contribution.schema.sections.map(section => ({ ...section, title: undefined, titleI18n: undefined, description: undefined, descriptionI18n: undefined, fields: section.fields.filter(field => 'key' in field && field.key === listTarget.key) })) } : contribution.schema

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
    <SurfaceShell title={title} titleId={titleId} icon="Settings" onClose={onClose} onBack={listTarget || modalStack.length ? () => { setListTarget(null); setModalStack([]) } : undefined}>
      <SurfaceBreadcrumbs items={[
        ...(listTarget ? [{ label: listTarget.label, onClick: () => setModalStack([]) }] : []),
        ...modalStack.map((entry, index) => ({ label: entry.modal.titleI18n?.[locale] ?? entry.modal.title, onClick: () => setModalStack(stack => stack.slice(0, index + 1)) })),
      ]} />
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

      {/* Body */}
      <div ref={bodyRef} data-settings-page={activeSettingsModalTarget?.modal.id ?? listTarget?.key ?? 'root'} className="flex-1 overflow-y-auto px-5 py-4" data-launcher-scrollable data-settings-navigation-root={target ? '' : undefined} tabIndex={-1}>
        <SettingsErrorBoundary fallback={errorFallback}>
          {/* Prefer custom body when present (install guides, connection UI).
              Schema-only plugins keep the generated form renderer. */}
          {activeSettingsModalTarget && SettingsModalComponent ? <SettingsModalComponent {...settingsBodyProps}
            modalId={activeSettingsModalTarget.modal.id} context={activeSettingsModalTarget.field.context}
            close={goBack} openModal={(id, context) => openModal({ kind: 'modal', id, label: id, context })} /> : SettingsComponent ? (
            <SettingsComponent {...settingsBodyProps} />
          ) : displayedSchema ? (
            <PluginSettingsSchemaRenderer
              schema={displayedSchema}
              locale={locale}
              translateText={pluginT}
              value={value}
              updateValue={updateValue}
              onOpenModal={openModal}
              onOpenList={listTarget ? undefined : (key, label) => setListTarget({ key, label })}
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

    </SurfaceShell>
  )
}
