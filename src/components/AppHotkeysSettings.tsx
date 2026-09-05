/**
 * Settings UI for per-app global hotkeys (focus / hide toggle).
 */
import { useCallback, useEffect, useState } from 'react'
import { AppWindow, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '../store'
import { t } from '../i18n'
import { ShortcutRecorder } from './ShortcutRecorder'
import type { AppHotkeyBinding } from '../workspace/appHotkeys'
import type { DiscoveredApp } from '../workspace/launcher/types'
import { Combobox } from '../plugin-ui'

type ListedApp = { appId: string; name: string }

export function AppHotkeysSettings() {
  const locale = useAppStore((s) => s.locale)
  const bindings = useAppStore((s) => s.settings.appHotkeys ?? [])
  const setAppHotkey = useAppStore((s) => s.setAppHotkey)
  const removeAppHotkey = useAppStore((s) => s.removeAppHotkey)

  const [apps, setApps] = useState<ListedApp[]>([])
  const [selectedAppId, setSelectedAppId] = useState('')
  const [draftAccel, setDraftAccel] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
          if (!cancelled) setApps([])
          return
        }
        const { invoke } = await import('@tauri-apps/api/core')
        const discovered = await invoke<DiscoveredApp[]>('discover_installed_apps')
        if (cancelled) return
        setApps(
          (discovered ?? [])
            .map((a) => ({ appId: a.appId, name: a.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
        setLoadError('')
      } catch (error) {
        if (!cancelled) {
          setLoadError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedName = apps.find((a) => a.appId === selectedAppId)?.name ?? selectedAppId

  const handleAdd = useCallback(() => {
    if (!selectedAppId || !draftAccel.trim()) return
    const binding: AppHotkeyBinding = {
      appId: selectedAppId,
      name: selectedName || selectedAppId,
      accelerator: draftAccel.trim(),
      enabled: true,
    }
    setAppHotkey(binding)
    setDraftAccel('')
  }, [draftAccel, selectedAppId, selectedName, setAppHotkey])

  return (
    <div className="app-hotkeys-settings">
      {bindings.length === 0 ? (
        <p className="app-hotkeys-empty">{t(locale, 'settings.appHotkeysEmpty')}</p>
      ) : (
        <ul className="app-hotkeys-list">
          {bindings.map((b) => (
            <li key={b.appId} className="app-hotkeys-row">
              <AppWindow size={14} strokeWidth={2} aria-hidden />
              <span className="app-hotkeys-name">{b.name}</span>
              <kbd className="app-hotkeys-acc">{b.accelerator}</kbd>
              <button
                type="button"
                className="app-hotkeys-remove"
                onClick={() => removeAppHotkey(b.appId)}
                aria-label={t(locale, 'settings.appHotkeysRemove')}
              >
                <Trash2 size={14} strokeWidth={2} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="app-hotkeys-add">
        <label className="app-hotkeys-field">
          <span>{t(locale, 'settings.appHotkeysPickApp')}</span>
          <Combobox
            className="app-hotkeys-app-select"
            value={selectedAppId}
            options={apps.map((app) => ({ value: app.appId, label: app.name }))}
            placeholder={t(locale, 'settings.appHotkeysFilter')}
            emptyLabel={t(locale, 'settings.appHotkeysSelect')}
            aria-label={t(locale, 'settings.appHotkeysPickApp')}
            onChange={setSelectedAppId}
          />
        </label>

        <div className="app-hotkeys-field">
          <span>{t(locale, 'settings.appHotkeysShortcut')}</span>
          <ShortcutRecorder
            value={
              draftAccel
                ? { kind: 'accelerator', accelerator: draftAccel }
                : { kind: 'disabled' }
            }
            allowDoubleModifier={false}
            emptyLabel={t(locale, 'settings.hotkeyRecord')}
            onRecord={(value) => {
              if (value.kind === 'accelerator') setDraftAccel(value.accelerator)
            }}
            onClear={() => setDraftAccel('')}
          />
        </div>

        <button
          type="button"
          className="app-hotkeys-add-btn"
          disabled={!selectedAppId || !draftAccel.trim()}
          onClick={handleAdd}
        >
          <Plus size={14} strokeWidth={2} />
          {t(locale, 'settings.appHotkeysAdd')}
        </button>
      </div>

      {loadError ? <p className="app-hotkeys-error">{loadError}</p> : null}
    </div>
  )
}
