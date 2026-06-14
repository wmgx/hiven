/**
 * Clipboard History Plugin — Settings Body Component
 *
 * Renders the settings UI for clipboard history configuration.
 * Uses standard React JSX like other plugin settings bodies.
 */

import { useState, type ReactNode } from 'react'
import type { PluginPermission, PluginSettingsBodyProps } from '@hiven/plugin'
import type { ClipboardHistorySettings } from './model'
import { createClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'

const REQUIRED_PERMISSIONS: PluginPermission[] = [
  'clipboard.read',
  'clipboard.write',
  'clipboard.watch',
  'clipboard.image',
  'clipboard.files',
  'storage.private',
  'storage.blob',
  'globalShortcut.register',
  'accessibility.paste',
]

export function ClipboardHistorySettingsBody({
  value,
  updateValue,
  t,
  host,
}: PluginSettingsBodyProps<ClipboardHistorySettings>) {
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const missingPermissions = REQUIRED_PERMISSIONS.filter((permission) => !host.permissions[permission]?.granted)
  const grantedPermissions = REQUIRED_PERMISSIONS.filter((permission) => host.permissions[permission]?.granted)

  const clearAll = async () => {
    setClearing(true)
    try {
      const repository = createClipboardHistoryRepository(host.storage)
      await repository.clearAll()
      host.showMessage(t('message.cleared'), 'success')
      setShowClearConfirm(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      host.showMessage(message, 'error')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Master toggle */}
      <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--color-text-primary)' }}>
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => updateValue({ enabled: e.target.checked })}
        />
        <span className="font-medium">{t('settings.enabled')}</span>
      </label>

      {/* Record type toggles */}
      <div className="flex flex-col gap-2 pl-4" style={{ opacity: value.enabled ? 1 : 0.5 }}>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
          <input
            type="checkbox"
            checked={value.recordText}
            onChange={(e) => updateValue({ recordText: e.target.checked })}
            disabled={!value.enabled}
          />
          {t('settings.recordText')}
        </label>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
          <input
            type="checkbox"
            checked={value.recordImages}
            onChange={(e) => updateValue({ recordImages: e.target.checked })}
            disabled={!value.enabled}
          />
          {t('settings.recordImages')}
        </label>
        <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}>
          <input
            type="checkbox"
            checked={value.recordFiles}
            onChange={(e) => updateValue({ recordFiles: e.target.checked })}
            disabled={!value.enabled}
          />
          {t('settings.recordFiles')}
        </label>
      </div>

      {/* Limits section */}
      <div className="flex flex-col gap-2 mt-2" style={{ opacity: value.enabled ? 1 : 0.5 }}>
        <SettingsField label={t('settings.maxItems')}>
          <input
            className="settings-input"
            type="number"
            min={10}
            max={10000}
            value={value.maxItems}
            onChange={(e) => updateValue({ maxItems: Math.max(10, parseInt(e.target.value) || 500) })}
            disabled={!value.enabled}
          />
        </SettingsField>

        <SettingsField label={t('settings.retentionDays')}>
          <input
            className="settings-input"
            type="number"
            min={1}
            max={365}
            value={value.retentionDays}
            onChange={(e) => updateValue({ retentionDays: Math.max(1, parseInt(e.target.value) || 30) })}
            disabled={!value.enabled}
          />
        </SettingsField>

        <SettingsField label={t('settings.maxTextBytes')}>
          <input
            className="settings-input"
            type="number"
            min={0.01}
            step={0.25}
            value={bytesToMegabytes(value.maxTextBytes)}
            onChange={(e) => updateValue({ maxTextBytes: megabytesToBytes(parseFloat(e.target.value), 0.25) })}
            disabled={!value.enabled}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            MB
          </span>
        </SettingsField>

        <SettingsField label={t('settings.maxImageBytes')}>
          <input
            className="settings-input"
            type="number"
            min={1}
            step={1}
            value={bytesToMegabytes(value.maxImageBytes)}
            onChange={(e) => updateValue({ maxImageBytes: megabytesToBytes(parseFloat(e.target.value), 10) })}
            disabled={!value.enabled}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            MB
          </span>
        </SettingsField>

        <SettingsField label={t('settings.maxTotalCacheBytes')}>
          <input
            className="settings-input"
            type="number"
            min={1}
            step={10}
            value={bytesToMegabytes(value.maxTotalCacheBytes)}
            onChange={(e) => updateValue({ maxTotalCacheBytes: megabytesToBytes(parseFloat(e.target.value), 500) })}
            disabled={!value.enabled}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            MB
          </span>
        </SettingsField>
      </div>

      {/* Clear all */}
      <div className="mt-3 pt-3" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        {!showClearConfirm ? (
          <button
            className="text-[12px] px-3 py-1.5 rounded"
            style={{ background: 'var(--color-error-light, rgba(255,0,0,0.08))', color: 'var(--color-error)', border: 'none', cursor: 'pointer' }}
            onClick={() => setShowClearConfirm(true)}
          >
            {t('settings.clearAll')}
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] m-0" style={{ color: 'var(--color-error)' }}>
              {t('settings.clearAll.confirm')}
            </p>
            <div className="flex gap-2">
              <button
                className="text-[12px] px-3 py-1.5 rounded"
                style={{ background: 'var(--color-error)', color: '#fff', border: 'none', cursor: 'pointer' }}
                onClick={() => { void clearAll() }}
                disabled={clearing}
              >
                {clearing ? t('settings.clearAll.clearing') : t('settings.clearAll')}
              </button>
              <button
                className="text-[12px] px-3 py-1.5 rounded"
                style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: 'none', cursor: 'pointer' }}
                onClick={() => setShowClearConfirm(false)}
                disabled={clearing}
              >
                {t('settings.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div
        className={`clipboard-history-permissions mt-3 pt-3${missingPermissions.length === 0 ? ' is-all-granted' : ' has-missing'}`}
        style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}
        tabIndex={0}
      >
        <div className="clipboard-history-permissions-header">
          <span>{t('settings.permissions')}</span>
          <strong>
            {missingPermissions.length === 0
              ? t('settings.permissionsAllGranted')
              : t('settings.permissionsMissing', { count: missingPermissions.length })}
          </strong>
        </div>
        {missingPermissions.length > 0 && (
          <div className="clipboard-history-permission-list">
            {missingPermissions.map((permission) => (
              <PermissionRow
                key={permission}
                permission={permission}
                granted={false}
                t={t}
              />
            ))}
          </div>
        )}
        <div className="clipboard-history-permission-popover" role="tooltip">
          <div className="clipboard-history-permission-popover-title">{t('settings.permissionsAll')}</div>
          <div className="clipboard-history-permission-list">
            {[...missingPermissions, ...grantedPermissions].map((permission) => (
              <PermissionRow
                key={permission}
                permission={permission}
                granted={host.permissions[permission]?.granted === true}
                t={t}
              />
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-4 m-0" style={{ color: 'var(--color-text-tertiary)' }}>
          {t('settings.privacyNotice')}
        </p>
      </div>
    </div>
  )
}

function PermissionRow({
  permission,
  granted,
  t,
}: {
  permission: PluginPermission
  granted: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <div className="clipboard-history-permission-row">
      <span>{t(`permission.${permission}`)}</span>
      <strong className={granted ? 'is-granted' : 'is-required'}>
        {granted ? t('settings.permissionGranted') : t('settings.permissionRequired')}
      </strong>
    </div>
  )
}

function SettingsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        {children}
      </div>
    </div>
  )
}

function bytesToMegabytes(bytes: number): number {
  const value = bytes / (1024 * 1024)
  return Number.isInteger(value) ? value : Number(value.toFixed(2))
}

function megabytesToBytes(value: number, fallbackMb: number): number {
  const safeValue = Number.isFinite(value) && value > 0 ? value : fallbackMb
  return Math.max(1, Math.round(safeValue * 1024 * 1024))
}
