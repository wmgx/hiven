import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useAppStore } from '../../store'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { filterEditorCommandBarItems } from '../../workspace/launcher/types'
import { resolveDisplayTitle, resolveDisplaySubtitle } from '../../workspace/launcher/display'
import { resolveIcon } from '../../utils/resolveIcon'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { createQuickEditorLauncherApi } from '../../workspace/quickEditor/quickEditorActions'

export function QuickEditorCommandOverlay() {
  const open = useAppStore((s) => s.quickEditorCommandOpen)
  const closeCommand = useAppStore((s) => s.closeQuickEditorCommand)
  const locale = useAppStore((s) => s.locale)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controllerRef,
    rankedItems,
  } = useLauncherSession({
    hostId: 'quick-editor-command',
    open,
    requestClose: closeCommand,
    staticItemFilter: filterEditorCommandBarItems,
    makeApi: createQuickEditorLauncherApi,
  })

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open, setQuery, setSelectedIndex])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Handled by container onKeyDown
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, rankedItems.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = rankedItems[selectedIndex]
      if (item) {
        controllerRef.current?.selectItem(item)
      }
      return
    }
  }, [controllerRef, rankedItems, selectedIndex, setSelectedIndex])

  if (!open) return null

  const visibleItems = rankedItems.slice(0, 12)

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: 'var(--color-background-primary, var(--panel, #fff))',
        borderRadius: 'inherit',
      }}
      onKeyDown={(e) => {
        // Prevent Escape from bubbling to the global handler
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          closeCommand()
        }
      }}
    >
      {/* Search input */}
      <div
        className="flex items-center px-3 h-10 shrink-0 gap-2"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
      >
        <span
          className="text-[10px] font-medium px-1 py-0.5 rounded shrink-0"
          style={{
            background: 'var(--color-background-tertiary)',
            color: 'var(--color-text-secondary)',
          }}
        >
          ⌘K
        </span>
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-sm outline-none"
          style={{ color: 'var(--color-text-primary)' }}
          placeholder="Run a command..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>

      {/* Results */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto py-1"
        data-launcher-scrollable
      >
        {visibleItems.length === 0 && query.trim().length > 0 && (
          <div
            className="px-3 py-4 text-center text-xs"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            No commands found
          </div>
        )}
        {visibleItems.map((item, index) => (
          <CommandOverlayItem
            key={item.systemKey}
            item={item}
            selected={index === selectedIndex}
            locale={locale}
            onSelect={() => controllerRef.current?.selectItem(item)}
            onHover={() => setSelectedIndex(index)}
          />
        ))}
      </div>
    </div>
  )
}

function CommandOverlayItem({
  item,
  selected,
  locale,
  onSelect,
  onHover,
}: {
  item: DomainLauncherItem
  selected: boolean
  locale: string
  onSelect: () => void
  onHover: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const title = resolveDisplayTitle(item.display, locale)
  const subtitle = resolveDisplaySubtitle(item.display, locale)
  const IconComponent = item.display.icon ? resolveIcon(item.display.icon) : null

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors"
      style={{
        background: selected ? 'var(--color-background-tertiary)' : 'transparent',
        color: 'var(--color-text-primary)',
      }}
      onClick={onSelect}
      onMouseEnter={onHover}
    >
      {IconComponent && (
        <span className="shrink-0 w-4 h-4 flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)' }}>
          <IconComponent size={14} />
        </span>
      )}
      <span className="text-sm truncate">{title}</span>
      {subtitle && (
        <span className="text-xs truncate ml-auto" style={{ color: 'var(--color-text-tertiary)' }}>
          {subtitle}
        </span>
      )}
    </button>
  )
}
