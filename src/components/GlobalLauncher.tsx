import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LayoutPanelLeft, Pin, Puzzle, Search, Settings } from 'lucide-react'
import { localized, useAppStore, type ViewId } from '../store'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { applyEffects } from '../workspace/effectRunner'
import { showToast } from '../workspace/toast'
import type { InstantSuggestion } from '../workspace/pluginTypes'

type LauncherItem =
  | { kind: 'instant'; id: string; title: string; subtitle: string; icon?: string; suggestion: InstantSuggestion }
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
  const mode = useAppStore((s) => s.globalLauncherMode)
  const overlay = useAppStore((s) => s.globalLauncherOverlay)
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
  const standaloneLauncher = isStandaloneLauncherWindow()

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    })
  }, [open])

  const items = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    const pinnedLabel = t(locale, 'palette.globalPinned')
    const pinned = pinnedActions.map((item) => {
      const command = pluginRegistry.resolveCommand(item.actionId, item.isDev ? 'dev' : 'production')?.contribution
      return {
        kind: 'pinned' as const,
        id: item.id,
        title: localized(command?.title ?? item.title, command?.titleI18n ?? item.titleI18n, locale),
        subtitle: pinnedLabel,
        icon: command?.icon ?? item.icon,
      }
    })
    if ('pinned-only' === mode) return pinned

    const recentLabel = t(locale, 'palette.globalRecent')
    const viewsLabel = t(locale, 'palette.globalViews')
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
  }, [locale, mode, pinnedActions, recentActionNames, pluginRegistryVersion])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? items.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(q)) : items

    // Compute instant suggestions when there's a query
    if (q && q.length <= 500) {
      const providers = pluginRegistry.getAllInstantSuggestionProviders()
      const sorted = [...providers].sort(
        (a, b) => (b.contribution.priority ?? 0) - (a.contribution.priority ?? 0)
      )
      const instantItems: LauncherItem[] = []
      for (const { contribution, meta } of sorted) {
        try {
          const pluginT = makePluginT(meta.pluginId, locale)
          const suggestions = normalizeInstantSuggestions(contribution.suggest({ query: q, locale, t: pluginT }))
          for (const suggestion of suggestions) {
            instantItems.push({
              kind: 'instant',
              id: suggestion.id,
              title: localized(suggestion.title, suggestion.titleI18n, locale),
              subtitle: localized(suggestion.subtitle ?? '', suggestion.subtitleI18n, locale),
              icon: suggestion.icon,
              suggestion,
            })
          }
        } catch {
          // Provider error should not break the launcher
        }
      }
      if (instantItems.length > 0) return [...instantItems, ...base]
    }

    return base
  }, [items, query, locale, pluginRegistryVersion])

  const closeLauncher = useCallback(() => {
    const wasOverlay = overlay
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[FluxText] Failed to hide launcher window:', error)
        }
        setOpen(false)
      })()
      return
    }
    if (wasOverlay) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          await win.setDecorations(true)
          await win.hide()
        } catch (error) {
          console.warn('[FluxText] Failed to restore launcher window:', error)
        }
        setOpen(false)
      })()
      return
    }
    setOpen(false)
  }, [overlay, setOpen, standaloneLauncher])

  useEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return

    let disposed = false
    let unlisten: (() => void) | undefined
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().onFocusChanged(({ payload: focused }) => {
        if (!focused) closeLauncher()
      }))
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[FluxText] Failed to listen for launcher focus changes:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [closeLauncher, open, standaloneLauncher])

  if (!open) return null
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))

  const selectItem = (item: LauncherItem | undefined) => {
    if (!item) return
    if (item.kind === 'instant') {
      void executeInstantSuggestion(item.suggestion, locale, closeLauncher)
      return
    }
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { emitTo } = await import('@tauri-apps/api/event')
          const { invoke } = await import('@tauri-apps/api/core')
          if (item.kind === 'pinned') {
            await emitTo('main', 'fluxtext://run-pinned-action', { id: item.id })
          }
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[FluxText] Failed to select launcher item:', error)
        }
        setOpen(false)
      })()
      return
    }
    if (overlay) {
      void (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          const win = getCurrentWindow()
          await win.setDecorations(true)
        } catch (error) {
          console.warn('[FluxText] Failed to restore launcher window:', error)
        }
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
      })()
    } else {
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
  }

  return (
    <div
      className={`fixed inset-0 flex items-start justify-center palette-overlay open ${overlay ? 'transparent pt-3' : 'pt-[70px]'}`}
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      onClick={(event) => { if (event.target === event.currentTarget) closeLauncher() }}
    >
      <div
        className="w-[min(630px,90vw)] overflow-hidden outline-none palette-panel"
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-xl)',
        }}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeLauncher()
            return
          }
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1))) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)) }
          if (event.key === 'Enter') { event.preventDefault(); selectItem(filtered[clampedSelectedIndex]) }
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
          items={filtered.filter((item) => item.kind === 'instant' || item.kind === 'pinned')}
          selected={filtered[clampedSelectedIndex]}
          onSelect={selectItem}
        />
        {mode === 'full' && (
          <LauncherSection
            title={t(locale, 'palette.globalRecent')}
            items={filtered.filter((item) => item.kind === 'recent')}
            selected={filtered[clampedSelectedIndex]}
            onSelect={selectItem}
          />
        )}
        {mode === 'full' && (
          <LauncherSection
            title={t(locale, 'palette.globalViews')}
            items={filtered.filter((item) => item.kind === 'view')}
            selected={filtered[clampedSelectedIndex]}
            onSelect={selectItem}
          />
        )}
        <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
          <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
          <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
          <HintKey keys="esc" label={t(locale, 'palette.back')} />
        </div>
      </div>
    </div>
  )
}

async function executeInstantSuggestion(suggestion: InstantSuggestion, locale: Locale, onDone: () => void) {
  const action = suggestion.action
  try {
    if (action.type === 'copy') {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
      await writeText(action.text)
      showToast(t(locale, 'palette.copied'), 'success')
    } else if (action.type === 'insert') {
      applyEffects([{ type: 'text.replace', target: 'active-input', text: action.text } as never])
    } else if (action.type === 'effects') {
      applyEffects(action.effects)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    showToast(msg, 'error')
  }
  onDone()
}

function isStandaloneLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}

function normalizeInstantSuggestions(suggestion: InstantSuggestion | InstantSuggestion[] | null): InstantSuggestion[] {
  if (!suggestion) return []
  return Array.isArray(suggestion) ? suggestion : [suggestion]
}

function LauncherSection({ title, items, selected, onSelect }: { title: string; items: LauncherItem[]; selected?: LauncherItem; onSelect: (item: LauncherItem) => void }) {
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
                : item.kind === 'instant'
                  ? resolveIcon(item.icon, 14, item.title)
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
