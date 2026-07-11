/**
 * Settings modal: list / remove / clear plugin-internal favicon cache.
 */

import { useCallback, useEffect, useState } from 'react'
import type { PluginSettingsModalBodyProps } from '@hiven/plugin'
import {
  clearFaviconCache,
  listFaviconCacheEntries,
  removeFaviconCacheEntry,
  type FaviconCacheListEntry,
} from '../faviconCache'
import type { WebQuickOpenSettings } from './model'

function formatAge(fetchedAt: number, locale: string): string {
  const ageMs = Math.max(0, Date.now() - fetchedAt)
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 1) return locale.startsWith('zh') ? '刚刚' : 'just now'
  if (minutes < 60) return locale.startsWith('zh') ? `${minutes} 分钟前` : `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return locale.startsWith('zh') ? `${hours} 小时前` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return locale.startsWith('zh') ? `${days} 天前` : `${days}d ago`
}

export function FaviconCacheModal({
  host,
  source,
  pluginId,
  locale,
  t,
}: PluginSettingsModalBodyProps<WebQuickOpenSettings>) {
  const [entries, setEntries] = useState<FaviconCacheListEntry[]>([])
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await listFaviconCacheEntries(host.storage, source, pluginId)
      setEntries(next)
      const urls: Record<string, string> = {}
      await Promise.all(next.map(async (entry) => {
        try {
          urls[entry.domain] = await host.storage.blob.url(entry.blobId)
        } catch {
          // ignore missing blobs
        }
      }))
      setIconUrls(urls)
    } catch {
      setEntries([])
      setIconUrls({})
    } finally {
      setLoading(false)
    }
  }, [host.storage, pluginId, source])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleRemove = async (domain: string) => {
    setBusy(true)
    try {
      await removeFaviconCacheEntry(host.storage, domain)
      await reload()
      host.showMessage(t('faviconCache.removed', { domain }), 'success')
    } catch {
      host.showMessage(t('faviconCache.removeFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleClearAll = async () => {
    setBusy(true)
    try {
      const count = await clearFaviconCache(host.storage)
      await reload()
      host.showMessage(t('faviconCache.cleared', { count }), 'success')
    } catch {
      host.showMessage(t('faviconCache.clearFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="web-open-favicon-cache">
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {t('faviconCache.description')}
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {loading ? t('faviconCache.loading') : t('faviconCache.count', { count: entries.length })}
        </span>
        <button
          type="button"
          className="schema-button"
          disabled={busy || loading || entries.length === 0}
          onClick={() => void handleClearAll()}
        >
          {t('faviconCache.clearAll')}
        </button>
      </div>

      {entries.length === 0 && !loading ? (
        <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', padding: '16px 0' }}>
          {t('faviconCache.empty')}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {entries.map((entry) => (
            <li
              key={entry.domain}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                borderRadius: 8,
                border: '0.5px solid var(--color-border-tertiary)',
                background: 'var(--color-background-secondary, transparent)',
              }}
            >
              {iconUrls[entry.domain] ? (
                <img
                  src={iconUrls[entry.domain]}
                  alt=""
                  width={16}
                  height={16}
                  style={{ borderRadius: 3, flexShrink: 0, background: 'var(--color-background-tertiary)' }}
                />
              ) : (
                <span style={{ width: 16, height: 16, flexShrink: 0, fontSize: 12, opacity: 0.6 }} aria-hidden>🌐</span>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {entry.domain}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {formatAge(entry.fetchedAt, locale)}
                </div>
              </div>
              <button
                type="button"
                className="schema-button"
                disabled={busy}
                onClick={() => void handleRemove(entry.domain)}
              >
                {t('faviconCache.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
