import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../store'
import { t } from '../i18n'
import type { DiscoveredApp } from '../workspace/launcher/types'
import { describeFavoriteApp, type FavoriteAppScan } from '../workspace/launcher/favoriteAvailability'

/** A removal-only view: these rows never participate in launcher selection. */
export function PinnedEntriesSettings() {
  const locale = useAppStore((s) => s.locale)
  const keys = useAppStore((s) => s.launcherFavoriteKeys)
  const labels = useAppStore((s) => s.launcherFavoriteLabels)
  const remove = useAppStore((s) => s.toggleLauncherFavorite)
  const [expanded, setExpanded] = useState(false)
  const [revision, setRevision] = useState(0)
  const [scan, setScan] = useState<FavoriteAppScan>({ status: 'loading', apps: [] })
  const [error, setError] = useState(false)
  const refreshButton = useRef<HTMLButtonElement>(null)
  const scanGeneration = useRef(0)

  useEffect(() => {
    if (!expanded) return
    const generation = ++scanGeneration.current
    const current = () => generation === scanGeneration.current
    setScan({ status: 'loading', apps: [] })
    void (async () => {
      try {
        if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
          if (current()) setScan({ status: 'unknown', apps: [] })
          return
        }
        const { invoke } = await import('@tauri-apps/api/core')
        const apps = await invoke<DiscoveredApp[]>('discover_installed_apps')
        if (current()) setScan({ status: 'ready', apps })
      } catch {
        if (current()) setScan({ status: 'error', apps: [] })
      }
    })()
    return () => { if (current()) scanGeneration.current += 1 }
  }, [expanded, revision])

  return (
    <details open={expanded} onToggle={(event) => {
      const open = event.currentTarget.open
      if (open === expanded) return
      scanGeneration.current += 1
      setScan({ status: 'loading', apps: [] })
      setExpanded(open)
    }}
      onKeyDown={(event) => {
        // Native button activation remains intact; no launcher Enter/number routing.
        if (event.key === 'Enter' || /^[0-9]$/.test(event.key)) event.stopPropagation()
      }}>
      <summary>{t(locale, 'settings.pinnedEntriesManage', { count: keys.length })}</summary>
      {expanded && <div className="app-hotkeys-settings">
        <p className="app-hotkeys-empty">{t(locale, 'settings.pinnedEntriesHint')}</p>
        <button ref={refreshButton} type="button" className="app-hotkeys-add-btn"
          onClick={() => { scanGeneration.current += 1; setScan({ status: 'loading', apps: [] }); setRevision((value) => value + 1) }}>
          {t(locale, 'settings.pinnedEntriesRefresh')}
        </button>
        <p role="status" className="app-hotkeys-empty">{t(locale, {
          loading: 'settings.pinnedEntriesLoading', ready: 'settings.pinnedEntriesScanned',
          error: 'settings.pinnedEntriesScanFailed', unknown: 'settings.pinnedEntriesUnknownScan',
        }[scan.status])}</p>
        {keys.length === 0 && <p>{t(locale, 'settings.pinnedEntriesEmpty')}</p>}
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 280, overflowY: 'auto' }}>
          {keys.map((key, index) => {
            const entry = describeFavoriteApp(key, scan)
            const name = entry.app?.nameI18n?.[locale] ?? entry.app?.name ?? labels[key]
              ?? t(locale, 'settings.pinnedEntriesUnnamed', { number: index + 1 })
            return <li key={key} style={{ padding: '10px 0', overflowWrap: 'anywhere' }}>
              <div>{name}</div>
              <p className="app-hotkeys-empty">{t(locale, {
                loading: 'settings.pinnedEntriesLoading', available: 'settings.pinnedEntriesAvailable',
                'not-found': 'settings.pinnedEntriesNotFound', unknown: 'settings.pinnedEntriesUnknown',
              }[entry.status])}</p>
              <button type="button" className="app-hotkeys-add-btn"
                aria-label={t(locale, 'settings.pinnedEntriesRemoveLabel', { name })}
                onClick={() => {
                  try {
                    remove(key, false)
                    setError(false)
                    // Removing the focused row must not leave Enter on a different row.
                    refreshButton.current?.focus()
                  } catch { setError(true) }
                }}>{t(locale, 'palette.actionUnpin')}</button>
            </li>
          })}
        </ul>
        {error && <p role="alert" className="app-hotkeys-error">{t(locale, 'palette.favoriteSaveFailed')}</p>}
      </div>}
    </details>
  )
}
