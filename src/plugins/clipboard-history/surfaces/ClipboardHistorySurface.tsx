/**
 * Clipboard History Plugin — Main Surface
 *
 * Host-openable custom-view surface providing:
 * - Top bar: plugin-owned back, search, type filter, settings, close
 * - Left panel: grouped clipboard history list
 * - Right panel: preview and metadata for the selected item
 * - Keyboard shortcuts: Enter=paste, Cmd/Ctrl+C=copy, Delete=remove
 */

import { useState, useEffect, useCallback, useMemo, useRef, memo, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PluginSurfaceProps } from '@hiven/plugin'
import {
  IconButton,
  SearchField,
  SegmentedControl,
  SurfaceEmptyState,
  SurfaceFooterHints,
  SurfaceList,
  SurfaceListItem,
  SurfacePreview,
  ToolbarButton,
  useImeKeyboard,
} from '@hiven/plugin-ui'
import { BackIcon, ClipboardIcon, CloseIcon, FileTextIcon, ImageIcon, SettingsIcon } from '@hiven/plugin-ui/icons'
import type { ClipboardHistorySettings } from '../settings/model'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'
import { createClipboardHistoryRepository } from '../storage/clipboardHistoryRepository'

type FilterKind = 'all' | 'text' | 'image' | 'files'
type SurfaceStorage = PluginSurfaceProps<ClipboardHistorySettings>['host']['storage']
type ImageHistoryItem = Extract<ClipboardHistoryItem, { kind: 'image' }>

type MetaRow = {
  label: string
  value: string
}

