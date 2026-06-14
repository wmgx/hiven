/**
 * Clipboard History Plugin — Main Surface
 *
 * Host-openable custom-view surface providing:
 * - Left panel: history list with search and type filter
 * - Right panel: preview of selected item
 * - Keyboard shortcuts: Enter=paste, Cmd/Ctrl+C=copy, Delete=remove
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import type { ClipboardHistorySettings } from '../settings/model'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'
import { createClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'

type FilterKind = 'all' | 'text' | 'image' | 'files'

export function ClipboardHistorySurface(props: PluginSurfaceProps<ClipboardHistorySettings>) {
  const { host, t, settings } = props

  const [items, setItems] = useState<ClipboardHistoryItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [loading, setLoading] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  const repository = useMemo(
    () => createClipboardHistoryRepository(host.storage),
    [host.storage]
  )

  const loadItems = useCallback(async () => {
    try {
      const allItems = await repository.getAllItems()
      setItems(allItems)
      if (allItems.length > 0 && !selectedId) {
        setSelectedId(allItems[0].id)
      }
    } catch {
      host.showMessage(t('error.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [repository, selectedId, host, t])

  useEffect(() => { void loadItems() }, [loadItems])

  const filteredItems = useMemo(() => {
    let result = items
    if (filter !== 'all') {
      result = result.filter((item) => item.kind === filter)
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter((item) => {
        if (item.kind === 'text') return item.text.toLowerCase().includes(q) || item.preview.toLowerCase().includes(q)
        if (item.kind === 'files') return item.fileNames.some((f) => f.toLowerCase().includes(q)) || item.paths.some((p) => p.toLowerCase().includes(q))
        return false
      })
    }
    return result
  }, [items, filter, query])

  const selectedItem = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId]
  )

  const handlePaste = useCallback(async (item: ClipboardHistoryItem) => {
    try {
      let result
      if (item.kind === 'text') {
        result = await host.paste.pasteText(item.text)
      } else if (item.kind === 'image') {
        result = await host.paste.pasteImage(item.blobId)
      } else if (item.kind === 'files') {
        result = await host.paste.pasteFiles(item.paths)
      }
      if (result && !result.ok && result.fallback === 'copied') {
        host.showMessage(result.message, 'info')
      }
      host.close()
    } catch {
      host.showMessage(t('error.pasteFailed'), 'error')
    }
  }, [host, t])

  const handleDelete = useCallback(async (id: string) => {
    await repository.deleteItem(id)
    await loadItems()
  }, [repository, loadItems])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!selectedItem) return
    if (e.key === 'Enter') {
      e.preventDefault()
      void handlePaste(selectedItem)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement?.tagName === 'INPUT') return
      e.preventDefault()
      void handleDelete(selectedItem.id)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault()
      if (selectedItem.kind === 'text') {
        void host.clipboard.writeText(selectedItem.text)
        host.showMessage(t('message.copied'), 'success')
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const idx = filteredItems.findIndex((i) => i.id === selectedId)
      if (idx < filteredItems.length - 1) setSelectedId(filteredItems[idx + 1].id)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = filteredItems.findIndex((i) => i.id === selectedId)
      if (idx > 0) setSelectedId(filteredItems[idx - 1].id)
    }
  }, [selectedItem, selectedId, filteredItems, handlePaste, handleDelete, host, t])

  // Loading state
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)', fontSize: '13px' }}>
        {t('state.loading')}
      </div>
    )
  }

  // Disabled state
  if (!settings.enabled) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '12px', color: 'var(--color-text-tertiary)' }}>
        <span style={{ fontSize: '13px' }}>{t('state.disabled')}</span>
        <button
          onClick={() => host.openSettings()}
          style={{ cursor: 'pointer', padding: '6px 14px', borderRadius: '6px', border: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', fontSize: '12px' }}
        >
          {t('action.openSettings')}
        </button>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(280px, 0.9fr)', height: '100%', minHeight: 0, color: 'var(--color-text-primary)', background: 'var(--color-background-primary)', outline: 'none' }}
    >
      {/* Left: List */}
      <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--color-border-secondary)', overflow: 'hidden' }}>
        {/* Search */}
        <div style={{ padding: '8px', borderBottom: '1px solid var(--color-border-tertiary)' }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', border: '1px solid var(--color-border-secondary)', background: 'var(--color-background-secondary)', color: 'var(--color-text-primary)', outline: 'none', fontSize: '12px' }}
          />
        </div>

        {/* Filter tabs */}
        <div style={{ display: 'flex', gap: '2px', padding: '4px 8px', borderBottom: '1px solid var(--color-border-tertiary)' }}>
          {(['all', 'text', 'image', 'files'] as FilterKind[]).map((kind) => (
            <button
              key={kind}
              onClick={() => setFilter(kind)}
              style={{
                padding: '3px 10px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px',
                background: filter === kind ? 'var(--color-accent)' : 'transparent',
                color: filter === kind ? '#fff' : 'var(--color-text-secondary)',
              }}
            >
              {t(`filter.${kind}`)}
            </button>
          ))}
        </div>

        {/* List */}
        <div style={{ flex: 1, overflow: 'auto', padding: '4px' }}>
          {filteredItems.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
              {t('state.empty')}
            </div>
          ) : (
            filteredItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                onDoubleClick={() => void handlePaste(item)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '6px', width: '100%',
                  padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  border: 'none', textAlign: 'left',
                  background: item.id === selectedId ? 'var(--color-background-tertiary)' : 'transparent',
                  color: 'var(--color-text-primary)', marginBottom: '1px',
                }}
              >
                <span style={{ fontSize: '11px', opacity: 0.7 }}>
                  {item.kind === 'text' ? '📝' : item.kind === 'image' ? '🖼️' : '📁'}
                </span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.kind === 'text' ? item.preview :
                   item.kind === 'image' ? `${item.contentType} ${item.width ?? '?'}×${item.height ?? '?'}` :
                   item.fileNames.join(', ')}
                </span>
              </button>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div style={{ padding: '6px 8px', borderTop: '1px solid var(--color-border-tertiary)', fontSize: '10px', color: 'var(--color-text-tertiary)', display: 'flex', gap: '12px' }}>
          <span>↵ {t('hint.paste')}</span>
          <span>⌘C {t('hint.copy')}</span>
          <span>⌫ {t('hint.delete')}</span>
        </div>
      </div>

      {/* Right: Preview */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', padding: '12px' }}>
        {!selectedItem ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)', fontSize: '12px' }}>
            {t('preview.empty')}
          </div>
        ) : selectedItem.kind === 'text' ? (
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', fontFamily: 'var(--font-mono)', overflow: 'auto' }}>
            {selectedItem.text}
          </pre>
        ) : selectedItem.kind === 'image' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              {selectedItem.contentType} · {selectedItem.width ?? '?'}×{selectedItem.height ?? '?'} · {Math.round(selectedItem.byteSize / 1024)}KB
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {selectedItem.paths.map((path, i) => (
              <div key={i} style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '4px 6px', borderRadius: '4px', background: 'var(--color-background-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {path}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
