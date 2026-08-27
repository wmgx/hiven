/**
 * Clipboard History Plugin — Main Surface
 *
 * Host-openable custom-view surface providing:
 * - Top bar: plugin-owned back, search, type filter, settings, close
 * - Left panel: grouped clipboard history list
 * - Right panel: preview and metadata for the selected item
 * - Keyboard shortcuts: Enter=paste, Cmd/Ctrl+C=copy selection in preview, Delete=remove
 */

import { useState, useEffect, useCallback, useMemo, useRef, memo, type KeyboardEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { PluginSurfaceProps } from '@hiven/plugin'
import {
  Button,
  ContextMenu,
  Dialog,
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
  type MenuItemSpec,
} from '@hiven/plugin-ui'
import { BackIcon, ClipboardIcon, CloseIcon, FileTextIcon, ImageIcon, SettingsIcon, StarIcon } from '@hiven/plugin-ui/icons'
import type { ClipboardHistorySettings } from '../settings/model'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'
import { subscribeCachedIndex } from '../storage/clipboardHistoryCache'
import { createClipboardHistoryRepository, indexToListItems } from '../storage/clipboardHistoryRepository'

type FilterKind = 'all' | 'text' | 'image' | 'files' | 'frequent' | 'favorite'
type SurfaceStorage = PluginSurfaceProps<ClipboardHistorySettings>['host']['storage']
type ImageHistoryItem = Extract<ClipboardHistoryItem, { kind: 'image' }>

type MetaRow = {
  label: string
  value: string
}

type FavoriteTitleDialogState = {
  id: string
  draft: string
  mode: 'create' | 'edit'
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
  const [titleDialog, setTitleDialog] = useState<FavoriteTitleDialogState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const imeKeyDown = useImeKeyboard()
  const isKeyboardNavRef = useRef(false)
  const pendingDeleteRef = useRef<{ timerId: ReturnType<typeof setTimeout>; id: string; toastId: string } | null>(null)
  const frequentThreshold = settings.frequentPasteThreshold ?? 3

  const applyListItems = useCallback((listItems: ClipboardHistoryItem[]) => {
    setItems(listItems)
    setSelectedId((current) => {
      if (listItems.length === 0) return null
      if (current && listItems.some((item) => item.id === current)) return current
      return listItems[0].id
    })
    setLoading(false)
  }, [])

  const loadItems = useCallback(async () => {
    try {
      const listItems = await repository.getFreshListItems()
      applyListItems(listItems)
    } catch {
      host.showMessage(t('error.loadFailed'), 'error')
    } finally {
      setLoading(false)
    }
  }, [repository, host, t, applyListItems])

  useEffect(() => {
    // If we already have cached data, skip the initial load delay
    if (hasInitialCache) return
    const timer = window.setTimeout(() => { void loadItems() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadItems, hasInitialCache])

  useEffect(() => {
    return subscribeCachedIndex((index) => {
      applyListItems(index ? indexToListItems(index) : [])
    })
  }, [applyListItems])

  useEffect(() => {
    if (!settings.enabled) return
    // 初次挂载时刷新一次
    void repository.getFreshListItems()
      .then(applyListItems)
      .catch(() => {})
    // 窗口获焦时刷新，替代固定 1s 轮询
    const handleFocus = () => {
      void repository.getFreshListItems()
        .then(applyListItems)
        .catch(() => {})
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [repository, settings.enabled, applyListItems])

  useEffect(() => {
    if (loading || !settings.enabled) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [loading, settings.enabled])

  // Flush pending soft-delete on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timerId)
        host.dismissToast(pendingDeleteRef.current.toastId)
        void repository.deleteItem(pendingDeleteRef.current.id)
        pendingDeleteRef.current = null
      }
    }
  }, [repository])

  const filteredItems = useMemo(() => {
    let result = items
    if (filter === 'frequent') {
      result = result
        .filter((item) => (item.pasteCount ?? 0) >= frequentThreshold)
        .slice()
        .sort((a, b) => {
          const pasteDiff = (b.pasteCount ?? 0) - (a.pasteCount ?? 0)
          if (pasteDiff !== 0) return pasteDiff
          return (b.lastPastedAt ?? 0) - (a.lastPastedAt ?? 0)
        })
    } else if (filter === 'favorite') {
      result = result
        .filter((item) => item.isFavorite)
        .slice()
        .sort((a, b) => (b.favoritedAt ?? 0) - (a.favoritedAt ?? 0))
    } else if (filter !== 'all') {
      result = result.filter((item) => item.kind === filter)
    }
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter((item) => {
        if (item.favoriteTitle?.toLowerCase().includes(q)) return true
        if (item.kind === 'text') return item.preview.toLowerCase().includes(q)
        if (item.kind === 'image') return `${item.contentType} ${item.width ?? ''} ${item.height ?? ''}`.toLowerCase().includes(q)
        if (item.kind === 'files') return item.fileNames.some((f) => f.toLowerCase().includes(q))
        return false
      })
    }
    return result
  }, [items, filter, query, frequentThreshold])

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
    setSelectedFullItem(null)
    void repository.getItem(selectedId).then((item) => {
      if (!cancelled && item) setSelectedFullItem(item)
    })
    return () => { cancelled = true }
  }, [selectedId, repository])

  const groupedItems = useMemo(() => {
    // Frequent / favorite use their own sort; do not re-bucket by day.
    if (filter === 'frequent' || filter === 'favorite') {
      return [{ label: '', items: filteredItems }]
    }
    return groupItemsByDay(filteredItems, locale, t)
  }, [filteredItems, filter, locale, t])

  type VirtualRow =
    | { type: 'group-header'; label: string }
    | { type: 'item'; item: ClipboardHistoryItem }

  const flatRows = useMemo<VirtualRow[]>(() => {
    const rows: VirtualRow[] = []
    for (const group of groupedItems) {
      if (group.label) {
        rows.push({ type: 'group-header', label: group.label })
      }
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
      // Persist paste count for Frequent tab (window closes; next open reads storage/cache).
      void repository.recordPaste(fullItem.id).catch(() => {})
      // 上屏成功后清空搜索，热开窗口时不会残留上次筛选词
      setQuery('')
      host.close()
    } catch {
      host.showMessage(t('error.pasteFailed'), 'error')
    }
  }, [host, t, repository])

  const resolveFullItem = useCallback(async (item: ClipboardHistoryItem) => {
    if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
      return repository.getItem(item.id)
    }
    return item
  }, [repository])

  const handleCopy = useCallback(async (item: ClipboardHistoryItem) => {
    try {
      const fullItem = await resolveFullItem(item)
      if (!fullItem) {
        host.showMessage(t('error.copyFailed'), 'error')
        return
      }
      if (fullItem.kind === 'text') {
        await host.clipboard.writeText(fullItem.text)
      } else if (fullItem.kind === 'image') {
        await host.clipboard.writeImage(fullItem.blobId)
      } else {
        await host.clipboard.writeFiles(fullItem.paths)
      }
      host.showMessage(t('message.copied'), 'success')
    } catch {
      host.showMessage(t('error.copyFailed'), 'error')
    }
  }, [host, resolveFullItem, t])

  const itemContextMenuItems = useCallback((item: ClipboardHistoryItem): MenuItemSpec[] => [
    { key: 'paste', label: t('action.paste'), onSelect: () => void handlePaste(item) },
    { key: 'copy', label: t('action.copy'), onSelect: () => void handleCopy(item) },
    { key: 'delete', label: t('action.delete'), danger: true, onSelect: () => handleDelete(item.id) },
  ], [handlePaste, handleCopy, handleDelete, t])

  const applyItemUpdate = useCallback((updated: ClipboardHistoryItem) => {
    setItems((current) =>
      current.map((entry) => {
        if (entry.id !== updated.id) return entry
        // Keep list-friendly payloads (preview / empty text) when full item is loaded.
        if (entry.kind === 'text' && updated.kind === 'text') {
          return {
            ...updated,
            text: updated.text || entry.text,
            preview: updated.preview || entry.preview,
          }
        }
        if (entry.kind === 'image' && updated.kind === 'image') {
          return {
            ...updated,
            blobId: updated.blobId || entry.blobId,
            previewBlobId: updated.previewBlobId || entry.previewBlobId,
          }
        }
        if (entry.kind === 'files' && updated.kind === 'files') {
          return {
            ...updated,
            paths: updated.paths.length > 0 ? updated.paths : entry.paths,
            fileNames: updated.fileNames.length > 0 ? updated.fileNames : entry.fileNames,
          }
        }
        return updated
      }),
    )
    setSelectedFullItem((current) => (current?.id === updated.id ? updated : current))
  }, [])

  const openFavoriteTitleDialog = useCallback((item: ClipboardHistoryItem, mode: 'create' | 'edit') => {
    const fallback =
      item.favoriteTitle
      || (item.kind === 'text' ? item.preview : item.kind === 'files' ? item.fileNames.join(', ') : '')
    setTitleDialog({ id: item.id, draft: mode === 'edit' ? (item.favoriteTitle ?? '') : fallback.slice(0, 80), mode })
  }, [])

  const handleFavoriteClick = useCallback((item: ClipboardHistoryItem) => {
    if (item.isFavorite) {
      void repository.setFavorite(item.id, false)
        .then((updated) => {
          if (updated) applyItemUpdate(updated)
        })
        .catch(() => host.showMessage(t('error.favoriteFailed'), 'error'))
      return
    }
    openFavoriteTitleDialog(item, 'create')
  }, [repository, applyItemUpdate, openFavoriteTitleDialog, host, t])

  const confirmFavoriteTitleDialog = useCallback(() => {
    if (!titleDialog) return
    const { id, draft, mode } = titleDialog
    setTitleDialog(null)
    const action =
      mode === 'create'
        ? repository.setFavorite(id, true, draft)
        : repository.updateFavoriteTitle(id, draft)
    void action
      .then((updated) => {
        if (updated) applyItemUpdate(updated)
      })
      .catch(() => host.showMessage(t('error.favoriteFailed'), 'error'))
  }, [titleDialog, repository, applyItemUpdate, host, t])

  const handleDelete = useCallback((id: string) => {
    // Cancel any previous pending delete
    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current.timerId)
      host.dismissToast(pendingDeleteRef.current.toastId)
      // Commit previous pending delete immediately
      const prevId = pendingDeleteRef.current.id
      void repository.deleteItem(prevId)
      pendingDeleteRef.current = null
    }

    // Capture item and its position for undo
    const itemIndex = items.findIndex((i) => i.id === id)
    if (itemIndex === -1) return
    const removedItem = items[itemIndex]

    // Optimistically remove from displayed list
    const newItems = items.filter((i) => i.id !== id)
    setItems(newItems)

    // Move selection to next item (or previous if last)
    setSelectedId((current) => {
      if (current !== id) return current
      if (newItems.length === 0) return null
      // Prefer the item that was below the deleted one
      return newItems[Math.min(itemIndex, newItems.length - 1)]?.id ?? null
    })

    // Show undo toast
    const toastMessage = `${t('message.deleted.toast')} \u00b7 `
    const toastId = host.showToast(toastMessage, 'info', {
      duration: 5000,
      action: {
        label: t('message.undo'),
        onClick: () => {
          // Restore item at original position
          if (pendingDeleteRef.current?.id === id) {
            clearTimeout(pendingDeleteRef.current.timerId)
            pendingDeleteRef.current = null
          }
          setItems((current) => {
            const restored = [...current]
            const insertAt = Math.min(itemIndex, restored.length)
            restored.splice(insertAt, 0, removedItem)
            return restored
          })
          setSelectedId(id)
        },
      },
    })

    // Schedule actual deletion after 5 seconds
    const timerId = setTimeout(() => {
      if (pendingDeleteRef.current?.id === id) {
        pendingDeleteRef.current = null
      }
      void repository.deleteItem(id)
    }, 5000)

    pendingDeleteRef.current = { timerId, id, toastId }
  }, [items, repository, t])

  const handleItemHover = useCallback((id: string) => {
    if (!isKeyboardNavRef.current) {
      setSelectedId(id)
    }
  }, [])

  const handleReturnToLauncher = useCallback(async (item: ClipboardHistoryItem) => {
    try {
      let fullItem = item
      if ((item.kind === 'text' && !item.text) || (item.kind === 'image' && !item.blobId) || (item.kind === 'files' && item.paths.length === 0)) {
        const loaded = await repository.getItem(item.id)
        if (!loaded) {
          host.showToast(t('error.loadFailed'), 'error')
          return
        }
        fullItem = loaded
      }

      const ageMs = Date.now() - fullItem.lastCopiedAt
      const ageLabel =
        ageMs < 1000 ? undefined
          : ageMs < 60_000 ? `${Math.floor(ageMs / 1000)}s`
            : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m`
              : undefined

      if (fullItem.kind === 'text') {
        if (!fullItem.text) {
          host.showToast(t('error.returnFailed'), 'error')
          return
        }
        host.returnToLauncherWithObject({ kind: 'text', text: fullItem.text, ageLabel })
        return
      }
      if (fullItem.kind === 'image') {
        if (!fullItem.blobId) {
          host.showToast(t('error.returnFailed'), 'error')
          return
        }
        host.returnToLauncherWithObject({
          kind: 'image',
          blobId: fullItem.blobId,
          contentType: fullItem.contentType,
          width: fullItem.width,
          height: fullItem.height,
          ageLabel,
        })
        return
      }
      if (fullItem.kind === 'files') {
        if (!fullItem.paths?.length) {
          host.showToast(t('error.returnFailed'), 'error')
          return
        }
        host.returnToLauncherWithObject({
          kind: 'files',
          paths: fullItem.paths,
          fileNames: fullItem.fileNames,
          ageLabel,
        })
      }
    } catch {
      host.showToast(t('error.returnFailed'), 'error')
    }
  }, [host, repository, t])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!selectedItem) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handleReturnToLauncher(selectedItem)
    } else if (e.key === 'Enter') {
      if (imeKeyDown.shouldIgnoreKeyDown(e)) return
      e.preventDefault()
      void handlePaste(selectedItem)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'SELECT') return
      e.preventDefault()
      handleDelete(selectedItem.id)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      const selectedText = readDomSelectedText()
      e.preventDefault()
      if (selectedText) {
        void host.clipboard.writeText(selectedText)
        host.showMessage(t('message.copied'), 'success')
        return
      }
      void handleCopy(selectedItem)
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
  }, [selectedItem, selectedId, filteredItems, flatRows, virtualizer, handlePaste, handleReturnToLauncher, handleDelete, handleCopy, host, t, imeKeyDown])

  const renderContent = () => {
    if (loading) {
      return (
        <div className="clipboard-history-main">
          <div className="clipboard-history-list-pane">
            <div className="clipboard-history-list-toolbar">
              <div className="clipboard-history-skeleton-bar clipboard-history-skeleton-filter" />
            </div>
            <div className="clipboard-history-list" style={{ overflow: 'hidden', flex: 1 }}>
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="clipboard-history-skeleton-item" style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          </div>
          <div className="clipboard-history-skeleton-preview">
            <div className="clipboard-history-skeleton-bar clipboard-history-skeleton-preview-title" />
            <div className="clipboard-history-skeleton-bar clipboard-history-skeleton-preview-body" />
          </div>
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
                  { value: 'favorite', label: t('filter.favorite') },
                  { value: 'frequent', label: t('filter.frequent') },
                  { value: 'text', label: t('filter.text') },
                  { value: 'image', label: t('filter.image') },
                  { value: 'files', label: t('filter.files') },
                ]}
              />
            </div>
            <div ref={listRef} className="clipboard-history-list" data-launcher-scrollable style={{ overflow: 'auto', flex: 1 }}>
              <SurfaceList aria-label={t('surface.main.title')} data-launcher-scrollable>
                {filteredItems.length === 0 ? (
                  <SurfaceEmptyState>
                    {filter === 'frequent'
                      ? t('state.emptyFrequent')
                      : filter === 'favorite'
                        ? t('state.emptyFavorite')
                        : t('state.empty')}
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
                            onFavorite={handleFavoriteClick}
                            menuItems={itemContextMenuItems(row.item)}
                          />
                        </div>
                      )
                    })}
                  </div>
                )}
              </SurfaceList>
            </div>
          </div>

          <ContextMenu
            disabled={!selectedItem}
            items={selectedItem ? itemContextMenuItems(selectedFullItem ?? selectedItem) : []}
            trigger={
              <SurfacePreview className="clipboard-history-preview" data-launcher-scrollable>
                {!selectedItem ? (
                  <SurfaceEmptyState>
                    {t('preview.empty')}
                  </SurfaceEmptyState>
                ) : (
                  <>
                    <div className="clipboard-history-preview-content" data-launcher-scrollable>
                      {renderPreview(selectedFullItem ?? selectedItem, t, host.storage)}
                    </div>
                    {(selectedFullItem ?? selectedItem).isFavorite && (
                      <div className="clipboard-history-favorite-title-bar">
                        <span className="clipboard-history-favorite-title-label">
                          {(selectedFullItem ?? selectedItem).favoriteTitle || t('favorite.untitled')}
                        </span>
                        <ToolbarButton
                          type="button"
                          onClick={() => openFavoriteTitleDialog(selectedFullItem ?? selectedItem, 'edit')}
                        >
                          {t('action.editFavoriteTitle')}
                        </ToolbarButton>
                      </div>
                    )}
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
            }
          />
        </div>

        <SurfaceFooterHints className="clipboard-history-footer">
          <span>↵ {t('hint.paste')}</span>
          <span>{typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'}↵ {t('hint.returnToLauncher')}</span>
          <span>⌫ {t('hint.delete')}</span>
        </SurfaceFooterHints>
      </>
    )
  }

  useEffect(() => {
    if (!titleDialog) return
    const frame = requestAnimationFrame(() => titleInputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [titleDialog])

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
        <Button
          type="button"
          variant="primary"
          disabled={!selectedItem || loading || !settings.enabled}
          onClick={() => selectedItem && void handlePaste(selectedItem)}
        >
          {t('action.paste')}
        </Button>
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

      <Dialog
        open={Boolean(titleDialog)}
        onOpenChange={(open) => { if (!open) setTitleDialog(null) }}
        title={t('favorite.titleDialog')}
      >
        {titleDialog && (
          <div
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !imeKeyDown.shouldIgnoreKeyDown(event as unknown as KeyboardEvent)) {
                event.preventDefault()
                confirmFavoriteTitleDialog()
              }
            }}
          >
            <input
              ref={titleInputRef}
              className="clipboard-history-title-dialog-input"
              value={titleDialog.draft}
              onChange={(event) => setTitleDialog({ ...titleDialog, draft: event.target.value })}
              onCompositionStart={imeKeyDown.onCompositionStart}
              onCompositionEnd={imeKeyDown.onCompositionEnd}
              placeholder={t('favorite.titlePlaceholder')}
              maxLength={80}
            />
            <div className="clipboard-history-title-dialog-actions">
              <ToolbarButton type="button" onClick={confirmFavoriteTitleDialog}>
                {titleDialog.mode === 'create' ? t('action.confirmFavorite') : t('action.saveFavoriteTitle')}
              </ToolbarButton>
              <ToolbarButton type="button" onClick={() => setTitleDialog(null)}>
                {t('action.cancel')}
              </ToolbarButton>
            </div>
          </div>
        )}
      </Dialog>
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
  onFavorite,
  menuItems,
}: {
  item: ClipboardHistoryItem
  selected: boolean
  locale: string
  t: (key: string) => string
  storage: SurfaceStorage
  onSelect: (id: string) => void
  onHover?: (id: string) => void
  onPaste: (item: ClipboardHistoryItem) => Promise<void>
  onDelete: (id: string) => void
  onFavorite: (item: ClipboardHistoryItem) => void
  menuItems: MenuItemSpec[]
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  const pasteCount = item.pasteCount ?? 0

  return (
    <ContextMenu
      items={menuItems}
      trigger={
        <div
          ref={ref}
          className={`clipboard-history-item-row${selected ? ' is-selected' : ''}${item.isFavorite ? ' is-favorite' : ''}`}
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
              <span className="clipboard-history-item-subtitle">
                {getItemSubtitle(item, locale, t)}
                {pasteCount > 0 ? ` · ×${pasteCount}` : ''}
              </span>
            </span>
          </SurfaceListItem>
          <IconButton
            type="button"
            label={item.isFavorite ? t('action.unfavorite') : t('action.favorite')}
            className={`clipboard-history-item-favorite${item.isFavorite ? ' is-active' : ''}`}
            onClick={() => onFavorite(item)}
          >
            <StarIcon size={14} fill={item.isFavorite ? 'currentColor' : 'none'} />
          </IconButton>
          <IconButton
            type="button"
            label={t('action.delete')}
            className="clipboard-history-item-delete"
            onClick={() => onDelete(item.id)}
          >
            <CloseIcon size={14} />
          </IconButton>
        </div>
      }
    />
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
  if (item.favoriteTitle?.trim()) return item.favoriteTitle.trim()
  if (item.kind === 'text') return item.preview || item.text
  if (item.kind === 'image') {
    const dimensions = item.width && item.height ? ` (${item.width}×${item.height})` : ''
    return `${t('filter.image')}${dimensions}`
  }
  return item.fileNames.join(', ')
}

function getItemSubtitle(item: ClipboardHistoryItem, locale: string, t: (key: string) => string) {
  const base = `${getContentTypeLabel(item, t)} · ${formatBytes(item.byteSize)} · ${formatDateTime(item.lastCopiedAt, locale)}`
  if (item.favoriteTitle?.trim() && item.kind === 'text' && item.preview) {
    return `${item.preview} · ${base}`
  }
  return base
}

function getMetaRows(item: ClipboardHistoryItem, locale: string, t: (key: string) => string): MetaRow[] {
  const rows: MetaRow[] = [
    { label: t('meta.contentType'), value: getContentTypeLabel(item, t) },
    { label: t('meta.byteSize'), value: formatBytes(item.byteSize) },
    { label: t('meta.firstCopied'), value: formatDateTime(item.firstCopiedAt, locale) },
    { label: t('meta.lastCopied'), value: formatDateTime(item.lastCopiedAt, locale) },
  ]
  if ((item.pasteCount ?? 0) > 0) {
    rows.push({ label: t('meta.timesPasted'), value: String(item.pasteCount) })
  }
  if (item.isFavorite) {
    rows.push({ label: t('meta.favorite'), value: item.favoriteTitle?.trim() || t('favorite.untitled') })
  }

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
  const intlLocales: Record<string, string> = {
    zh: 'zh-CN',
    en: 'en-US',
  }
  return intlLocales[locale] ?? 'en-US'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function countWords(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

/** Read non-empty text selection from inputs or the document (preview pane). */
function readDomSelectedText(): string {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart
    const end = active.selectionEnd
    if (start != null && end != null && end > start) {
      return active.value.slice(start, end)
    }
    return ''
  }
  return window.getSelection()?.toString() ?? ''
}