export function ClipboardHistorySurface(props: PluginSurfaceProps<ClipboardHistorySettings>) {
  const { host, locale, t, settings } = props

  const repository = useMemo(
    () => createClipboardHistoryRepository(host.storage),
    [host.storage]
  )

  // Try to initialize synchronously from in-memory cache (warmed by background)
  const initialItems = useMemo(() => repository.getListItemsSync() ?? [], [repository])
  const hasInitialCache = initialItems.length > 0

  const [items, setItems] = useState<ClipboardHistoryItem[]>(initialItems)
  const [selectedId, setSelectedId] = useState<string | null>(initialItems[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<FilterKind>('all')
  const [loading, setLoading] = useState(!hasInitialCache)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const imeKeyDown = useImeKeyboard()
  const isKeyboardNavRef = useRef(false)

  const loadItems = useCallback(async () => {
    try {
      const listItems = await repository.getListItems()
      setItems(listItems)
      setSelectedId((current) => {
        if (listItems.length === 0) return null
        if (current && listItems.some((item) => item.id === current)) return current
        return listItems[0].id
      })
    } catch {
      host.showMessage(t('error.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [repository, host, t])

  useEffect(() => {
    // If we already have cached data, skip the initial load delay
    if (hasInitialCache) return
    const timer = window.setTimeout(() => { void loadItems() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadItems, hasInitialCache])

  useEffect(() => {
    if (loading || !settings.enabled) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [loading, settings.enabled])

  const filteredItems = useMemo(() => {
    let result = items
    if (filter !== 'all') {
      result = result.filter((item) => item.kind === filter)
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter((item) => {
        if (item.kind === 'text') return item.preview.toLowerCase().includes(q)
        if (item.kind === 'image') return `${item.contentType} ${item.width ?? ''} ${item.height ?? ''}`.toLowerCase().includes(q)
        if (item.kind === 'files') return item.fileNames.some((f) => f.toLowerCase().includes(q))
        return false
      })
    }
    return result
  }, [items, filter, query])

  useEffect(() => {
    setSelectedId((current) => {
      if (filteredItems.length === 0) return null
      if (current && filteredItems.some((item) => item.id === current)) return current
      return filteredItems[0].id
    })
  }, [filteredItems])

  const selectedItem = useMemo(
    () => filteredItems.find((i) => i.id === selectedId) ?? null,
    [filteredItems, selectedId]
  )

  const [selectedFullItem, setSelectedFullItem] = useState<ClipboardHistoryItem | null>(null)

  useEffect(() => {
    if (!selectedId) {
      setSelectedFullItem(null)
      return
    }
    let cancelled = false
    void repository.getItem(selectedId).then((item) => {
      if (!cancelled && item) setSelectedFullItem(item)
    })
    return () => { cancelled = true }
  }, [selectedId, repository])

  const groupedItems = useMemo(() => groupItemsByDay(filteredItems, locale, t), [filteredItems, locale, t])

  type VirtualRow =
    | { type: 'group-header'; label: string }
    | { type: 'item'; item: ClipboardHistoryItem }

  const flatRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = []
    for (const group of groupedItems) {
      rows.push({ type: 'group-header', label: group.label })
      for (const item of group.items) {
        rows.push({ type: 'item', item })
      }
    }
    return rows
  }, [groupedItems])

  const listRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => flatRows[index].type === 'group-header' ? 28 : 44,
    overscan: 8,
  })

  const handlePaste = useCallback(async (item: ClipboardHistoryItem) => {
    try {
      // For list items from index, load full item for paste
      let fullItem = item
      if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
        const loaded = await repository.getItem(item.id)
        if (!loaded) {
          host.showMessage(t('error.pasteFailed'), 'error')
          return
        }
        fullItem = loaded
      }

      let result
      if (fullItem.kind === 'text') {
        result = await host.paste.pasteText(fullItem.text)
      } else if (fullItem.kind === 'image') {
        result = await host.paste.pasteImage(fullItem.blobId)
      } else if (fullItem.kind === 'files') {
        result = await host.paste.pasteFiles(fullItem.paths)
      }
      if (result && !result.ok && result.fallback === 'copied') {
        host.showMessage(result.message, 'info')
      }
      host.close()
    } catch {
      host.showMessage(t('error.pasteFailed'), 'error')
    }
  }, [host, t, repository])

  const handleDelete = useCallback(async (id: string) => {
    await repository.deleteItem(id)
    await loadItems()
    host.showMessage(t('message.deleted'), 'success')
  }, [repository, loadItems, host, t])

  const handleItemHover = useCallback((id: string) => {
    if (!isKeyboardNavRef.current) {
      setSelectedId(id)
    }
  }, [])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!selectedItem) return
    if (e.key === 'Enter') {
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handlePaste(selectedItem)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return
      e.preventDefault()
      void handleDelete(selectedItem.id)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault()
      if (selectedFullItem && selectedFullItem.kind === 'text') {
        void host.clipboard.writeText(selectedFullItem.text)
        host.showMessage(t('message.copied'), 'success')
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      isKeyboardNavRef.current = true
      const idx = filteredItems.findIndex((i) => i.id === selectedId)
      if (idx < filteredItems.length - 1) {
        const nextId = filteredItems[idx + 1].id
        setSelectedId(nextId)
        const flatIndex = flatRows.findIndex((r) => r.type === 'item' && r.item.id === nextId)
        if (flatIndex >= 0) virtualizer.scrollToIndex(flatIndex, { align: 'auto' })
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      isKeyboardNavRef.current = true
      const idx = filteredItems.findIndex((i) => i.id === selectedId)
      if (idx > 0) {
        const prevId = filteredItems[idx - 1].id
        setSelectedId(prevId)
        const flatIndex = flatRows.findIndex((r) => r.type === 'item' && r.item.id === prevId)
        if (flatIndex >= 0) virtualizer.scrollToIndex(flatIndex, { align: 'auto' })
      }
    }
  }, [selectedItem, selectedFullItem, selectedId, filteredItems, flatRows, virtualizer, handlePaste, handleDelete, host, t, imeKeyDown])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="clipboard-history-state">
          {t('state.loading')}
        </div>
      )
    }

    if (!settings.enabled) {
      return (
        <div className="clipboard-history-state">
          <span>{t('state.disabled')}</span>
          <ToolbarButton type="button" onClick={() => host.openSettings()}>
            {t('action.openSettings')}
          </ToolbarButton>
        </div>
      )
    }

    return (
      <>
        <div className="clipboard-history-main">
          <div className="clipboard-history-list-pane" onMouseMove={() => { isKeyboardNavRef.current = false }}>
            <div className="clipboard-history-list-toolbar">
              <SegmentedControl
                className="clipboard-history-filter"
                value={filter}
                onChange={(value) => setFilter(value as FilterKind)}
                disabled={loading || !settings.enabled}
                aria-label={t('filter.label')}
                options={[
                  { value: 'all', label: t('filter.all') },
                  { value: 'text', label: t('filter.text') },
                  { value: 'image', label: t('filter.image') },
                  { value: 'files', label: t('filter.files') },
                ]}
              />
            </div>
            <div ref={listRef} className="clipboard-history-list" data-launcher-scrollable style={{ overflow: 'auto', flex: 1 }}>
              <SurfaceList aria-label={t('surface.main.title')}>
                {filteredItems.length === 0 ? (
                  <SurfaceEmptyState>
                    {t('state.empty')}
                  </SurfaceEmptyState>
                ) : (
                  <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = flatRows[virtualRow.index]
                      if (row.type === 'group-header') {
                        return (
                          <div
                            key={`group:${row.label}`}
                            className="clipboard-history-group-title"
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              height: `${virtualRow.size}px`,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            {row.label}
                          </div>
                        )
                      }
                      return (
                        <div
                          key={row.item.id}
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: `${virtualRow.size}px`,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          <ClipboardHistoryItemRow
                            item={row.item}
                            selected={row.item.id === selectedId}
                            locale={locale}
                            t={t}
                            storage={host.storage}
                            onSelect={setSelectedId}
                            onHover={handleItemHover}
                            onPaste={handlePaste}
                            onDelete={handleDelete}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </SurfaceList>
            </div>
          </div>

          <SurfacePreview className="clipboard-history-preview">
            {!selectedItem ? (
              <SurfaceEmptyState>
                {t('preview.empty')}
              </SurfaceEmptyState>
            ) : (
              <>
                <div className="clipboard-history-preview-content" data-launcher-scrollable>
                  {renderPreview(selectedFullItem ?? selectedItem, t, host.storage)}
                </div>
                <div className="clipboard-history-meta">
                  {getMetaRows(selectedFullItem ?? selectedItem, locale, t).map((row) => (
                    <div key={row.label} className="clipboard-history-meta-row">
                      <span>{row.label}</span>
                      <strong>{row.value}</strong>
                    </div>
                  ))}
                </div>
              </>
            )}
          </SurfacePreview>
        </div>

        <SurfaceFooterHints className="clipboard-history-footer">
          <span>↵ {t('hint.paste')}</span>
          <span>⌘C {t('hint.copy')}</span>
          <span>⌫ {t('hint.delete')}</span>
        </SurfaceFooterHints>
      </>
    )
  }

  return (
    <div
      ref={containerRef}
      className="clipboard-history-surface"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="clipboard-history-topbar">
        <IconButton
          type="button"
          label={t('action.back')}
          onClick={() => host.requestBack()}
        >
          <BackIcon size={18} />
        </IconButton>
        <SearchField
          ref={searchRef}
          data-plugin-surface-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onCompositionStart={imeKeyDown.onCompositionStart}
          onCompositionEnd={imeKeyDown.onCompositionEnd}
          placeholder={t('search.placeholder')}
          disabled={loading || !settings.enabled}
        />
        <IconButton
          type="button"
          label={t('action.openSettings')}
          onClick={() => host.openSettings()}
        >
          <SettingsIcon size={17} />
        </IconButton>
        <IconButton
          type="button"
          label={t('action.close')}
          onClick={() => host.close()}
        >
          <CloseIcon size={18} />
        </IconButton>
      </div>

      {renderContent()}
    </div>
  )
}

const ClipboardHistoryItemRow = memo(function ClipboardHistoryItemRow({
  item,
  selected,
  locale,
  t,
  storage,
  onSelect,
  onHover,
  onPaste,
  onDelete,
}: {
  item: ClipboardHistoryItem
  selected: boolean
  locale: string
  t: (key: string) => string
  storage: SurfaceStorage
  onSelect: (id: string) => void
  onHover?: (id: string) => void
  onPaste: (item: ClipboardHistoryItem) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const ref = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={ref}
      className={`clipboard-history-item-row${selected ? ' is-selected' : ''}`}
    >
      <SurfaceListItem
        type="button"
        selected={selected}
        className="clipboard-history-item"
        onClick={() => onSelect(item.id)}
        onMouseEnter={() => onHover && onHover(item.id)}
        onDoubleClick={() => void onPaste(item)}
      >
        {renderItemMedia(item, storage)}
        <span className="clipboard-history-item-text">
          <span className="clipboard-history-item-title">{getItemTitle(item, t)}</span>
          <span className="clipboard-history-item-subtitle">{getItemSubtitle(item, locale, t)}</span>
        </span>
      </SurfaceListItem>
      <IconButton
        type="button"
        label={t('action.delete')}
        className="clipboard-history-item-delete"
        onClick={() => void onDelete(item.id)}
      >
        <CloseIcon size={14} />
      </IconButton>
    </div>
  )
})

function ClipboardImageThumbnail({ item, storage }: { item: ImageHistoryItem, storage: SurfaceStorage }) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    let disposed = false
    void storage.blob.url(item.previewBlobId).then((url) => {
      if (!disposed) setImageUrl(url)
    })
    return () => {
      disposed = true
      setImageUrl('')
    }
  }, [item.previewBlobId, storage])

  if (!imageUrl) {
    return (
      <span className="clipboard-history-item-icon" aria-hidden="true">
        <ImageIcon size={20} />
      </span>
    )
  }

  return (
    <span className="clipboard-history-item-thumb" aria-hidden="true">
      <img src={imageUrl} alt="" />
    </span>
  )
}

function renderItemMedia(item: ClipboardHistoryItem, storage: SurfaceStorage) {
  if (item.kind === 'image') return <ClipboardImageThumbnail item={item} storage={storage} />
  return (
    <span className="clipboard-history-item-icon" aria-hidden="true">
      {renderItemIcon(item)}
    </span>
  )
}

function renderItemIcon(item: ClipboardHistoryItem) {
  if (item.kind === 'text') return <FileTextIcon size={20} />
  if (item.kind === 'image') return <ImageIcon size={20} />
  return <ClipboardIcon size={20} />
}

function ClipboardImagePreview({ item, storage, t }: { item: ImageHistoryItem, storage: SurfaceStorage, t: (key: string) => string }) {
  const [imageUrl, setImageUrl] = useState('')

  useEffect(() => {
    let disposed = false
    void storage.blob.url(item.previewBlobId).then((url) => {
      if (!disposed) setImageUrl(url)
    })
    return () => {
      disposed = true
      setImageUrl('')
    }
  }, [item.previewBlobId, storage])

  if (!imageUrl) {
    return (
      <div className="clipboard-history-preview-asset is-empty">
        <ImageIcon size={36} />
        <span>{getItemTitle(item, t)}</span>
      </div>
    )
  }

  return (
    <figure className="clipboard-history-preview-image">
      <img src={imageUrl} alt={getItemTitle(item, t)} />
      <figcaption>{getItemTitle(item, t)}</figcaption>
    </figure>
  )
}

function renderPreview(item: ClipboardHistoryItem, t: (key: string) => string, storage: SurfaceStorage) {
  if (item.kind === 'text') {
    // Show preview text while full item is loading
    const displayText = item.text || item.preview
    return (
      <pre className="clipboard-history-preview-text">
        {displayText}
      </pre>
    )
  }
  if (item.kind === 'image') {
    return <ClipboardImagePreview item={item} storage={storage} t={t} />
  }
  if (item.paths.length === 0 && item.fileNames.length > 0) {
    // List item from index — show fileNames as fallback
    return (
      <div className="clipboard-history-preview-files">
        {item.fileNames.map((name, index) => (
          <div key={`${name}-${index}`} className="clipboard-history-preview-path">
            {name}
          </div>
        ))}
      </div>
    )
  }
  return (
    <div className="clipboard-history-preview-files">
      {item.paths.map((path, index) => (
        <div key={`${path}-${index}`} className="clipboard-history-preview-path">
          {path}
        </div>
      ))}
    </div>
  )
}

function getItemTitle(item: ClipboardHistoryItem, t: (key: string) => string) {
  if (item.kind === 'text') return item.preview || item.text
  if (item.kind === 'image') {
    const dimensions = item.width && item.height ? ` (${item.width}×${item.height})` : ''
    return `${t('filter.image')}${dimensions}`
  }
  return item.fileNames.join(', ')
}

function getItemSubtitle(item: ClipboardHistoryItem, locale: string, t: (key: string) => string) {
  return `${getContentTypeLabel(item, t)} · ${formatBytes(item.byteSize)} · ${formatDateTime(item.lastCopiedAt, locale)}`
}

function getMetaRows(item: ClipboardHistoryItem, locale: string, t: (key: string) => string): MetaRow[] {
  const rows: MetaRow[] = [
    { label: t('meta.contentType'), value: getContentTypeLabel(item, t) },
    { label: t('meta.byteSize'), value: formatBytes(item.byteSize) },
    { label: t('meta.timesCopied'), value: String(item.copyCount) },
    { label: t('meta.firstCopied'), value: formatDateTime(item.firstCopiedAt, locale) },
    { label: t('meta.lastCopied'), value: formatDateTime(item.lastCopiedAt, locale) },
  ]

  if (item.kind === 'text' && item.text) {
    rows.splice(1, 0, { label: t('meta.characters'), value: String(item.text.length) })
    rows.splice(2, 0, { label: t('meta.words'), value: String(countWords(item.text)) })
  }
  if (item.kind === 'image' && item.width && item.height) {
    rows.splice(1, 0, { label: t('meta.dimensions'), value: `${item.width}×${item.height}` })
  }
  if (item.kind === 'files') {
    rows.splice(1, 0, { label: t('meta.files'), value: String(item.paths.length) })
  }
  if (item.sourceApp) {
    rows.splice(rows.length - 2, 0, { label: t('meta.sourceApp'), value: item.sourceApp })
  }

  return rows
}

function getContentTypeLabel(item: ClipboardHistoryItem, t: (key: string) => string) {
  if (item.kind === 'text') return t('filter.text')
  if (item.kind === 'image') return item.contentType
  return t('filter.files')
}

function groupItemsByDay(items: ClipboardHistoryItem[], locale: string, t: (key: string) => string) {
  const groups: Array<{ label: string; items: ClipboardHistoryItem[] }> = []
  for (const item of items) {
    const label = formatGroupLabel(item.lastCopiedAt, locale, t)
    const group = groups.find((entry) => entry.label === label)
    if (group) {
      group.items.push(item)
    } else {
      groups.push({ label, items: [item] })
    }
  }
  return groups
}

function formatGroupLabel(timestamp: number, locale: string, t: (key: string) => string) {
  const date = new Date(timestamp)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (isSameDay(date, today)) return t('group.today')
  if (isSameDay(date, yesterday)) return t('group.yesterday')
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), { month: 'short', day: 'numeric' }).format(date)
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function formatDateTime(timestamp: number, locale: string) {
  return new Intl.DateTimeFormat(resolveIntlLocale(locale), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp))
}

function resolveIntlLocale(locale: string) {
  return locale === 'zh' ? 'zh-CN' : 'en-US'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}
