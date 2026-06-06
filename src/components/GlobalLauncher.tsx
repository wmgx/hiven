import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayoutPanelLeft, Pin, Puzzle, Search, Settings } from 'lucide-react'
import { localized, useAppStore, type ViewId } from '../store'
import { t, type Locale } from '../i18n'
import { resolveIcon } from '../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'

type LauncherItem =
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string }
  | { kind: 'recent'; id: string; title: string; subtitle: string; icon?: string }
  | { kind: 'view'; id: ViewId; title: string; subtitle: string; icon: ReactNode }

const viewItems: { id: ViewId; title: string; titleI18n: Partial<Record<Locale, string>>; icon: ReactNode }[] = [
  { id: 'editor', title: 'Editor', titleI18n: { zh: '编辑器' }, icon: <LayoutPanelLeft size={14} /> },
  { id: 'scripts', title: 'Plugins', titleI18n: { zh: '插件' }, icon: <Puzzle size={14} /> },
  { id: 'settings', title: 'Settings', titleI18n: { zh: '设置' }, icon: <Settings size={14} /> },
]

export function GlobalLauncher() {
  const open = useAppStore((s) => s.globalLauncherOpen)
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const setActiveView = useAppStore((s) => s.setActiveView)
  const setCommandPaletteOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const recentActionNames = useAppStore((s) => s.recentActionNames)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [open])

  const items = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    const pinnedLabel = t(locale, 'palette.globalPinned')
    const recentLabel = t(locale, 'palette.globalRecent')
    const viewsLabel = t(locale, 'palette.globalViews')
    const pinned = pinnedActions.map((item) => ({
      kind: 'pinned' as const,
      id: item.id,
      title: item.title,
      subtitle: pinnedLabel,
      icon: item.icon,
    }))
    const recent = recentActionNames.slice(0, 8).map((name) => {
      const command = pluginRegistry.resolveCommand(name)?.contribution
      return {
        kind: 'recent' as const,
        id: name,
        title: command ? localized(command.title || name, command.titleI18n, locale) : name,
        subtitle: recentLabel,
        icon: command?.icon,
      }
    })
    const views = viewItems.map((item) => ({
      kind: 'view' as const,
      id: item.id,
      title: localized(item.title, item.titleI18n, locale),
      subtitle: viewsLabel,
      icon: item.icon,
    }))
    return [...pinned, ...recent, ...views]
  }, [locale, pinnedActions, recentActionNames, pluginRegistryVersion])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(q))
  }, [items, query])

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  if (!open) return null

  const selectItem = (item: LauncherItem | undefined) => {
    if (!item) return
    setOpen(false)
    if (item.kind === 'pinned') {
      openPinnedAction(item.id)
      return
    }
    if (item.kind === 'view') {
      setActiveView(item.id)
      return
    }
    setActiveView('editor')
    requestAnimationFrame(() => setCommandPaletteOpen(true))
  }

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[70px] palette-overlay open"
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
    >
      <div
        className="w-[min(630px,90vw)] overflow-hidden outline-none palette-panel"
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1))) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)) }
          if (event.key === 'Enter') { event.preventDefault(); selectItem(filtered[selectedIndex]) }
        }}
      >
        <div className="flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <Search size={16} style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0) }}
            placeholder={t(locale, 'palette.globalPlaceholder')}
            className="flex-1 outline-none border-none bg-transparent text-[14px]"
            style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <LauncherSection
          title={t(locale, 'palette.globalPinned')}
          items={filtered.filter((item) => item.kind === 'pinned')}
          selected={filtered[selectedIndex]}
          onSelect={selectItem}
          locale={locale}
        />
        <LauncherSection
          title={t(locale, 'palette.globalRecent')}
          items={filtered.filter((item) => item.kind === 'recent')}
          selected={filtered[selectedIndex]}
          onSelect={selectItem}
          locale={locale}
        />
        <LauncherSection
          title={t(locale, 'palette.globalViews')}
          items={filtered.filter((item) => item.kind === 'view')}
          selected={filtered[selectedIndex]}
          onSelect={selectItem}
          locale={locale}
        />
        <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
          <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
          <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
          <HintKey keys="esc" label={t(locale, 'palette.back')} />
        </div>
      </div>
    </div>
  )
}

function LauncherSection({ title, items, selected, onSelect, locale }: { title: string; items: LauncherItem[]; selected?: LauncherItem; onSelect: (item: LauncherItem) => void; locale: Locale }) {
  if (items.length === 0) return null
  return (
    <div className="py-1">
      <div className="px-3.5 py-1 text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-text-tertiary)' }}>
        {title}
      </div>
      {items.map((item) => {
        const isSelected = selected?.kind === item.kind && selected.id === item.id
        return (
          <button
            key={`${item.kind}:${item.id}`}
            className="w-full flex items-center gap-2.5 px-3.5 py-1.5 border-none text-left cursor-pointer"
            style={{
              background: isSelected ? 'var(--color-accent-light)' : 'transparent',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
            onClick={() => onSelect(item)}
          >
            <span
              className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
              style={{
                background: isSelected ? 'var(--color-accent)' : 'var(--color-background-tertiary)',
                color: isSelected ? 'white' : 'var(--color-text-secondary)',
              }}
            >
              {item.kind === 'pinned'
                ? resolveIcon(item.icon, 14, item.title) || <Pin size={14} />
                : item.kind === 'view' ? item.icon : resolveIcon(item.icon, 14, item.title)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium truncate">{item.title}</span>
              <span className="block text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>{item.subtitle}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
      <kbd className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)' }}>{keys}</kbd>
      {label}
    </span>
  )
}
