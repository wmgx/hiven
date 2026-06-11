import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { LayoutPanelLeft, Pin, Puzzle, Search, Settings } from 'lucide-react'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { localized, useAppStore, type ViewId } from '../store'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { applyEffects } from '../workspace/effectRunner'
import { showToast } from '../workspace/toast'
import type { InstantSuggestion } from '../workspace/pluginTypes'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'

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

const STANDALONE_LAUNCHER_WIDTH = 660
const STANDALONE_LAUNCHER_MIN_HEIGHT = 160
const STANDALONE_LAUNCHER_MAX_HEIGHT = 390
const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 300

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
  const launcherPosition = useAppStore((s) => s.settings.globalLauncherPosition)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dragPosition, setDragPosition] = useState(launcherPosition)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isImeComposingRef = useRef(false)
  const dragRef = useRef<{
    offsetX: number
    offsetY: number
    position: { x: number; y: number }
  } | null>(null)
  const standaloneLauncher = isStandaloneLauncherWindow()

  useEffect(() => {
    if (dragRef.current) return
    setDragPosition(launcherPosition)
  }, [launcherPosition])

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
          console.warn('[hiven] Failed to hide launcher window:', error)
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
          console.warn('[hiven] Failed to restore launcher window:', error)
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
        console.warn('[hiven] Failed to listen for launcher focus changes:', error)
      })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [closeLauncher, open, standaloneLauncher])

  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return

    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel) return
      const desiredPanelHeight = measureStandaloneLauncherPanelHeight(panel)
      const nextHeight = clamp(
        Math.ceil(desiredPanelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        STANDALONE_LAUNCHER_MAX_HEIGHT,
      )
      void getCurrentWindow()
        .setSize(new LogicalSize(STANDALONE_LAUNCHER_WIDTH, nextHeight))
        .catch((error) => {
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [filtered.length, mode, open, standaloneLauncher])

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
            await emitTo('main', 'hiven://run-pinned-action', { id: item.id })
          }
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[hiven] Failed to select launcher item:', error)
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
          console.warn('[hiven] Failed to restore launcher window:', error)
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

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [role="button"], [data-no-drag]')) return
    if (standaloneLauncher && (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
      event.preventDefault()
      event.stopPropagation()
      try {
        void getCurrentWindow().startDragging().catch((error) => {
          console.warn('[hiven] Failed to drag launcher window:', error)
        })
      } catch (error) {
        console.warn('[hiven] Failed to drag launcher window:', error)
      }
      return
    }
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    const initialPosition = { x: rect.left, y: rect.top }
    dragRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      position: initialPosition,
    }
    setDragPosition(initialPosition)
    event.preventDefault()

    const move = (moveEvent: PointerEvent) => {
      const currentPanel = panelRef.current
      const drag = dragRef.current
      if (!currentPanel || !drag) return
      const width = currentPanel.offsetWidth
      const height = currentPanel.offsetHeight
      const next = {
        x: clamp(moveEvent.clientX - drag.offsetX, 8, Math.max(8, window.innerWidth - width - 8)),
        y: clamp(moveEvent.clientY - drag.offsetY, 8, Math.max(8, window.innerHeight - height - 8)),
      }
      drag.position = next
      setDragPosition(next)
    }

    const finish = () => {
      const position = dragRef.current?.position
      dragRef.current = null
      if (position) updateSetting('globalLauncherPosition', position)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }, [standaloneLauncher, updateSetting])

  const currentPosition = standaloneLauncher ? undefined : (dragPosition ?? launcherPosition)
  const panelStyle: CSSProperties = {
    background: 'var(--color-background-primary)',
    border: '0.5px solid var(--color-border-secondary)',
    borderRadius: 'var(--radius-xl)',
    left: currentPosition ? currentPosition.x : '50%',
    top: currentPosition ? currentPosition.y : overlay ? 12 : 70,
    transform: currentPosition ? undefined : 'translateX(-50%)',
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 palette-overlay global-launcher-overlay open"
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      onClick={(event) => { if (event.target === event.currentTarget) closeLauncher() }}
    >
      <div
        ref={panelRef}
        className="global-launcher-panel overflow-hidden outline-none palette-panel"
        style={panelStyle}
        tabIndex={-1}
        onPointerDown={beginDrag}
        onContextMenu={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return
          event.preventDefault()
        }}
        onKeyDown={(event) => {
          if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
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
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
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
        <div className="global-launcher-body">
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
        </div>
        <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
          <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
          <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
          <HintKey keys="esc" label={t(locale, 'palette.back')} />
        </div>
      </div>
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function measureStandaloneLauncherPanelHeight(panel: HTMLElement) {
  const header = panel.querySelector<HTMLElement>('.global-launcher-header')
  const body = panel.querySelector<HTMLElement>('.global-launcher-body')
  const footer = panel.querySelector<HTMLElement>('.global-launcher-footer')
  if (!header || !body || !footer) return panel.getBoundingClientRect().height

  const bodyMaxHeight = readCssPixelValue(getComputedStyle(body).maxHeight, STANDALONE_LAUNCHER_LIST_MAX_HEIGHT)
  return header.offsetHeight + Math.min(body.scrollHeight, bodyMaxHeight) + footer.offsetHeight
}

function readCssPixelValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
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
            className={`cmd-item w-full border-none text-left ${isSelected ? 'selected' : ''}`}
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
