/**
 * Settings modal: clear per-entry query parameter history.
 */

import { useCallback, useEffect, useState } from 'react'
import { getPluginHostSdk, type PluginSettingsModalBodyProps } from '@hiven/plugin'
import {
  clearQueryHistory,
  importBrowserQueryHistory,
  loadQueryHistory,
  type QueryHistoryItem,
} from '../queryHistory'
import type { WebQuickOpenSettings } from './model'
import { CHROMIUM_SOURCE_ID } from '../browserProvider'

type EntryHistoryRow = {
  entryId: string
  title: string
  count: number
  items: QueryHistoryItem[]
}

export function QueryHistoryModal({
  value,
  host,
  t,
  context,
}: PluginSettingsModalBodyProps<WebQuickOpenSettings>) {
  const [rows, setRows] = useState<EntryHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const entryId = typeof context?.itemId === 'string' ? context.itemId : ''
      const entries = (value?.entries ?? []).filter((entry) => !entryId || entry.id === entryId)
      const next: EntryHistoryRow[] = []
      for (const entry of entries) {
        const items = await loadQueryHistory(host.storage, entry.id)
        if (items.length === 0) continue
        next.push({
          entryId: entry.id,
          title: entry.title || entry.id,
          count: items.length,
          items,
        })
      }
      setRows(next)
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [context?.itemId, host.storage, value?.entries])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleClear = async (entryId: string, title: string) => {
    setBusy(true)
    try {
      await clearQueryHistory(host.storage, entryId)
      await reload()
      host.showMessage(t('queryHistory.cleared', { title }), 'success')
    } catch {
      host.showMessage(t('queryHistory.clearFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleLearn = async () => {
    setBusy(true)
    try {
      const history = await getPluginHostSdk().desktopTargets.bridge.listHistory(CHROMIUM_SOURCE_ID)
      const entryId = typeof context?.itemId === 'string' ? context.itemId : ''
      const entries = (value?.entries ?? []).filter((entry) => !entryId || entry.id === entryId)
      const count = await importBrowserQueryHistory(host.storage, entries, history)
      await reload()
      host.showMessage(t('queryHistory.learned', { count }), 'success')
    } catch {
      host.showMessage(t('queryHistory.learnFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-1">
      <p className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
        {t('queryHistory.description')}
      </p>
      <button
        type="button"
        className="self-start rounded px-3 py-1.5 text-[12px]"
        style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}
        disabled={busy}
        onClick={() => { void handleLearn() }}
      >
        {t('queryHistory.learnFromBrowser')}
      </button>
      {loading ? (
        <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
          {t('queryHistory.loading')}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-[12px]" style={{ color: 'var(--muted-foreground)' }}>
          {t('queryHistory.empty')}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.entryId}
              className="flex items-center justify-between gap-3 rounded border px-3 py-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{row.title}</div>
                <div className="text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                  {t('queryHistory.count', { count: row.count })}
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded px-2 py-1 text-[12px]"
                style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
                disabled={busy}
                onClick={() => { void handleClear(row.entryId, row.title) }}
              >
                {t('queryHistory.clear')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
