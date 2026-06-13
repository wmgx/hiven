import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { LayoutPanelLeft, Pin, Puzzle, Search, Settings } from 'lucide-react'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { localized, useAppStore, type ViewId } from '../store'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { showToast } from '../workspace/toast'
import { runPluginCommandById } from '../workspace/pluginCommandExecutor'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { isQuickTextCommand, runQuickTextCommand } from '../workspace/quickTextCommand'
import { usePluginSettingsStore, resolvePluginSettings } from '../workspace/pluginSettingsStore'
import { scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../workspace/searchRanking'
import { LauncherController } from '../workspace/launcher/controller'
import type { LauncherControllerState, CollectInputFrame, ResultFrame } from '../workspace/launcher/controller'
import { createPluginLauncherApi } from '../workspace/launcher/pluginApi'
import { collectStaticCandidates, collectDynamicItems, filterDynamicForSurface } from '../workspace/launcher/registry'
import { rankLauncherItems } from '../workspace/launcher/ranking'
import { resolveDisplayTitle, resolveDisplaySubtitle } from '../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem, LauncherSurfaceId } from '../workspace/launcher/types'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'
import type { ContributionSource } from '../workspace/pluginTypes'

type LauncherItem =
  | { kind: 'quick-command'; id: string; title: string; subtitle: string; icon?: string; commandId: string; isDev: boolean }
  | { kind: 'command'; id: string; title: string; subtitle: string; icon?: string; isDev?: boolean }
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string; actionId: string }
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
  const recentActionNames = useAppStore((s) => s.actionUsageBySource['global-launcher'].recentActionNames)
  const actionUsageCounts = useAppStore((s) => s.actionUsageBySource['global-launcher'].actionUsageCounts)
  const pushRecentAction = useAppStore((s) => s.pushRecentAction)
  const launcherPosition = useAppStore((s) => s.settings.globalLauncherPosition)
  const updateSetting = useAppStore((s) => s.updateSetting)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const pluginSettingsData = usePluginSettingsStore((s) => s.pluginSettings)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const controllerRef = useRef<LauncherController | null>(null)
  const [dynamicItems, setDynamicItems] = useState<DomainLauncherItem[]>([])
  const dynamicQueryRef = useRef('')
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [dragPosition, setDragPosition] = useState(launcherPosition)
  const [quickTextSession, setQuickTextSession] = useState<{
    commandId: string
    isDev: boolean
    title: string
    icon?: string
    inputText: string
    outputText: string
    outputKind: 'text' | 'error'
    running: boolean
    error?: string
  } | null>(null)
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
      setQuickTextSession(null)
      inputRef.current?.focus()
    })
  }, [open])

  // Initialize LauncherController on open
  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setDynamicItems([])
      dynamicQueryRef.current = ''
      if (!controllerRef.current) {
        const controller = new LauncherController({
          surfaceId: 'global-launcher' as LauncherSurfaceId,
          api: createPluginLauncherApi(),
          locale,
          makeT: (item) => makePluginT(item.pluginId ?? '', locale),
          getSettings: (item) => {
            if (!item.pluginId || !item.source) return undefined
            const def = pluginRegistry.getPluginDefinition(item.pluginId, item.source)
            const settingsContribution = def?.settings
            if (!settingsContribution) return undefined
            return resolvePluginSettings(item.source, item.pluginId, settingsContribution).value
          },
          recordSelection: (surfaceId, item) => {
            recordLauncherSelection(surfaceId, item.systemKey)
          },
          requestClose: () => closeLauncher(),
          onChange: (state) => setControllerState({ ...state }),
        })
        controllerRef.current = controller
      }
      controllerRef.current.reset()
    })
    return () => { cancelled = true }
  }, [open])

  // Collect dynamic items with debounce
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) { setDynamicItems([]); dynamicQueryRef.current = ''; return }
    dynamicQueryRef.current = q
    const timer = setTimeout(async () => {
      if (dynamicQueryRef.current !== q) return
      const getSettingsForPlugin = (pluginId: string, source: ContributionSource) => {
        const def = pluginRegistry.getPluginDefinition(pluginId, source)
        const settingsContribution = def?.settings
        if (!settingsContribution) return undefined
        const settingsSource = resolvePluginSettingsSource(pluginId, source)
        return resolvePluginSettings(settingsSource, pluginId, settingsContribution).value
      }
      const items = await collectDynamicItems(q, locale, getSettingsForPlugin)
      if (dynamicQueryRef.current !== q) return
      setDynamicItems(filterDynamicForSurface(items, 'global-launcher'))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, open, locale])

  // Domain ranked items (new launcher system)
  const rankedLauncherItems = useMemo<DomainLauncherItem[]>(() => {
    void pluginRegistryVersion
    const staticCandidates = collectStaticCandidates('global-launcher')
    const allCandidates = [...staticCandidates, ...dynamicItems]
    const q = query.trim()
    return rankLauncherItems(
      { query: q, locale, surfaceId: 'global-launcher', usage: launcherUsageBySurface, now: Date.now() },
      allCandidates,
    )
  }, [query, locale, pluginRegistryVersion, dynamicItems, launcherUsageBySurface])

  const items = useMemo<LauncherItem[]>(() => {
    void pluginRegistryVersion
    void pluginSettingsData
    const pinnedLabel = t(locale, 'palette.globalPinned')
    const commandsLabel = t(locale, 'palette.globalCommands')
    const quickTextLabel = t(locale, 'palette.quickText')
    const pinned = pinnedActions.map((item) => {
      const command = pluginRegistry.resolveCommand(item.actionId, item.isDev ? 'dev' : 'production')?.contribution
      return {
        kind: 'pinned' as const,
        id: item.id,
        title: localized(command?.title ?? item.title, command?.titleI18n ?? item.titleI18n, locale),
        subtitle: pinnedLabel,
        icon: command?.icon ?? item.icon,
        actionId: item.actionId,
      }
    })
    const mainPanelCommand = pluginRegistry.resolveCommand('core-pane.show-main-panel')
    const launcherCommands: LauncherItem[] = mainPanelCommand ? [{
      kind: 'command',
      id: mainPanelCommand.contribution.id,
      title: localized(mainPanelCommand.contribution.title, mainPanelCommand.contribution.titleI18n, locale),
      subtitle: commandsLabel,
      icon: mainPanelCommand.contribution.icon,
      isDev: false,
    }] : []

    // Add quick text commands (always available regardless of mode)
    // Skip commands already covered by launcher tools (avoid duplicate entries)
    const staticItems = collectStaticCandidates('global-launcher')
    const coveredByLauncher = new Set<string>()
    for (const item of staticItems) {
      if (item.legacyUsageKeys) {
        for (const key of item.legacyUsageKeys) coveredByLauncher.add(key)
      }
    }
    const quickCommands: LauncherItem[] = []
    const allCommands = pluginRegistry.getAllCommands()
    for (const { contribution, meta } of allCommands) {
      if (coveredByLauncher.has(contribution.id)) continue
      if (isQuickTextCommand(contribution)) {
        const pluginT = makePluginT(meta.pluginId, locale)
        const title = contribution.titleI18n
          ? localized(contribution.title, contribution.titleI18n, locale)
          : pluginT(contribution.title)
        quickCommands.push({
          kind: 'quick-command',
          id: `quick:${contribution.id}`,
          title,
          subtitle: quickTextLabel,
          icon: contribution.icon,
          commandId: contribution.id,
          isDev: meta.source === 'dev',
        })
      }
    }

    if ('pinned-only' === mode) return [...pinned, ...launcherCommands, ...quickCommands]

    const recentLabel = t(locale, 'palette.globalRecent')
    const viewsLabel = t(locale, 'palette.globalViews')
    const recent: LauncherItem[] = []
    for (const name of recentActionNames) {
      if (recent.length >= 8) break
      if (name.startsWith('launcher-entry:')) continue
      const resolved = pluginRegistry.resolveCommand(name)
      if (!resolved) continue
      const command = resolved.contribution
      recent.push({
        kind: 'command' as const,
        id: command.id,
        title: localized(command.title || name, command.titleI18n, locale),
        subtitle: recentLabel,
        icon: command.icon,
        isDev: resolved.meta.source === 'dev',
      })
    }
    const views = viewItems.map((item) => ({
      kind: 'view' as const,
      id: item.id,
      title: localized(item.title, item.titleI18n, locale),
      subtitle: viewsLabel,
      icon: item.icon,
    }))
    return [...pinned, ...launcherCommands, ...quickCommands, ...recent, ...views]
  }, [locale, mode, pinnedActions, recentActionNames, pluginRegistryVersion, pluginSettingsData])

  const filtered = useMemo(() => {
    void pluginRegistryVersion
    const q = query.trim().toLowerCase()
    const base = q ? items.filter((item) => launcherItemMatchesQuery(item, q, locale)) : items
    const sortedBase = [...base].sort((a, b) =>
      scoreLauncherItem(b, q, locale, recentActionNames, actionUsageCounts) -
      scoreLauncherItem(a, q, locale, recentActionNames, actionUsageCounts)
    )

    // Merge domain ranked items alongside legacy — single sorted list (constraint 1)
    // Dedup: legacy items whose command id is already covered by a domain item are skipped
    const domainCoveredIds = new Set<string>()
    for (const domainItem of rankedLauncherItems) {
      domainCoveredIds.add(domainItem.systemKey)
      if (domainItem.legacyUsageKeys) {
        for (const key of domainItem.legacyUsageKeys) domainCoveredIds.add(key)
      }
      // tool/launcher items: extract the item-id suffix as the backing command id
      const parsed = domainItem.systemKey.split(':')
      if (parsed.length >= 4) domainCoveredIds.add(parsed.slice(3).join(':'))
    }
    const dedupedBase = sortedBase.filter((item) => !domainCoveredIds.has(item.id))

    const domainAsLegacy: LauncherItem[] = rankedLauncherItems.map((domainItem) => ({
      kind: 'command' as const,
      id: domainItem.systemKey,
      title: resolveDisplayTitle(domainItem.display, locale),
      subtitle: resolveDisplaySubtitle(domainItem.display, locale) ?? '',
      icon: domainItem.display.icon,
      isDev: domainItem.source === 'dev',
      __domainItem: domainItem,
    } as LauncherItem & { __domainItem: DomainLauncherItem }))

    return [...domainAsLegacy, ...dedupedBase]
  }, [items, query, locale, pluginRegistryVersion, recentActionNames, actionUsageCounts, rankedLauncherItems])

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
  const selectedItem = filtered.length === 1 ? filtered[0] : filtered[clampedSelectedIndex]

  // Quick text preview effect
  useEffect(() => {
    if (!quickTextSession) return
    const entry = pluginRegistry.resolveCommand(quickTextSession.commandId, quickTextSession.isDev ? 'dev' : 'production')
    if (!entry) return
    if (!quickTextSession.inputText) {
      setQuickTextSession((session) => session ? { ...session, outputText: '', outputKind: 'text', running: false, error: undefined } : session)
      return
    }

    let cancelled = false
    setQuickTextSession((session) => session ? { ...session, running: true, error: undefined } : session)
    const timer = window.setTimeout(() => {
      void runQuickTextCommand(entry.contribution, {
        inputText: quickTextSession.inputText,
        isDev: quickTextSession.isDev,
        ownerPluginId: entry.meta.pluginId,
      }).then((output) => {
        if (cancelled) return
        setQuickTextSession((session) => session ? {
          ...session,
          outputText: output.text,
          outputKind: output.kind,
          running: false,
          error: undefined,
        } : session)
      }).catch((error) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setQuickTextSession((session) => session ? {
          ...session,
          outputText: message,
          outputKind: 'error',
          running: false,
          error: message,
        } : session)
      })
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [quickTextSession?.commandId, quickTextSession?.isDev, quickTextSession?.inputText])

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
  }, [
    filtered.length,
    mode,
    open,
    quickTextSession?.inputText.length,
    quickTextSession?.outputText.length,
    quickTextSession?.running,
    controllerState,
    standaloneLauncher,
  ])

  async function copyQuickTextOutput(session: NonNullable<typeof quickTextSession>) {
    if (!session.outputText || session.outputKind === 'error') return
    try {
      const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
      await writeText(session.outputText)
      pushRecentAction(session.commandId, 'global-launcher')
      showToast(t(locale, 'palette.copied'), 'success')
      closeLauncher()
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      showToast(message, 'error')
    }
  }

  const selectItem = (item: LauncherItem | undefined) => {
    if (!item) return

    // Domain item path (new launcher system via controller)
    const domainItem = (item as LauncherItem & { __domainItem?: DomainLauncherItem }).__domainItem
    if (domainItem && controllerRef.current) {
      if (standaloneLauncher) {
        // Constraint 3: record selection BEFORE bridge execution
        recordLauncherSelection('global-launcher', domainItem.systemKey)
        void (async () => {
          try {
            const { emitTo } = await import('@tauri-apps/api/event')
            const { invoke } = await import('@tauri-apps/api/core')
            await emitTo('main', 'hiven://run-plugin-command', { id: domainItem.systemKey, isDev: domainItem.source === 'dev' })
            await invoke('hide_launcher_window')
          } catch (error) {
            console.warn('[hiven] Failed to select domain launcher item:', error)
          }
          setOpen(false)
        })()
        return
      }
      // Non-standalone: controller handles record + execute + lifecycle (output/collect-input frames)
      void controllerRef.current.selectItem(domainItem)
      return
    }

    if (item.kind === 'quick-command') {
      setQuickTextSession({
        commandId: item.commandId,
        isDev: item.isDev,
        title: item.title,
        icon: item.icon,
        inputText: '',
        outputText: '',
        outputKind: 'text',
        running: false,
      })
      setQuery('')
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
      return
    }
    // Record usage for global-launcher before executing
    if (item.kind === 'command') {
      pushRecentAction(item.id, 'global-launcher')
    }
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { emitTo } = await import('@tauri-apps/api/event')
          const { invoke } = await import('@tauri-apps/api/core')
          if (item.kind === 'pinned') {
            await emitTo('main', 'hiven://run-pinned-action', { id: item.id })
          }
          if (item.kind === 'command') {
            await emitTo('main', 'hiven://run-plugin-command', { id: item.id, isDev: item.isDev === true })
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
        if (item.kind === 'command') {
          void runPluginCommandById(item.id, { isDev: item.isDev })
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
      if (item.kind === 'command') {
        void runPluginCommandById(item.id, { isDev: item.isDev })
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
          if (quickTextSession && event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            setQuickTextSession(null)
            setQuery('')
            setSelectedIndex(0)
            requestAnimationFrame(() => inputRef.current?.focus())
            return
          }
          if (quickTextSession && event.key === 'Enter') {
            event.preventDefault()
            void copyQuickTextOutput(quickTextSession)
            return
          }
          // Controller frame key handling (collect-input / result)
          if (controllerState && controllerState.frames.length > 1) {
            const topFrame = controllerState.frames[controllerState.frames.length - 1]
            if (topFrame.kind === 'collect-input') {
              if (event.key === 'Enter') {
                event.preventDefault()
                void controllerRef.current?.submitInput()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                requestAnimationFrame(() => inputRef.current?.focus())
                return
              }
              if (event.key === 'Backspace' && !(topFrame as CollectInputFrame).inputText) {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                requestAnimationFrame(() => inputRef.current?.focus())
                return
              }
              return // other keys pass to input naturally
            }
            if (topFrame.kind === 'result') {
              if (event.key === 'Enter') {
                event.preventDefault()
                const choices = (topFrame as ResultFrame).output.choices
                if (choices.length > 0) {
                  void controllerRef.current?.activateChoice(choices[0])
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                requestAnimationFrame(() => inputRef.current?.focus())
                return
              }
              return
            }
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            closeLauncher()
            return
          }
          if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1))) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => Math.max(index - 1, 0)) }
          if (event.key === 'Enter') { event.preventDefault(); selectItem(selectedItem) }
        }}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        {quickTextSession ? (
          <>
            <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
              {resolveIcon(quickTextSession.icon, 16, quickTextSession.title)}
              <input
                ref={inputRef}
                value={quickTextSession.inputText}
                onChange={(event) => setQuickTextSession((session) => session ? { ...session, inputText: event.target.value } : session)}
                placeholder={t(locale, 'palette.quickTextPlaceholder', { title: quickTextSession.title })}
                className="flex-1 outline-none border-none bg-transparent text-[14px]"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div className="global-launcher-quick-preview px-3.5 py-2">
              <div className="global-launcher-quick-preview-label text-[10px] uppercase tracking-[0.08em] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                {quickTextSession.running ? t(locale, 'palette.running') : t(locale, 'palette.preview')}
              </div>
              <pre
                className="max-h-[200px] overflow-auto whitespace-pre-wrap break-words text-[13px] m-0 p-2 rounded-md"
                style={{
                  background: 'var(--color-background-secondary)',
                  color: quickTextSession.outputKind === 'error' ? 'var(--color-error)' : 'var(--color-text-primary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {quickTextSession.outputText}
              </pre>
            </div>
            <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
              <HintKey keys="esc" label={t(locale, 'palette.back')} />
            </div>
          </>
        ) : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'collect-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as CollectInputFrame
          const placeholder = frame.item.behavior.type === 'collect-input'
            ? (frame.item.behavior.input.placeholder ?? '')
            : ''
          return (
            <>
              <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {resolveIcon(frame.item.display.icon, 16, resolveDisplayTitle(frame.item.display, locale))}
                <input
                  ref={inputRef}
                  value={frame.inputText}
                  onChange={(event) => controllerRef.current?.setInputText(event.target.value)}
                  placeholder={placeholder}
                  className="flex-1 outline-none border-none bg-transparent text-[14px]"
                  style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
                />
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <HintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'result' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ResultFrame
          const choices = frame.output.choices
          return (
            <>
              <div className="global-launcher-header flex items-center gap-2 px-3.5 py-2.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                  {frame.sourceTitle}
                </span>
              </div>
              <div className="global-launcher-body">
                {choices.map((choice, index) => (
                  <button
                    key={choice.id}
                    className={`w-full flex items-center gap-2 px-3.5 py-2 text-left text-[13px] hover:bg-[var(--color-background-secondary)] ${index === 0 ? 'bg-[var(--color-background-secondary)]' : ''}`}
                    style={{ color: 'var(--color-text-primary)' }}
                    onClick={() => void controllerRef.current?.activateChoice(choice)}
                  >
                    <span className="flex-1 truncate">{choice.title}</span>
                    {choice.subtitle && (
                      <span className="text-[11px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                        {choice.subtitle}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : (
          <>
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
              <LauncherList
                items={filtered}
                selected={selectedItem}
                onSelect={selectItem}
              />
            </div>
            <div className="global-launcher-footer flex shrink-0 gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
              <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
              <HintKey keys="esc" label={t(locale, 'palette.back')} />
            </div>
          </>
        )}
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
  const preview = panel.querySelector<HTMLElement>('.global-launcher-quick-preview')
  const footer = panel.querySelector<HTMLElement>('.global-launcher-footer')
  if (!header || !footer) return panel.getBoundingClientRect().height

  if (preview) {
    return header.offsetHeight + preview.offsetHeight + footer.offsetHeight
  }

  if (!body) return panel.getBoundingClientRect().height
  const bodyMaxHeight = readCssPixelValue(getComputedStyle(body).maxHeight, STANDALONE_LAUNCHER_LIST_MAX_HEIGHT)
  return header.offsetHeight + Math.min(body.scrollHeight, bodyMaxHeight) + footer.offsetHeight
}

function readCssPixelValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}



function isStandaloneLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}

function LauncherList({ items, selected, onSelect }: { items: LauncherItem[]; selected?: LauncherItem; onSelect: (item: LauncherItem) => void }) {
  if (items.length === 0) return null
  return (
    <div className="py-1">
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

function launcherItemMatchesQuery(item: LauncherItem, q: string, locale: Locale): boolean {
  return searchableFieldsMatch(launcherItemSearchFields(item), q, locale)
}

function scoreLauncherItem(
  item: LauncherItem,
  q: string,
  locale: Locale,
  recentNames: string[],
  usageCounts: Record<string, number>,
): number {
  return scoreSearchableFields(launcherItemSearchFields(item), q, locale, recentNames, usageCounts)
}

function launcherItemSearchFields(item: LauncherItem): SearchableFields {
  return {
    id: launcherItemSearchId(item),
    title: item.title,
    description: item.subtitle,
    usageKey: launcherItemUsageKey(item),
  }
}

function launcherItemSearchId(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  if (item.kind === 'quick-command') return item.commandId
  if (item.kind === 'view') return `view:${item.id}`
  return item.id
}

function launcherItemUsageKey(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  if (item.kind === 'quick-command') return item.commandId
  return item.id
}
