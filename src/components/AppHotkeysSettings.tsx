/**
 * Settings UI for per-app global hotkeys and explicit search aliases.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AppWindow, Plus, Trash2 } from 'lucide-react'
import { useAppStore } from '../store'
import { t } from '../i18n'
import { ShortcutRecorder } from './ShortcutRecorder'
import type { AppHotkeyBinding } from '../workspace/appHotkeys'
import type { DiscoveredApp } from '../workspace/launcher/types'
import { Combobox } from '../plugin-ui'
import { saveAppHotkey } from '../hotkeys/appHotkeys'
import { showToast } from '../workspace/toast'
import { getAppSearchAliases, parseAppSearchAliasInput } from '../workspace/appLauncher/appSearchAliases'
import { searchableFieldsMatch } from '../workspace/searchRanking'

type AliasDraft = { text: string; savedText: string; edited: boolean }

function AppSearchAliasEditor({ app }: { app: DiscoveredApp }) {
  const locale = useAppStore((s) => s.locale)
  const savedAliases = useAppStore((s) => s.settings.appSearchAliases[app.appId])
  const setAppSearchAliases = useAppStore((s) => s.setAppSearchAliases)
  const savedText = (savedAliases ?? []).join('\n')
  const [draft, setDraft] = useState<AliasDraft>({ text: savedText, savedText, edited: false })
  const [notice, setNotice] = useState('')
  const [saveError, setSaveError] = useState(false)
  const fieldId = useId()
  const parsed = parseAppSearchAliasInput(draft.text)
  const dirty = draft.edited
  const changedElsewhere = dirty && savedText !== draft.savedText
  const validationError = parsed.ok ? '' : t(locale, {
    'too-many': 'settings.appSearchAliasesTooMany',
    'too-long': 'settings.appSearchAliasesTooLong',
    invalid: 'settings.appSearchAliasesInvalid',
  }[parsed.reason])

  useEffect(() => {
    // A storage update may refresh a clean editor, but never replace its draft.
    setDraft((current) => !current.edited
      ? { text: savedText, savedText, edited: false }
      : current)
  }, [savedText])

  const persist = (aliases: string[]) => {
    try {
      setAppSearchAliases(app.appId, aliases)
      setSaveError(false)
      return true
    } catch {
      setSaveError(true)
      setNotice('')
      return false
    }
  }

  const save = () => {
    if (!parsed.ok || !persist(parsed.aliases)) return
    const text = parsed.aliases.join('\n')
    setDraft({ text, savedText: text, edited: false })
    setNotice('settings.appSearchAliasesSaved')
  }

  const clear = () => {
    setDraft({ ...draft, text: '', edited: true })
    setSaveError(false)
    setNotice('')
  }

  return (
    <>
      <label className="app-hotkeys-field" htmlFor={fieldId}>
        <span>{t(locale, 'settings.appSearchAliasesLabel', { name: app.name })}</span>
        <textarea
          id={fieldId}
          className="hiven-ui-input hiven-ui-textarea"
          rows={4}
          value={draft.text}
          placeholder={t(locale, 'settings.appSearchAliasesPlaceholder')}
          aria-describedby={`${fieldId}-hint${validationError ? ` ${fieldId}-error` : ''}`}
          aria-invalid={Boolean(validationError)}
          onChange={(event) => {
            setDraft({ ...draft, text: event.currentTarget.value, edited: true })
            setNotice('')
            setSaveError(false)
          }}
        />
      </label>
      <p id={`${fieldId}-hint`} className="app-hotkeys-empty">{t(locale, 'settings.appSearchAliasesHint')}</p>
      {validationError ? <p id={`${fieldId}-error`} className="app-hotkeys-error" role="alert">{validationError}</p> : null}
      {changedElsewhere ? <p className="app-hotkeys-empty" role="status">{t(locale, 'settings.appSearchAliasesChanged')}</p> : null}
      <div>
        <button type="button" className="app-hotkeys-add-btn" disabled={!dirty || !parsed.ok} onClick={save}>
          {t(locale, 'settings.appSearchAliasesSave')}
        </button>{' '}
        <button type="button" className="app-hotkeys-add-btn" disabled={!draft.text} onClick={clear}>
          {t(locale, 'settings.appSearchAliasesClear')}
        </button>{' '}
        <button type="button" className="app-hotkeys-add-btn" disabled={!dirty} onClick={() => {
          setDraft({ text: savedText, savedText, edited: false })
          setSaveError(false)
          setNotice('')
        }}>
          {t(locale, 'settings.appSearchAliasesDiscard')}
        </button>
      </div>
      {saveError ? <p className="app-hotkeys-error" role="alert">{t(locale, 'settings.appSearchAliasesSaveFailed')}</p> : null}
      {notice ? <p className="app-hotkeys-empty" role="status">{t(locale, notice)}</p> : null}
    </>
  )
}

export function AppHotkeysSettings() {
  const locale = useAppStore((s) => s.locale)
  const bindings = useAppStore((s) => s.settings.appHotkeys ?? [])
  const aliasMap = useAppStore((s) => s.settings.appSearchAliases)
  const removeAppHotkey = useAppStore((s) => s.removeAppHotkey)

  const [apps, setApps] = useState<DiscoveredApp[]>([])
  const [selectedAppId, setSelectedAppId] = useState('')
  const [aliasAppId, setAliasAppId] = useState('')
  const [draftAccel, setDraftAccel] = useState('')
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const editVersion = useRef(0)
  const invalidateSave = () => {
    editVersion.current += 1
    setSaving(false)
  }

  useEffect(() => () => { editVersion.current += 1 }, [])

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
          [...(discovered ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
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

  const appOptions = useMemo(() => {
    const nameCounts = new Map<string, number>()
    for (const app of apps) nameCounts.set(app.name, (nameCounts.get(app.name) ?? 0) + 1)
    return apps.map((app) => ({
      value: app.appId,
      label: (nameCounts.get(app.name) ?? 0) > 1 && app.displayPath
        ? `${app.name} (${app.displayPath})`
        : app.name,
    }))
  }, [apps])
  const appsById = useMemo(() => new Map(apps.map((app) => [app.appId, app])), [apps])
  const filterApp = useCallback((option: { value: string }, query: string) => {
    const app = appsById.get(option.value)
    return Boolean(app && searchableFieldsMatch({
      id: '',
      title: app.name,
      titleI18n: app.nameI18n,
      aliases: getAppSearchAliases(app, aliasMap),
    }, query, locale))
  }, [appsById, aliasMap, locale])
  const selectedName = appsById.get(selectedAppId)?.name ?? ''
  const aliasApp = appsById.get(aliasAppId)

  const handleAdd = useCallback(async () => {
    if (!selectedAppId || !selectedName || !draftAccel.trim()) return
    const binding: AppHotkeyBinding = {
      appId: selectedAppId,
      name: selectedName,
      accelerator: draftAccel.trim(),
      enabled: true,
    }
    const version = ++editVersion.current
    const current = () => editVersion.current === version
    setSaving(true)
    let result: Awaited<ReturnType<typeof saveAppHotkey>> = 'failed'
    try {
      result = await saveAppHotkey(binding, current)
    } catch (error) {
      console.warn('[hiven] app hotkey save failed', error)
    } finally {
      if (current()) setSaving(false)
    }
    if (!current()) return
    if (result === 'saved') setDraftAccel('')
    if (result === 'conflict' || result === 'failed') {
      showToast(t(locale, result === 'conflict'
        ? 'settings.appHotkeysConflict'
        : 'settings.appHotkeysRegistrationFailed', {
        name: binding.name, shortcut: binding.accelerator,
      }), 'error')
    }
  }, [draftAccel, selectedAppId, selectedName, locale])

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
                onClick={() => { invalidateSave(); removeAppHotkey(b.appId) }}
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
            options={appOptions}
            filter={filterApp}
            placeholder={t(locale, 'settings.appHotkeysFilter')}
            emptyLabel={t(locale, 'settings.appHotkeysSelect')}
            aria-label={t(locale, 'settings.appHotkeysPickApp')}
            onChange={(value) => { invalidateSave(); setSelectedAppId(value) }}
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
              if (value.kind === 'accelerator') { invalidateSave(); setDraftAccel(value.accelerator) }
            }}
            onClear={() => { invalidateSave(); setDraftAccel('') }}
          />
        </div>

        <button
          type="button"
          className="app-hotkeys-add-btn"
          disabled={saving || !selectedAppId || !draftAccel.trim()}
          onClick={handleAdd}
        >
          <Plus size={14} strokeWidth={2} />
          {t(locale, 'settings.appHotkeysAdd')}
        </button>
      </div>

      <div className="app-hotkeys-add">
        <span className="app-hotkeys-name">{t(locale, 'settings.appSearchAliases')}</span>
        <p className="app-hotkeys-empty">{t(locale, 'settings.appSearchAliasesInfo')}</p>
        <label className="app-hotkeys-field">
          <span>{t(locale, 'settings.appHotkeysPickApp')}</span>
          <Combobox
            className="app-hotkeys-app-select"
            value={aliasAppId}
            options={appOptions}
            filter={filterApp}
            placeholder={t(locale, 'settings.appHotkeysFilter')}
            emptyLabel={t(locale, 'settings.appHotkeysSelect')}
            aria-label={t(locale, 'settings.appSearchAliasesPickApp')}
            onChange={setAliasAppId}
          />
        </label>
        {aliasApp ? <AppSearchAliasEditor key={aliasApp.appId} app={aliasApp} /> : null}
      </div>

      {loadError ? <p className="app-hotkeys-error">{loadError}</p> : null}
    </div>
  )
}
