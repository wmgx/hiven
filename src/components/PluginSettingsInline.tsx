import { Component, useCallback, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Locale } from '../i18n'
import { t } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { useAppStore } from '../store'
import { openExternalUrl } from '../workspace/effectRunner'
import { getPluginPermissionSnapshot, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { pluginRegistry } from '../workspace/pluginRegistry'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import {
  usePluginSettingsStore,
  type PluginSettingsSource,
} from '../workspace/pluginSettingsStore'
import type { PluginSettingsContribution } from '../workspace/pluginTypes'
import { PluginSettingsSchemaRenderer } from './PluginSettingsSchemaRenderer'
import { resolvePluginSettingsModal, type ResolvedPluginSettingsModal } from './pluginSettingsModalResolution'

type PluginSettingsInlineProps = {
  pluginId: string
  source: PluginSettingsSource
  locale: Locale
}

type ErrorBoundaryProps = {
  fallback: ReactNode
  children: ReactNode
}

type ErrorBoundaryState = {
  hasError: boolean
}

class InlineSettingsErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[hiven] Inline plugin settings component crashed:', error, info)
  }

  render() {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}

export function PluginSettingsInline({ pluginId, source, locale }: PluginSettingsInlineProps) {
  const contribution = pluginRegistry.getPluginDefinition(pluginId, source)?.settings as PluginSettingsContribution<unknown> | undefined
  if (!contribution?.schema) return null

  return (
    <PluginSettingsInlineBody
      pluginId={pluginId}
      source={source}
      locale={locale}
      contribution={contribution}
    />
  )
}

function PluginSettingsInlineBody({
  pluginId,
  source,
  locale,
  contribution,
}: PluginSettingsInlineProps & {
  contribution: PluginSettingsContribution<unknown>
}) {
  const setPluginSettings = usePluginSettingsStore((s) => s.setPluginSettings)
  const storedRecord = usePluginSettingsStore((s) => s.pluginSettings[source][pluginId])
  const permissionVersion = usePluginPermissionStore((s) => s.version)
  const [settingsModalTarget, setSettingsModalTarget] = useState<ResolvedPluginSettingsModal<unknown> | null>(null)
  void permissionVersion

  const currentVersion = contribution.version ?? 1
  const value = useMemo(() => {
    if (!storedRecord) return contribution.defaultValue
    const storedVersion = storedRecord.version ?? 1
    if (storedVersion === currentVersion) return storedRecord.value
    if (storedVersion > currentVersion) return contribution.defaultValue
    if (contribution.migrate) {
      try {
        const migrated = contribution.migrate(storedRecord.value, storedVersion)
        return migrated == null ? contribution.defaultValue : migrated
      } catch {
        return contribution.defaultValue
      }
    }
    return storedRecord.value
  }, [storedRecord, currentVersion, contribution])

  const setValue = useCallback(
    (next: unknown) => {
      setPluginSettings(source, pluginId, next, currentVersion)
    },
    [setPluginSettings, source, pluginId, currentVersion],
  )

  const updateValue = useCallback(
    (patch: Partial<unknown>) => {
      const current = usePluginSettingsStore.getState().getPluginSettings(source, pluginId)
      const currentValue = current?.value ?? contribution.defaultValue
      setValue({ ...(currentValue as Record<string, unknown>), ...(patch as Record<string, unknown>) })
    },
    [setValue, source, pluginId, contribution.defaultValue],
  )

  const resetValue = useCallback(() => {
    setValue(contribution.defaultValue)
  }, [setValue, contribution.defaultValue])

  const pluginT = useMemo(() => makePluginT(pluginId, locale), [pluginId, locale])
  const requestedPermissions = useMemo(() => pluginRegistry.getPluginPermissions(pluginId, source), [pluginId, source])
  const permissions = getPluginPermissionSnapshot(source, pluginId, requestedPermissions)
  const settingsHost = useMemo(() => ({
    permissions,
    storage: createPluginPrivateStorage(source, pluginId, permissions),
    showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error') {
      useAppStore.getState().setLastCommandStatus({
        title: message,
        status: level === 'error' ? 'error' : 'success',
        message,
        updatedAt: Date.now(),
      })
    },
  }), [source, pluginId, permissions])

  const SettingsModalComponent = settingsModalTarget?.modal.component
  const settingsModalTitle = settingsModalTarget
    ? settingsModalTarget.modal.titleI18n?.[locale] ?? settingsModalTarget.modal.title
    : ''
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
    openExternal: openExternalUrl,
    host: settingsHost,
  }

  return (
    <div className="plugin-settings-inline-body">
      <PluginSettingsSchemaRenderer
        schema={contribution.schema}
        locale={locale}
        value={value}
        updateValue={updateValue}
        onOpenModal={(field) => setSettingsModalTarget(resolvePluginSettingsModal(contribution, field))}
      />
      {settingsModalTarget && SettingsModalComponent && (
        <div
          className="plugin-settings-inline-modal"
          onClick={() => setSettingsModalTarget(null)}
        >
          <div className="plugin-settings-inline-modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="plugin-settings-inline-modal-header">
              <h3>{settingsModalTitle}</h3>
              <button
                className="editor-topbar-button"
                onClick={() => setSettingsModalTarget(null)}
                title={t(locale, 'scripts.settingsClose')}
              >
                <X size={14} />
              </button>
            </div>
            <div className="plugin-settings-inline-modal-body">
              <InlineSettingsErrorBoundary fallback={errorFallback}>
                <SettingsModalComponent
                  {...settingsBodyProps}
                  modalId={settingsModalTarget.modal.id}
                  close={() => setSettingsModalTarget(null)}
                />
              </InlineSettingsErrorBoundary>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
