/**
 * Clipboard History Plugin — Settings Body Component
 *
 * Renders the settings UI for clipboard history configuration.
 * Uses standard React JSX like other plugin settings bodies.
 */

import { useState } from 'react'
import type { PluginSettingsBodyProps } from '@hiven/plugin'
import type { ClipboardHistorySettings } from './model'

export function ClipboardHistorySettingsBody({
  value,
  updateValue,
  t,
  locale,
}: PluginSettingsBodyProps<ClipboardHistorySettings>) {
  const [showClearConfirm, setShowClearConfirm] = useState(false)

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
            min={1024}
            value={value.maxTextBytes}
            onChange={(e) => updateValue({ maxTextBytes: Math.max(1024, parseInt(e.target.value) || 256 * 1024) })}
            disabled={!value.enabled}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {formatBytes(value.maxTextBytes)}
          </span>
        </SettingsField>

        <SettingsField label={t('settings.maxImageBytes')}>
          <input
            className="settings-input"
            type="number"
            min={1024}
            value={value.maxImageBytes}
            onChange={(e) => updateValue({ maxImageBytes: Math.max(1024, parseInt(e.target.value) || 10 * 1024 * 1024) })}
            disabled={!value.enabled}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {formatBytes(value.maxImageBytes)}
          </span>
        </SettingsField>

        <SettingsField label={t('settings.maxTotalCacheBytes')}>
          <input
            className="settings-input"
            type="number"
            min={1024 * 1024}
            value={value.maxTotalCacheBytes}
            onChange={(e) => updateValue({ maxTotalCacheBytes: Math.max(1024 * 1024, parseInt(e.target.value) || 500 * 1024 * 1024) })}
            disabled={!value.enabled}
          />
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {formatBytes(value.maxTotalCacheBytes)}
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
                onClick={() => {
                  // Clear handled by surface; just close confirm
                  setShowClearConfirm(false)
                }}
              >
                {t('settings.clearAll')}
              </button>
              <button
                className="text-[12px] px-3 py-1.5 rounded"
                style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: 'none', cursor: 'pointer' }}
                onClick={() => setShowClearConfirm(false)}
              >
                {locale === 'zh' ? '取消' : 'Cancel'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsField({ label, children }: { label: string; children: React.ReactNode }) {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
