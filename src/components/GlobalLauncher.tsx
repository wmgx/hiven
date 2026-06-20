import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Pin, Search } from 'lucide-react'
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window'
import { localized, useAppStore, type PluginSurfaceOpenTarget } from '../store'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { resolvePluginSettings, usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../workspace/searchRanking'
import { LauncherController } from '../workspace/launcher/controller'
import type { LauncherControllerState, CollectInputFrame, ParamInputFrame, ResultFrame } from '../workspace/launcher/controller'
import { createPluginLauncherApi, createPluginLauncherStorage } from '../workspace/launcher/pluginApi'
import { collectStaticCandidates, collectDynamicItems, filterDynamicForSurface } from '../workspace/launcher/registry'
import { rankLauncherItems } from '../workspace/launcher/ranking'
import { resolveDisplayTitle, resolveDisplaySubtitle } from '../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem, LauncherResultChoice, LauncherSurfaceId } from '../workspace/launcher/types'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'
import { LauncherParamStep, resolveParamValueLabel } from './launcher/LauncherParamStep'
import { PluginSettingsContent } from './PluginSettingsDialog'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsDefaultParamRun, supportsParamCustomization } from './launcher/launcherParamShortcuts'
import type { ContributionSource, PluginDefinition, PluginPermission } from '../workspace/pluginTypes'
import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createPluginClipboard } from '../workspace/pluginClipboard'
import { createPluginPaste } from '../workspace/pluginPaste'
import { describePluginPermission, getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { restartPluginBackground } from '../workspace/pluginBackgroundManager'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from '../workspace/launcherWindowEvents'

type LauncherItem =
  | { kind: 'domain'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; domainItem: DomainLauncherItem }
  | { kind: 'pinned'; id: string; title: string; subtitle: string; icon?: string; aliases?: string[]; actionId: string }

const GLOBAL_LAUNCHER_PANEL_WIDTH = 680
const STANDALONE_LAUNCHER_WIDTH = 728
const STANDALONE_LAUNCHER_MIN_HEIGHT = 160
const STANDALONE_LAUNCHER_MAX_HEIGHT = 390
const STANDALONE_SURFACE_MAX_WIDTH = 920
const STANDALONE_SURFACE_MAX_HEIGHT = 760
const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24
const STANDALONE_LAUNCHER_LIST_MAX_HEIGHT = 300
const GLOBAL_LAUNCHER_SETTINGS_WIDTH = 720
const GLOBAL_LAUNCHER_SETTINGS_HEIGHT = 560
const PLUGIN_SURFACE_BACK_EVENT = 'hiven:plugin-surface-back'
const PLUGIN_SURFACE_CLOSE_EVENT = 'hiven:plugin-surface-close'

export function GlobalLauncher() {
  const open = useAppStore((s) => s.globalLauncherOpen)
  const mode = useAppStore((s) => s.globalLauncherMode)
  const overlay = useAppStore((s) => s.globalLauncherOverlay)
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const openPinnedAction = useAppStore((s) => s.openPinnedAction)
  const pinnedActions = useAppStore((s) => s.pinnedActions)
  const recentActionNames = useAppStore((s) => s.actionUsageBySource['global-launcher'].recentActionNames)
  const actionUsageCounts = useAppStore((s) => s.actionUsageBySource['global-launcher'].actionUsageCounts)
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const pluginPermissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginSurfaceToolTarget = useAppStore((s) => s.pluginSurfaceToolTarget)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [launcherController, setLauncherController] = useState<LauncherController | null>(null)
  const controllerRef = useRef<LauncherController | null>(null)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const [dynamicItems, setDynamicItems] = useState<DomainLauncherItem[]>([])
  const [surfaceFrame, setSurfaceFrame] = useState<{ source: PluginSettingsSource; pluginId: string; surfaceId: string } | null>(null)
  const [itemPermissionFrame, setItemPermissionFrame] = useState<{
    item: DomainLauncherItem
    source: PluginSettingsSource
    pluginId: string
    permissions: PluginPermission[]
    customizeParams: boolean
  } | null>(null)
  const [surfaceFocusVersion, setSurfaceFocusVersion] = useState(0)
  const [rankingNow, setRankingNow] = useState(0)
  const dynamicQueryRef = useRef('')
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [resultSelectedIndex, setResultSelectedIndex] = useState(0)
  const [selectedResultChoiceIds, setSelectedResultChoiceIds] = useState<Set<string>>(() => new Set())
  const isKeyboardNavRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isImeComposingRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    })
  }, [open])

  useEffect(() => {
    if (open) return
    setSurfaceFrame(null)
    setDynamicItems([])
    dynamicQueryRef.current = ''
    controllerRef.current?.reset()
  }, [open])

  useEffect(() => {
    if (!open || !pluginSurfaceToolTarget) return
    const timer = window.setTimeout(() => {
      setSurfaceFrame(pluginSurfaceToolTarget)
      setSurfaceFocusVersion((version) => version + 1)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, pluginSurfaceToolTarget])

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
          makeApi: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            return createPluginLauncherApi({
              pluginId: item.pluginId,
              source: item.source,
              requestedPermissions,
            })
          },
          getStorage: (item) => {
            const requestedPermissions = item.pluginId && item.source
              ? pluginRegistry.getPluginPermissions(item.pluginId, item.source)
              : []
            return createPluginLauncherStorage({
              pluginId: item.pluginId,
              source: item.source,
              requestedPermissions,
            })
          },
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
          requestClose: () => closeAfterActionRef.current(),
          onChange: (state) => setControllerState({ ...state }),
        })
        controllerRef.current = controller
        setLauncherController(controller)
      }
      controllerRef.current.reset()
    })
    return () => { cancelled = true }
  }, [locale, open, recordLauncherSelection])

  // Collect dynamic items with debounce
  useEffect(() => {
    if (!open) return
    const q = query.trim()
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
      const items = await collectDynamicItems(q, 'global-launcher', locale, getSettingsForPlugin)
      if (dynamicQueryRef.current !== q) return
      setDynamicItems(filterDynamicForSurface(items, 'global-launcher'))
    }, q ? 150 : 0)
    return () => clearTimeout(timer)
  }, [query, open, locale])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => setRankingNow(Date.now()), 0)
    return () => window.clearTimeout(timer)
  }, [open, query, dynamicItems.length])

  // Domain ranked items (new launcher system)
  const rankedLauncherItems = useMemo<DomainLauncherItem[]>(() => {
    void pluginRegistryVersion
    const staticCandidates = collectStaticCandidates('global-launcher')
    const allCandidates = [...staticCandidates, ...dynamicItems]
    const q = query.trim()
    return rankLauncherItems(
      { query: q, locale, surfaceId: 'global-launcher', usage: launcherUsageBySurface, now: rankingNow },
      allCandidates,
    )
  }, [query, locale, pluginRegistryVersion, dynamicItems, launcherUsageBySurface, rankingNow])

  const activeSurfaceFrame = useMemo(() => {
    void pluginRegistryVersion
    if (!surfaceFrame) return null
    const def = pluginRegistry.getPluginDefinition(surfaceFrame.pluginId, surfaceFrame.source) as PluginDefinition<unknown> | undefined
    const surface = def?.ui?.surfaces?.find((s) => s.id === surfaceFrame.surfaceId)
    if (!def || !surface) return null
    return { definition: def, surface }
  }, [surfaceFrame, pluginRegistryVersion])

  const items = useMemo<LauncherItem[]>(() => {
    const pinnedLabel = t(locale, 'palette.globalPinned')
    const pinned = pinnedActions.map((item) => ({
      kind: 'pinned' as const,
      id: item.id,
      title: localized(item.title, item.titleI18n, locale),
      subtitle: pinnedLabel,
      icon: item.icon,
      actionId: item.actionId,
    }))

    if ('pinned-only' === mode) return pinned
    return pinned
  }, [locale, mode, pinnedActions])

  const filtered = useMemo(() => {
    void pluginRegistryVersion
    const q = query.trim().toLowerCase()
    const base = q ? items.filter((item) => launcherItemMatchesQuery(item, q, locale)) : items
    const sortedBase = [...base].sort((a, b) =>
      scoreLauncherItem(b, q, locale, recentActionNames, actionUsageCounts) -
      scoreLauncherItem(a, q, locale, recentActionNames, actionUsageCounts)
    )

    const domainItems: LauncherItem[] = rankedLauncherItems.map((domainItem) => ({
      kind: 'domain' as const,
      id: domainItem.systemKey,
      title: resolveDisplayTitle(domainItem.display, locale),
      subtitle: resolveDisplaySubtitle(domainItem.display, locale) ?? '',
      icon: domainItem.display.icon,
      aliases: domainItem.display.aliases,
      domainItem,
    }))

    return [...domainItems, ...sortedBase]
  }, [items, query, locale, pluginRegistryVersion, recentActionNames, actionUsageCounts, rankedLauncherItems])
  const visibleFiltered = filtered

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

  const resetLauncherSession = useCallback(() => {
    clearPluginSurfaceTool()
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    if (usePluginSettingsStore.getState().settingsDialogTarget?.presentation === 'global-launcher') {
      closeSettingsDialog()
    }
    setQuery('')
    setSelectedIndex(0)
    setDynamicItems([])
    dynamicQueryRef.current = ''
    controllerRef.current?.reset()
  }, [clearPluginSurfaceTool, closeSettingsDialog])

  const closeLauncher = useCallback(() => {
    const wasOverlay = overlay
    resetLauncherSession()
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[hiven] Failed to hide launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
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
        restoreFocus()
      })()
      return
    }
    setOpen(false)
    restoreFocus()
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  // Close launcher after a command has been executed (don't hide the main window)
  const closeLauncherAfterAction = useCallback(() => {
    resetLauncherSession()
    if (standaloneLauncher) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          await invoke('hide_launcher_window')
        } catch (error) {
          console.warn('[hiven] Failed to hide launcher window:', error)
        }
        setOpen(false)
        restoreFocus()
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
        restoreFocus()
      })()
      return
    }
    setOpen(false)
    restoreFocus()
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  useEffect(() => {
    closeAfterActionRef.current = closeLauncherAfterAction
  }, [closeLauncherAfterAction])

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

  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))
  const selectedItem = visibleFiltered.length === 1 ? visibleFiltered[0] : visibleFiltered[clampedSelectedIndex]
  const activeResultFrame = controllerState?.frames.length
    ? controllerState.frames[controllerState.frames.length - 1]
    : null

  useEffect(() => {
    if (activeResultFrame?.kind !== 'result') return
    setResultSelectedIndex(0)
    setSelectedResultChoiceIds(new Set())
  }, [activeResultFrame?.kind, activeResultFrame?.kind === 'result' ? activeResultFrame.sourceTitle : undefined])

  function focusSearchInputAfterBack() {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  // Focus input when entering collect-input frame
  useEffect(() => {
    if (!open || !controllerState || controllerState.frames.length <= 1) return
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind !== 'collect-input') return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open, controllerState])

  useEffect(() => {
    if (!open || !controllerState || controllerState.frames.length <= 1) return
    if (controllerState.busy) return
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind !== 'collect-input') return
    if (topFrame.item.behavior.type !== 'perform' || topFrame.item.inputPolicy == null) return
    if (topFrame.previewInputText === topFrame.inputText) return
    const timer = window.setTimeout(() => {
      void controllerRef.current?.previewInput()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [controllerState, open])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return

    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const surfaceShell = activeSurfaceFrame?.surface.shell
      const desiredPanelHeight = launcherSettingsTarget
        ? GLOBAL_LAUNCHER_SETTINGS_HEIGHT
        : surfaceShell?.defaultHeight
        ? surfaceShell.defaultHeight
        : measureStandaloneLauncherPanelHeight(panel)
      const nextHeight = clamp(
        Math.ceil(desiredPanelHeight + STANDALONE_LAUNCHER_VERTICAL_PADDING),
        STANDALONE_LAUNCHER_MIN_HEIGHT,
        surfaceShell || launcherSettingsTarget ? STANDALONE_SURFACE_MAX_HEIGHT : STANDALONE_LAUNCHER_MAX_HEIGHT,
      )
      const desiredPanelWidth = launcherSettingsTarget
        ? GLOBAL_LAUNCHER_SETTINGS_WIDTH
        : surfaceShell?.defaultWidth ?? GLOBAL_LAUNCHER_PANEL_WIDTH
      const nextWidth = clamp(
        Math.ceil(desiredPanelWidth + STANDALONE_LAUNCHER_HORIZONTAL_PADDING),
        STANDALONE_LAUNCHER_WIDTH,
        surfaceShell || launcherSettingsTarget ? STANDALONE_SURFACE_MAX_WIDTH : STANDALONE_LAUNCHER_WIDTH,
      )
      window.dispatchEvent(new CustomEvent(LAUNCHER_PROGRAMMATIC_MOVE_EVENT))
      void getCurrentWindow()
        .setSize(new LogicalSize(nextWidth, nextHeight))
        .catch((error) => {
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    }, 50)

    return () => window.clearTimeout(timer)
  }, [
    visibleFiltered.length,
    mode,
    open,
    controllerState,
    standaloneLauncher,
    activeSurfaceFrame,
    launcherSettingsTarget,
  ])

  const selectItem = (item: LauncherItem | undefined, customizeParams = false) => {
    if (!item) return

    if (item.kind === 'domain') {
      // Intercept plugin surface items — render surface instead of execute
      if (item.domainItem.systemKey.startsWith('plugin-surface:')) {
        const parts = item.domainItem.systemKey.split(':')
        // format: plugin-surface:source:pluginId:surfaceId
        const source = parts[1]
        const pluginId = parts[2]
        const surfaceId = parts[3]
        if (isPluginSettingsSource(source) && pluginId && surfaceId) {
          clearPluginSurfaceTool()
          setSurfaceFrame({ source, pluginId, surfaceId })
          setSurfaceFocusVersion((version) => version + 1)
          return
        }
      }

      const missingPermissions = missingPluginItemPermissions(item.domainItem)
      if (missingPermissions.length > 0 && item.domainItem.pluginId && item.domainItem.source) {
        setItemPermissionFrame({
          item: item.domainItem,
          source: item.domainItem.source,
          pluginId: item.domainItem.pluginId,
          permissions: missingPermissions,
          customizeParams,
        })
        return
      }

      executeDomainItem(item.domainItem, customizeParams)
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
        restoreFocus()
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
        restoreFocus()
        if (item.kind === 'pinned') {
          openPinnedAction(item.id)
          return
        }
      })()
    } else {
      setOpen(false)
      restoreFocus()
      if (item.kind === 'pinned') {
        openPinnedAction(item.id)
        return
      }
    }
  }

  function executeDomainItem(item: DomainLauncherItem, customizeParams = false) {
    const controller = controllerRef.current
    if (!controller) {
      console.warn('[hiven] Cannot select domain launcher item before controller is ready:', item.systemKey)
      return
    }
    if (!customizeParams && !supportsDefaultParamRun(item)) {
      void controller.selectItem(item, { customizeParams: true })
      return
    }
    void controller.selectItem(item, { customizeParams })
  }

  function missingPluginItemPermissions(item: DomainLauncherItem): PluginPermission[] {
    if (!item.pluginId || !item.source) return []
    const requestedPermissions = pluginRegistry.getPluginPermissions(item.pluginId, item.source)
    if (requestedPermissions.length === 0) return []
    const permissions = getPluginPermissionSnapshot(item.source, item.pluginId, requestedPermissions)
    return missingPluginPermissions(permissions, requestedPermissions)
  }

  function grantItemPermissionsAndRun() {
    if (!itemPermissionFrame) return
    grantPluginPermissions(itemPermissionFrame.source, itemPermissionFrame.pluginId, itemPermissionFrame.permissions)
    void restartPluginBackground(itemPermissionFrame.pluginId, itemPermissionFrame.source)
    const item = itemPermissionFrame.item
    const customizeParams = itemPermissionFrame.customizeParams
    setItemPermissionFrame(null)
    executeDomainItem(item, customizeParams)
  }

  function cancelItemPermissionPrompt() {
    setItemPermissionFrame(null)
    focusSearchInputAfterBack()
  }

  const activateResultChoice = useCallback((choice: LauncherResultChoice) => {
    void launcherController?.activateChoice(choice)
  }, [launcherController])

  const toggleResultChoice = useCallback((choice: LauncherResultChoice, frame: ResultFrame) => {
    const selection = frame.output.selection
    if (selection?.type !== 'multi') {
      activateResultChoice(choice)
      return
    }
    setSelectedResultChoiceIds((current) => {
      const next = new Set(current)
      if (next.has(choice.id)) {
        next.delete(choice.id)
      } else if (next.size < selection.max) {
        next.add(choice.id)
      }
      if (next.size >= selection.max) {
        const selectedChoices = frame.output.choices.filter((item) => next.has(item.id))
        queueMicrotask(() => { void launcherController?.submitResultSelection(selectedChoices) })
      }
      return next
    })
  }, [activateResultChoice, launcherController])

  const leaveSurface = useCallback(() => {
    if (surfaceFrame && pluginSurfaceToolTarget && samePluginSurfaceTarget(surfaceFrame, pluginSurfaceToolTarget)) {
      closeLauncher()
      return
    }
    setSurfaceFrame(null)
  }, [closeLauncher, pluginSurfaceToolTarget, surfaceFrame])

  const closeSurface = useCallback(() => {
    setSurfaceFrame(null)
    closeLauncher()
  }, [closeLauncher])

  const requestSurfaceBack = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLUGIN_SURFACE_BACK_EVENT))
  }, [])

  const requestSurfaceClose = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLUGIN_SURFACE_CLOSE_EVENT))
  }, [])

  const leaveCrashedSurface = useCallback(() => {
    setSurfaceFrame(null)
  }, [])

  const handleHostEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
    if (event.key === 'Escape' && launcherSettingsTarget) {
      event.preventDefault()
      event.stopPropagation()
      closeSettingsDialog()
      focusSearchInputAfterBack()
      return
    }
    if (settingsDialogTarget) return
    event.preventDefault()
    event.stopPropagation()

    if (surfaceFrame) {
      leaveSurface()
      return
    }

    if (itemPermissionFrame) {
      cancelItemPermissionPrompt()
      return
    }

    if (controllerRef.current?.back()) {
      focusSearchInputAfterBack()
      return
    }

    closeLauncher()
  }, [closeLauncher, closeSettingsDialog, itemPermissionFrame, launcherSettingsTarget, leaveSurface, settingsDialogTarget, surfaceFrame])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleHostEscape, true)
    return () => window.removeEventListener('keydown', handleHostEscape, true)
  }, [handleHostEscape, open])

  useEffect(() => {
    if (!open) return
    window.addEventListener(PLUGIN_SURFACE_BACK_EVENT, leaveSurface)
    window.addEventListener(PLUGIN_SURFACE_CLOSE_EVENT, closeSurface)
    return () => {
      window.removeEventListener(PLUGIN_SURFACE_BACK_EVENT, leaveSurface)
      window.removeEventListener(PLUGIN_SURFACE_CLOSE_EVENT, closeSurface)
    }
  }, [closeSurface, leaveSurface, open])

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [role="button"], [data-no-drag], [data-launcher-scrollable]')) return
    // Only the standalone launcher window is draggable, via the native Tauri
    // window drag. Its position (with TTL) is persisted in App.tsx `onMoved`.
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
    }
  }, [standaloneLauncher])

  // The launcher is always horizontally centered. In the standalone window the
  // window itself is positioned natively (see `center_launcher_window`); here
  // the panel just centers within whatever window renders it.
  const panelStyle: CSSProperties & Record<'--launcher-panel-width', string> = {
    background: 'var(--panel, #ffffff)',
    border: '1px solid var(--border, #ececed)',
    borderRadius: 'var(--radius, 10px)',
    '--launcher-panel-width': launcherSettingsTarget
      ? `${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px`
      : activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `${activeSurfaceFrame.surface.shell.defaultWidth}px`
      : `${GLOBAL_LAUNCHER_PANEL_WIDTH}px`,
    width: launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_WIDTH}px, calc(100vw - 24px))`
      : activeSurfaceFrame?.surface.shell?.defaultWidth
      ? `min(${activeSurfaceFrame.surface.shell.defaultWidth}px, calc(100vw - 24px))`
      : undefined,
    maxHeight: launcherSettingsTarget
      ? `min(${GLOBAL_LAUNCHER_SETTINGS_HEIGHT}px, calc(100vh - 24px))`
      : activeSurfaceFrame?.surface.shell?.defaultHeight
      ? `min(${activeSurfaceFrame.surface.shell.defaultHeight}px, calc(100vh - 24px))`
      : undefined,
    left: '50%',
    top: standaloneLauncher ? 12 : 54,
    transform: 'translateX(-50%)',
  }

  useLayoutEffect(() => {
    if (!surfaceFrame && !launcherSettingsTarget) return
    const frame = window.requestAnimationFrame(() => {
      const shell = panelRef.current?.querySelector<HTMLElement>('.global-launcher-surface-shell, .global-launcher-settings-shell')
      const focusTarget =
        shell?.querySelector<HTMLElement>('[data-plugin-surface-autofocus]') ??
        shell
      focusTarget?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [launcherSettingsTarget, surfaceFrame, surfaceFocusVersion])

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
          if (event.defaultPrevented) return
          if (event.key === 'Escape' && launcherSettingsTarget) {
            event.preventDefault()
            event.stopPropagation()
            closeSettingsDialog()
            focusSearchInputAfterBack()
            return
          }
          if (launcherSettingsTarget) {
            return
          }
          if (surfaceFrame) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              leaveSurface()
            }
            return
          }
          if (itemPermissionFrame) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancelItemPermissionPrompt()
            }
            return
          }
          // Controller frame key handling (collect-input / result)
          if (controllerState && controllerState.frames.length > 1) {
            const topFrame = controllerState.frames[controllerState.frames.length - 1]
            if (topFrame.kind === 'param-input') {
              return
            }
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
                focusSearchInputAfterBack()
                return
              }
              if (event.key === 'Backspace' && !(topFrame as CollectInputFrame).inputText) {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                focusSearchInputAfterBack()
                return
              }
              return // other keys pass to input naturally
            }
            if (topFrame.kind === 'result') {
              const choices = (topFrame as ResultFrame).output.choices
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setResultSelectedIndex((index) => Math.min(index + 1, Math.max(0, choices.length - 1)))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setResultSelectedIndex((index) => Math.max(index - 1, 0))
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                const choice = choices[Math.min(resultSelectedIndex, Math.max(0, choices.length - 1))]
                if (choice) {
                  toggleResultChoice(choice, topFrame as ResultFrame)
                }
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                controllerRef.current?.back()
                focusSearchInputAfterBack()
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
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            isKeyboardNavRef.current = true
            setSelectedIndex((index) => Math.min(index + 1, Math.max(0, visibleFiltered.length - 1)))
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            isKeyboardNavRef.current = true
            setSelectedIndex((index) => Math.max(index - 1, 0))
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            selectItem(selectedItem, shouldCustomizeParams(event.metaKey, event.ctrlKey))
          }
        }}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        {launcherSettingsTarget ? (
          <div
            className="global-launcher-settings-shell flex flex-col min-h-0 outline-none"
            tabIndex={-1}
            style={{ height: GLOBAL_LAUNCHER_SETTINGS_HEIGHT }}
          >
            <PluginSettingsContent
              pluginId={launcherSettingsTarget.pluginId}
              source={launcherSettingsTarget.source}
              locale={locale}
              onClose={() => {
                closeSettingsDialog()
                focusSearchInputAfterBack()
              }}
            />
          </div>
        ) : surfaceFrame ? (() => {
          void pluginPermissionVersion
          if (!activeSurfaceFrame) {
            return <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>Surface not found</div>
          }
          const { definition: def, surface } = activeSurfaceFrame
          const SurfaceComponent = surface.component
          const settingsContribution = def.settings
          const settings = settingsContribution ? resolvePluginSettings(surfaceFrame.source, surfaceFrame.pluginId, settingsContribution).value : {}
          const pluginT = makePluginT(surfaceFrame.pluginId, locale)
          const requestedPermissions = pluginRegistry.getPluginPermissions(surfaceFrame.pluginId, surfaceFrame.source)
          const permissions = getPluginPermissionSnapshot(surfaceFrame.source, surfaceFrame.pluginId, requestedPermissions)
          const missingPermissions = missingPluginPermissions(permissions, requestedPermissions)
          const openSettingsDialog = usePluginSettingsStore.getState().openSettingsDialog
          const hostStorage = createPluginPrivateStorage(surfaceFrame.source, surfaceFrame.pluginId, permissions)
          const shellHeight = surface.shell?.defaultHeight ?? 480
          return (
            <PluginSurfaceErrorBoundary pluginId={surfaceFrame.pluginId} onBack={leaveCrashedSurface}>
              <div
                className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
                tabIndex={-1}
                style={{ height: shellHeight }}
              >
                <div className="global-launcher-body" style={{ maxHeight: shellHeight, height: shellHeight, overflow: 'hidden' }}>
                  {missingPermissions.length > 0 ? (
                    <PluginSurfacePermissionGate
                      permissions={missingPermissions}
                      locale={locale}
                      onBack={requestSurfaceBack}
                      onGrant={() => {
                        grantPluginPermissions(surfaceFrame.source, surfaceFrame.pluginId, missingPermissions)
                        void restartPluginBackground(surfaceFrame.pluginId, surfaceFrame.source)
                      }}
                    />
                  ) : (
                    <SurfaceComponent
                      pluginId={surfaceFrame.pluginId}
                      surfaceId={surfaceFrame.surfaceId}
                      locale={locale}
                      t={pluginT}
                      settings={settings}
                      permissions={permissions}
                      host={{
                        close: requestSurfaceClose,
                        requestBack: requestSurfaceBack,
                        openSettings: () => {
                          openSettingsDialog({
                            pluginId: surfaceFrame.pluginId,
                            source: surfaceFrame.source,
                            presentation: 'global-launcher',
                            context: { surfaceId: 'global-launcher' },
                          })
                        },
                        showMessage: (message, level) => {
                          useAppStore.getState().setLastCommandStatus({ title: message, status: level === 'error' ? 'error' : 'success', message, updatedAt: Date.now() })
                        },
                        storage: hostStorage,
                        clipboard: createPluginClipboard(surfaceFrame.pluginId, permissions, hostStorage),
                        paste: createPluginPaste(permissions, hostStorage),
                      }}
                    />
                  )}
                </div>
              </div>
            </PluginSurfaceErrorBoundary>
          )
        })() : itemPermissionFrame ? (
          <div className="global-launcher-body" style={{ height: 260 }}>
            <PluginSurfacePermissionGate
              permissions={itemPermissionFrame.permissions}
              locale={locale}
              onBack={cancelItemPermissionPrompt}
              onGrant={grantItemPermissionsAndRun}
            />
          </div>
        ) : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'param-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ParamInputFrame
          return (
            <LauncherParamStep
              frame={frame}
              error={controllerState.error}
              busy={controllerState.busy}
              locale={locale}
              headerClassName="global-launcher-header l-search"
              bodyClassName="global-launcher-body l-list opt"
              footerClassName="global-launcher-footer l-foot"
              onQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
              onSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
              onCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
              onMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
              onBack={() => {
                controllerRef.current?.back()
                focusSearchInputAfterBack()
              }}
            />
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'collect-input' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as CollectInputFrame
          const placeholder = frame.input.placeholder ?? ''
          const previewChoices = frame.previewOutput?.choices ?? []
          const paramChips: { label: string; value: string }[] = []
          if (frame.params && frame.item.params) {
            for (const p of frame.item.params) {
              const val = frame.params[p.key]
              if (val !== undefined && val !== null) {
                paramChips.push({ label: localized(p.label, p.labelI18n, locale), value: resolveParamValueLabel(p, val, locale) })
              }
            }
          }
          return (
            <>
              <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
                <button className="back" type="button" onClick={() => { controllerRef.current?.back(); focusSearchInputAfterBack() }}>‹</button>
                <span className="title">
                  <span className="t-ico">{resolveIcon(frame.item.display.icon, 14, resolveDisplayTitle(frame.item.display, locale))}</span>
                  {resolveDisplayTitle(frame.item.display, locale)}
                </span>
                {paramChips.map((chip) => (
                  <span
                    key={chip.label}
                    className="kbd shrink-0 max-w-[100px] truncate"
                    title={`${chip.label}: ${chip.value}`}
                  >
                    {chip.value}
                  </span>
                ))}
                <span className="vbar" />
                <input
                  ref={inputRef}
                  value={frame.inputText}
                  onChange={(event) => controllerRef.current?.setInputText(event.target.value)}
                  placeholder={placeholder}
                  className="mono"
                />
                {controllerState.busy && (
                  <span className="meta">...</span>
                )}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              {previewChoices.length > 0 && (
                <div className="global-launcher-body l-results">
                  {previewChoices.map((choice, index) => (
                    <ResultChoiceRow
                      key={choice.id}
                      choice={choice}
                      index={index}
                      selected={index === 0}
                      onSelect={() => activateResultChoice(choice)}
                    />
                  ))}
                </div>
              )}
              <div className="global-launcher-footer l-foot">
                {previewChoices.length > 0
                  ? <HintText label={t(locale, 'palette.enterToCopy')} />
                  : <HintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />}
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : controllerState && controllerState.frames.length > 1 && controllerState.frames[controllerState.frames.length - 1].kind === 'result' ? (() => {
          const frame = controllerState.frames[controllerState.frames.length - 1] as ResultFrame
          const choices = frame.output.choices
          const selection = frame.output.selection
          const clampedResultSelectedIndex = Math.min(resultSelectedIndex, Math.max(0, choices.length - 1))
          const selectedCount = selectedResultChoiceIds.size
          const countLabel = selection?.type === 'multi'
            ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: selection.max })
            : null
          return (
            <>
              <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
                <button className="back" type="button" onClick={() => { controllerRef.current?.back(); focusSearchInputAfterBack() }}>‹</button>
                <span className="title">
                  {frame.sourceTitle}
                </span>
              </div>
              <div className="global-launcher-body l-results">
                {choices.map((choice, index) => {
                  const checked = selectedResultChoiceIds.has(choice.id)
                  const disabled = selection?.type === 'multi' && selectedCount >= selection.max && !checked
                  return (
                  <ResultChoiceRow
                    key={choice.id}
                    choice={choice}
                    index={index}
                    selected={index === clampedResultSelectedIndex}
                    checked={checked}
                    disabled={disabled}
                    multi={selection?.type === 'multi'}
                    onHover={() => setResultSelectedIndex(index)}
                    onSelect={() => toggleResultChoice(choice, frame)}
                  />
                  )
                })}
              </div>
              {controllerState.error && (
                <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
                  {controllerState.error}
                </div>
              )}
              <div className="global-launcher-footer l-foot">
                {countLabel && <HintText label={countLabel} />}
                <HintKey keys="↵" label={selection?.type === 'multi' ? t(locale, 'palette.select') : t(locale, 'palette.confirm')} />
                <HintKey keys="esc" label={t(locale, 'palette.back')} />
              </div>
            </>
          )
        })() : (
          <>
            <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
              <Search className="ico" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setSelectedIndex(0) }}
                placeholder={t(locale, 'palette.globalPlaceholder')}
              />
            </div>
            {controllerState?.error && (
              <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
                {controllerState.error}
              </div>
            )}
            <div className="global-launcher-body l-list" onMouseMove={() => { isKeyboardNavRef.current = false }}>
              <LauncherList
                items={visibleFiltered}
                selected={selectedItem}
                locale={locale}
                onSelect={(item) => selectItem(item)}
                onHoverIndex={(index) => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
              />
            </div>
            <div className="global-launcher-footer l-foot">
              <HintKey keys="↑↓" label={t(locale, 'palette.select')} />
              <HintKey keys="↵" label={t(locale, 'palette.confirm')} />
              {selectedItem?.kind === 'domain' && supportsParamCustomization(selectedItem.domainItem) && (
                <HintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
              )}
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
  const footer = panel.querySelector<HTMLElement>('.global-launcher-footer')
  if (!header || !footer) return panel.getBoundingClientRect().height

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

function isPluginSettingsSource(value: string | undefined): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}

function isAppIconRef(icon?: string): boolean {
  return icon?.startsWith('app-icon:') === true
}

function LauncherList({
  items,
  selected,
  locale,
  onSelect,
  onHoverIndex,
}: {
  items: LauncherItem[]
  selected?: LauncherItem
  locale: Locale
  onSelect: (item: LauncherItem) => void
  onHoverIndex?: (index: number) => void
}) {
  if (items.length === 0) return null
  return (
    <>
      {items.map((item, index) => {
        const isSelected = selected?.kind === item.kind && selected.id === item.id
        return (
          <LauncherListItem
            key={`${item.kind}:${item.id}`}
            item={item}
            selected={isSelected}
            locale={locale}
            onSelect={onSelect}
            onMouseEnter={() => onHoverIndex && onHoverIndex(index)}
          />
        )
      })}
    </>
  )
}

const LauncherListItem = memo(function LauncherListItem({
  item,
  selected,
  locale,
  onSelect,
  onMouseEnter,
}: {
  item: LauncherItem
  selected: boolean
  locale: Locale
  onSelect: (item: LauncherItem) => void
  onMouseEnter?: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const appIcon = isAppIconRef(item.icon)
  const tag = getLauncherItemKindLabel(item, locale)

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      className={`l-row w-full border-none text-left ${selected ? 'sel selected' : ''}`}
      onClick={() => onSelect(item)}
      onMouseEnter={onMouseEnter}
    >
      <span
        className={appIcon ? 'r-app' : 'r-ico'}
      >
        {appIcon ? (
          <span className="app-icon">
            {item.kind === 'domain'
              ? resolveIcon(item.icon, 16, item.title)
              : (resolveIcon(item.icon, 16, item.title) || <Pin size={16} />)}
          </span>
        ) : (
          item.kind === 'domain'
            ? resolveIcon(item.icon, 16, item.title)
            : (resolveIcon(item.icon, 16, item.title) || <Pin size={16} />)
        )}
      </span>

      <div
        className="r-main"
      >
        <span className="r-title launcher-item-title">
          {item.title}
        </span>
        {item.subtitle && (
          <span className="r-desc">{item.subtitle}</span>
        )}
      </div>
      <span className="r-tag launcher-kind-tag">
        {tag}
      </span>
      {selected && <span className="r-kbd">↵</span>}
    </button>
  )
})

function getLauncherItemKindLabel(item: LauncherItem, locale: Locale) {
  if (item.kind === 'pinned') return t(locale, 'palette.kindPinned')
  if (isAppIconRef(item.icon)) return t(locale, 'palette.kindApp')
  return t(locale, 'palette.kindCommand')
}

function ResultChoiceRow({
  choice,
  index,
  selected,
  checked = false,
  disabled = false,
  multi = false,
  onHover,
  onSelect,
}: {
  choice: LauncherResultChoice
  index: number
  selected: boolean
  checked?: boolean
  disabled?: boolean
  multi?: boolean
  onHover?: () => void
  onSelect: () => void
}) {
  const bodyText = choice.preview ?? choice.title
  const longResult = isLongResultText(bodyText)
  const className = `global-launcher-result-row ${longResult ? 'l-result-block' : 'l-result'} ${selected ? 'sel is-selected' : ''} ${disabled ? 'disabled' : ''}`
  return (
    <button
      className={className}
      onMouseEnter={onHover}
      onClick={onSelect}
      disabled={disabled}
    >
      {multi ? (
        <span className={`check ${checked ? 'on' : ''}`}>{checked ? '✓' : ''}</span>
      ) : (
        <span className="ri">{index === 0 ? '=' : '#'}</span>
      )}
      <span className={longResult ? 'block-main' : 'rtext'}>{bodyText}</span>
      {!longResult && choice.subtitle && (
        <span className="rkind">{choice.subtitle}</span>
      )}
      {!multi && <span className="rkbd">↵</span>}
    </button>
  )
}

function isLongResultText(text: string): boolean {
  return text.includes('\n') || text.length > 88
}

function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="grp">
      <kbd>{keys}</kbd>
      {label}
    </span>
  )
}

function HintText({ label }: { label: string }) {
  return (
    <span className="grp primary">
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
    aliases: item.aliases,
    usageKey: launcherItemUsageKey(item),
  }
}

function launcherItemSearchId(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}

function launcherItemUsageKey(item: LauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}

// ─── Plugin Surface Helpers ──────────────────────────────────────────────────

function PluginSurfacePermissionGate({
  permissions,
  locale,
  onBack,
  onGrant,
}: {
  permissions: PluginPermission[]
  locale: Locale
  onBack: () => void
  onGrant: () => void
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center" style={{ color: 'var(--color-text-secondary)' }}>
      <div className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)' }}>{t(locale, 'palette.pluginPermissionTitle')}</div>
      <div className="max-w-[420px] text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
        {t(locale, 'palette.pluginPermissionDescription')}
      </div>
      <div className="max-w-[420px] flex flex-col gap-1 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        {permissions.map((permission) => (
          <div key={permission}>
            {describePluginPermission(permission, locale)}
            <span style={{ color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}> {permission}</span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          className="text-[12px] px-3 py-1.5 rounded"
          style={{ background: 'var(--color-accent)', color: '#fff', border: 'none', cursor: 'pointer' }}
          onClick={onGrant}
        >
          {t(locale, 'palette.pluginPermissionAllow')}
        </button>
        <button
          className="text-[12px] px-3 py-1.5 rounded"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }}
          onClick={onBack}
        >
          {t(locale, 'palette.pluginPermissionBack')}
        </button>
      </div>
    </div>
  )
}

type SurfaceErrorBoundaryProps = {
  pluginId: string
  onBack: () => void
  children: ReactNode
}

type SurfaceErrorBoundaryState = {
  hasError: boolean
  error?: string
}

class PluginSurfaceErrorBoundary extends Component<SurfaceErrorBoundaryProps, SurfaceErrorBoundaryState> {
  state: SurfaceErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(error: Error): SurfaceErrorBoundaryState {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[hiven] Plugin surface "${this.props.pluginId}" crashed:`, error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="text-[13px]">Plugin surface crashed</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{this.state.error}</span>
          <button
            className="text-[12px] px-3 py-1.5 rounded"
            style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-primary)', border: 'none', cursor: 'pointer' }}
            onClick={this.props.onBack}
          >
            Back
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function samePluginSurfaceTarget(
  a: PluginSurfaceOpenTarget,
  b: PluginSurfaceOpenTarget,
): boolean {
  return a.source === b.source && a.pluginId === b.pluginId && a.surfaceId === b.surfaceId
}
