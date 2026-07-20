import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { t } from '../../i18n'
import { usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { useGlobalLauncherResultFrame } from '../../components/launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../../components/launcher/GlobalLauncherItems'
import { buildGlobalLauncherPanelStyle } from '../../components/launcher/GlobalLauncherLayout'
import { usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { useGlobalLauncherSurfaceRegistry } from '../../components/launcher/GlobalLauncherSurfaceRegistry'
import { useCloseStandaloneLauncherOnBlur, useFocusGlobalLauncherSurfaceShell, useGlobalLauncherNativeDrag, useStandaloneLauncherResize } from '../../components/launcher/GlobalLauncherWindowLifecycle'
import { isStandaloneLauncherWindow, useGlobalLauncherCollectInputPreview, useGlobalLauncherFocusSession, useGlobalLauncherHostEscape, useGlobalLauncherImeComposition } from '../../components/launcher/GlobalLauncherHostLifecycle'
import { closeGlobalLauncherWindow } from '../../components/launcher/GlobalLauncherClose'
import { isWorkflowObjectLauncherItem } from '../../components/launcher/GlobalLauncherSelection'
import { useGlobalLauncherSurfaceFrame } from '../../components/launcher/GlobalLauncherSurfaceFrame'
import { readLauncherClipboard } from '../clipboard/readLauncherClipboard'
import { GlobalLauncherPanel } from '../../components/launcher/GlobalLauncherPanel'
import { useGlobalLauncherSelectionController } from '../../components/launcher/useGlobalLauncherSelectionController'
import { useClipboardObjectBlock } from '../clipboard/useClipboardObjectBlock'
import { executeRecommendedAction } from '../clipboard/actionExecutor'
import { recommendActionsForBlock, type RecommendedAction, type RecommendedOutputTarget } from '../clipboard/actionRecommendation'
import { createPluginClipboard, writeClipboardText } from '../../workspace/pluginClipboard'
import { createGlobalLauncherPluginApi } from '../clipboard/globalLauncherApi'
import { createPluginPaste } from '../../workspace/pluginPaste'
import { createPluginPrivateStorage } from '../../workspace/pluginStorage'
import { createQuickEditorPane } from '../../workspace/quickEditor/quickEditorRequests'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { restoreLauncherInputSource } from '../../workspace/windowManager/launcherWindow'
import { getHostSurfaceShell } from '../../components/launcher/hostSurfaceShell'
import { logLauncherPerf } from '../../workspace/launcher/perf'
import type { LauncherItem } from '../../workspace/launcher/types'
import { getPluginPermissionSnapshot } from '../../workspace/pluginPermissions'
import { showToast } from '../../workspace/toast'

export function GlobalLauncherHost() {
  const {
    open,
    overlay,
    locale,
    pluginSurfaceToolTarget,
    launcherHostSurfaceTarget,
  } = useAppStore(useShallow((s) => ({
    open: s.globalLauncherOpen,
    overlay: s.globalLauncherOverlay,
    locale: s.locale,
    pluginSurfaceToolTarget: s.pluginSurfaceToolTarget,
    launcherHostSurfaceTarget: s.launcherHostSurfaceTarget,
  })))
  const setOpen = useAppStore((s) => s.setGlobalLauncherOpen)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const clearLauncherHostSurface = useAppStore((s) => s.clearLauncherHostSurface)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const focusSearchInputAfterBackRef = useRef<() => void>(() => {})
  const isKeyboardNavRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [selectedObjectActionIndex, setSelectedObjectActionIndex] = useState(0)
  const objectActionControllerRef = useRef<{ expand: () => void; execute: (keepOpen?: boolean) => void } | null>(null)
  const { isImeComposingRef, handleCompositionStart, handleCompositionEnd } = useGlobalLauncherImeComposition()
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null
  const hostSurfaceTarget = launcherHostSurfaceTarget
  const clipboardBlock = useClipboardObjectBlock({
    open,
    readClipboard: readLauncherClipboard,
  })
  // Only use clipboard for recommendations when the Object Block is showing (fresh enough)
  const objectBlockText = clipboardBlock.block?.payloadText ?? undefined
  const [foregroundApp, setForegroundApp] = useState<string | undefined>()

  const {
    query,
    rankingQuery,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controller,
    controllerRef,
    controllerState,
    rankedItems: rankedLauncherItems,
  } = useLauncherSession({
    hostId: 'global-launcher',
    open,
    requestClose: () => closeAfterActionRef.current(),
    collectDynamicWhenEmpty: true,
    objectBlockText,
    foregroundApp,
    makeApi: createGlobalLauncherPluginApi,
  })

  const objectActions = useMemo(() => {
    if (!clipboardBlock.block) return []
    return recommendActionsForBlock(clipboardBlock.block)
  }, [clipboardBlock.block])

  useEffect(() => {
    if (!open) return
    // Total open-event → first painted frame (double rAF ≈ paint).
    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const t0 = (window as unknown as { __hivenLauncherOpenT0?: number }).__hivenLauncherOpenT0
        if (typeof t0 !== 'number') return
        ;(window as unknown as { __hivenLauncherOpenT0?: number }).__hivenLauncherOpenT0 = undefined
        logLauncherPerf('open:event-to-first-paint', {
          durationMs: Math.round((performance.now() - t0) * 10) / 10,
        })
      })
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  useEffect(() => {
    if (!open) {
      setForegroundApp(undefined)
      return
    }
    // Defer after first paint — AppKit foreground lookup must not delay show.
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
            if (!cancelled) setForegroundApp(undefined)
            return
          }
          const { invoke } = await import('@tauri-apps/api/core')
          const foreground = await invoke<{ appName?: string | null } | null>('current_foreground_app_context')
          if (cancelled) return
          const name = foreground?.appName?.trim()
          setForegroundApp(name || undefined)
        } catch {
          if (!cancelled) setForegroundApp(undefined)
        }
      })()
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open])

  useEffect(() => {
    // Native show_launcher already switches to English IME before show.
    // Frontend must NOT call prepare again (duplicate TIS on main thread).
    // Restore previous input source only when leaving the open state.
    if (!open) return
    return () => {
      void restoreLauncherInputSource().catch((error) => {
        console.warn('[hiven] Failed to restore launcher input source:', error)
      })
    }
  }, [open])

  useEffect(() => {
    setSelectedObjectActionIndex((index) => Math.min(index, Math.max(0, objectActions.length - 1)))
  }, [objectActions.length])

  const {
    surfaceFrame,
    setSurfaceFrame,
    activeSurfaceFrame,
    surfaceFocusVersion,
    openPluginSurface,
    leaveSurface,
    requestSurfaceBack,
    requestSurfaceClose,
  } = useGlobalLauncherSurfaceFrame({
    open,
    pluginRegistryVersion,
    pluginSurfaceToolTarget,
    closeLauncher: () => closeAfterActionRef.current(),
    // ESC/back pops the tool surface; keep the launcher open and refocus search.
    onReturnedToList: () => focusSearchInputAfterBackRef.current(),
  })

  // Root list + collect-input keep the caret; result/param/surface own their own focus.
  const retainSearchFocus = useMemo(() => {
    if (surfaceFrame || launcherSettingsTarget || hostSurfaceTarget) return false
    const top = controllerState?.frames[controllerState.frames.length - 1]
    if (!top || top.kind === 'list') return true
    if (top.kind === 'collect-input') return true
    return false
  }, [controllerState, hostSurfaceTarget, launcherSettingsTarget, surfaceFrame])

  const { restoreFocus, focusSearchInputAfterBack, bindSearchInputRef } = useGlobalLauncherFocusSession({
    open,
    inputRef,
    setQuery,
    setSelectedIndex,
    retainSearchFocus,
  })

  useEffect(() => {
    focusSearchInputAfterBackRef.current = focusSearchInputAfterBack
  }, [focusSearchInputAfterBack])

  useGlobalLauncherSurfaceRegistry({
    open,
    standaloneLauncher,
    launcherSettingsTarget,
    hostSurfaceTarget,
    surfaceFrame,
    activeSurfaceFrame,
    controllerReset: useCallback(() => {
      setSurfaceFrame(null)
      controllerRef.current?.reset()
    }, [controllerRef]),
  })

  // Use rankingQuery (deferred), not live query — otherwise every keystroke rebuilds
  // all list item objects and busts row memo before deferred rank catches up.
  const rankedVisible = useMemo(() => {
    void pluginRegistryVersion
    return buildGlobalLauncherItems({
      rankedLauncherItems,
      query: rankingQuery,
      locale,
    })
  }, [locale, pluginRegistryVersion, rankingQuery, rankedLauncherItems])

  /** Image/files history Object Blocks cannot use textMatch; inject host actions at list top. */
  const historyObjectActionItems = useMemo((): GlobalLauncherItem[] => {
    const block = clipboardBlock.block
    if (!block || (block.kind !== 'image' && block.kind !== 'files')) return []
    const q = rankingQuery.trim().toLowerCase()
    return objectActions
      .filter((action) => {
        if (!q) return true
        return (
          action.title.toLowerCase().includes(q) ||
          action.titleZh.toLowerCase().includes(q) ||
          action.id.toLowerCase().includes(q)
        )
      })
      .map((action) => {
        const title = locale === 'zh' ? action.titleZh : action.title
        const domainItem: LauncherItem = {
          systemKey: `history-object-action:${action.id}`,
          kind: 'host',
          display: {
            title,
            titleI18n: { en: action.title, zh: action.titleZh },
            subtitle: action.provider,
            kindLabel: block.kind === 'image' ? 'Image' : 'Files',
            kindLabelI18n: { en: block.kind === 'image' ? 'Image' : 'Files', zh: block.kind === 'image' ? '图片' : '文件' },
          },
          behavior: { type: 'perform' },
          execute: async () => ({ ok: true }),
        }
        return {
          kind: 'domain' as const,
          id: domainItem.systemKey,
          title,
          subtitle: action.provider ?? '',
          domainItem,
        }
      })
  }, [clipboardBlock.block, locale, objectActions, rankingQuery])

  const visibleFiltered = useMemo(
    () => [...historyObjectActionItems, ...rankedVisible],
    [historyObjectActionItems, rankedVisible],
  )

  /**
   * Primitive resize trigger — controllerState object identity changes every setState.
   * Also folds in collect-input preview content, since that can change while
   * busy/frames.length/kind/error all stay the same (e.g. previewInput() resolving).
   */
  const controllerResizeKey = useMemo(() => {
    if (!controllerState) return 'idle'
    const top = controllerState.frames[controllerState.frames.length - 1]
    const topKind = top?.kind ?? 'none'
    const previewSignal =
      top?.kind === 'collect-input' ? `:${top.previewOutput?.choices.length ?? 0}:${top.previewInputText ?? ''}` : ''
    return `${controllerState.busy ? 1 : 0}:${controllerState.frames.length}:${topKind}:${controllerState.error ?? ''}${previewSignal}`
  }, [controllerState])

  const resetLauncherSession = useCallback(() => {
    clearPluginSurfaceTool()
    clearLauncherHostSurface()
    // Drop any suspended host (e.g. quick-editor under Diff) when fully closing.
    useAppStore.setState({ previousLauncherHostSurfaceTarget: null })
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    if (usePluginSettingsStore.getState().settingsDialogTarget?.presentation === 'global-launcher') {
      closeSettingsDialog()
    }
    setQuery('')
    setSelectedIndex(0)
    controllerRef.current?.reset()
  }, [clearLauncherHostSurface, clearPluginSurfaceTool, closeSettingsDialog, setQuery, setSelectedIndex, controllerRef])

  // Esc / overlay click / surface close: smart restore (skip if user already left).
  const closeLauncher = useCallback(() => {
    resetLauncherSession()
    void closeGlobalLauncherWindow({
      standaloneLauncher,
      overlay,
      hideOverlayWindow: true,
      restoreFocus,
      setOpen,
      restoreForeground: 'auto',
    })
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  // Blur-dismiss (clicked another app/window): never steal focus back.
  const closeLauncherOnBlur = useCallback(() => {
    resetLauncherSession()
    void closeGlobalLauncherWindow({
      standaloneLauncher,
      overlay,
      hideOverlayWindow: true,
      restoreFocus,
      setOpen,
      restoreForeground: 'never',
    })
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  const leaveHostSurface = useCallback(() => {
    clearLauncherHostSurface()
    focusSearchInputAfterBack()
  }, [clearLauncherHostSurface, focusSearchInputAfterBack])

  // Close launcher after a command has been executed (don't hide the main window)
  const closeLauncherAfterAction = useCallback(() => {
    resetLauncherSession()
    void closeGlobalLauncherWindow({
      standaloneLauncher,
      overlay,
      hideOverlayWindow: false,
      restoreFocus,
      setOpen,
      // Intentionally switched targets already clear_previous_foreground_app;
      // auto still restores when the action only wrote clipboard / stayed put.
      restoreForeground: 'auto',
    })
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  useEffect(() => {
    closeAfterActionRef.current = closeLauncherAfterAction
  }, [closeLauncherAfterAction])

  useCloseStandaloneLauncherOnBlur({
    open,
    standaloneLauncher,
    closeOnBlur: getHostSurfaceShell(launcherHostSurfaceTarget)?.closeOnBlur
      ?? activeSurfaceFrame?.surface.shell?.closeOnBlur,
    closeLauncher: closeLauncherOnBlur,
  })

  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))
  const selectedItem = visibleFiltered.length === 1 ? visibleFiltered[0] : visibleFiltered[clampedSelectedIndex]
  const activeResultFrame = controllerState?.frames.length
    ? controllerState.frames[controllerState.frames.length - 1]
    : null
  const {
    resultSelectedIndex,
    setResultSelectedIndex,
    selectedResultChoiceIds,
    activateResultChoice,
    activateSecondaryAction,
    toggleResultChoice,
  } = useGlobalLauncherResultFrame({
    controller,
    activeResultFrame: activeResultFrame?.kind === 'result' ? activeResultFrame : null,
  })

  useEffect(() => {
    if (activeResultFrame?.kind === 'result') {
      requestAnimationFrame(() => panelRef.current?.focus())
    }
  }, [activeResultFrame?.kind])

  useGlobalLauncherCollectInputPreview({
    open,
    controllerState,
    controllerRef,
    inputRef,
  })

  useStandaloneLauncherResize({
    open,
    standaloneLauncher,
    panelRef,
    hostSurfaceTarget,
    launcherSettingsTarget,
    surfaceShell: activeSurfaceFrame?.surface.shell,
    visibleFilteredLength: visibleFiltered.length,
    controllerResizeKey,
  })

  const {
    itemPermissionFrame,
    setItemPermissionFrame,
    selectItem,
    grantItemPermissionsAndRun,
    cancelItemPermissionPrompt,
  } = useGlobalLauncherSelectionController({
    controllerRef,
    standaloneLauncher,
    overlay,
    restoreFocus,
    setOpen,
    clearPluginSurfaceTool,
    openPluginSurface,
    grantPluginPermissions,
    focusSearchInputAfterBack,
    objectBlockText: clipboardBlock.block?.payloadText ?? undefined,
  })

  useGlobalLauncherHostEscape({
    open,
    isImeComposingRef,
    controllerRef,
    closeLauncher,
    focusSearchInputAfterBack,
  })


  const executeObjectAction = useCallback(async (action: RecommendedAction, target: RecommendedOutputTarget) => {
    const block = clipboardBlock.block
    if (!block) return

    // History image/files blobs live in clipboard-history private storage
    const historyPermissions = getPluginPermissionSnapshot('builtin', 'clipboard-history', [
      'clipboard.write',
      'clipboard.image',
      'clipboard.files',
      'storage.private',
      'storage.blob',
      'accessibility.paste',
    ])
    const historyStorage = createPluginPrivateStorage('builtin', 'clipboard-history', historyPermissions)
    const historyClipboard = createPluginClipboard('clipboard-history', historyPermissions, historyStorage)
    const historyPaste = createPluginPaste(historyPermissions, historyStorage)

    const result = await executeRecommendedAction({ block, action, target }, {
      copyText: writeClipboardText,
      copyAndKeepOpen: writeClipboardText,
      openInEditor: async (text, options) => {
        await createQuickEditorPane({ text, language: options?.language })
      },
      openPluginSurface: async (pluginId, options) => {
        await openPluginSurface({
          source: 'builtin' as PluginSettingsSource,
          pluginId,
          surfaceId: 'main',
          initialText: options?.initialText,
        })
      },
      readLocalFileText: async (path) => {
        const { invoke } = await import('@tauri-apps/api/core')
        return invoke<string>('read_file', { path })
      },
      openUrl: async (url) => {
        await openUrl(url)
      },
      replaceSelection: async (text) => {
        await createQuickEditorPane({ text })
      },
      newPane: async (text, options) => {
        await createQuickEditorPane({ text, language: options?.language })
      },
      insertBelow: async (text) => {
        await createQuickEditorPane({ text })
      },
      openBottomPanel: async (actionId, text) => {
        await createQuickEditorPane({ text: `${actionId}\n\n${text}` })
      },
      setRenderer: async (actionId, text) => {
        await createQuickEditorPane({ text: `${actionId}\n\n${text}` })
      },
      pasteImage: async (blobId) => {
        const pasteResult = await historyPaste.pasteImage(blobId)
        if (!pasteResult.ok) throw new Error(pasteResult.message || 'Paste image failed')
      },
      writeImage: async (blobId) => {
        await historyClipboard.writeImage(blobId)
      },
      pasteFiles: async (paths) => {
        const pasteResult = await historyPaste.pasteFiles(paths)
        if (!pasteResult.ok) throw new Error(pasteResult.message || 'Paste files failed')
      },
    })

    if (!result.ok) {
      showToast(result.error, 'error')
      return
    }

    if (result.ok && target !== 'copy-and-keep-open') {
      closeLauncherAfterAction()
    }
  }, [clipboardBlock.block, closeLauncherAfterAction, openPluginSurface])

  const selectItemWithHistoryActions = useCallback((item: GlobalLauncherItem) => {
    if (item.id.startsWith('history-object-action:')) {
      const actionId = item.id.slice('history-object-action:'.length)
      const action = objectActions.find((entry) => entry.id === actionId)
      if (action) void executeObjectAction(action, action.defaultOutput)
      return
    }
    selectItem(item)
  }, [executeObjectAction, objectActions, selectItem])

  const beginDrag = useGlobalLauncherNativeDrag(standaloneLauncher)

  // The launcher is always horizontally centered. In the standalone window the
  // window itself is positioned natively (see `center_launcher_window`); here
  // the panel just centers within whatever window renders it.
  const panelStyle = buildGlobalLauncherPanelStyle({
    hostSurfaceTarget,
    launcherSettingsTarget,
    surfaceShell: activeSurfaceFrame?.surface.shell,
    standaloneLauncher,
  })

  useFocusGlobalLauncherSurfaceShell({
    panelRef,
    surfaceFrame,
    launcherSettingsTarget,
    hostSurfaceTarget,
    surfaceFocusVersion,
  })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 palette-overlay global-launcher-overlay open"
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1100 }}
      onClick={(event) => { if (event.target === event.currentTarget) closeLauncher() }}
    >
      <GlobalLauncherPanel
        panelRef={panelRef}
        inputRef={inputRef}
        bindSearchInputRef={bindSearchInputRef}
        controllerRef={controllerRef}
        isImeComposingRef={isImeComposingRef}
        isKeyboardNavRef={isKeyboardNavRef}
        busy={controllerState?.busy ?? false}
        panelStyle={panelStyle}
        beginDrag={beginDrag}
        launcherSettingsTarget={launcherSettingsTarget}
        closeSettingsDialog={closeSettingsDialog}
        focusSearchInputAfterBack={focusSearchInputAfterBack}
        surfaceFrame={surfaceFrame}
        activeSurfaceFrame={activeSurfaceFrame}
        leaveSurface={leaveSurface}
        itemPermissionFrame={itemPermissionFrame}
        cancelItemPermissionPrompt={cancelItemPermissionPrompt}
        grantItemPermissionsAndRun={grantItemPermissionsAndRun}
        controllerState={controllerState}
        resultSelectedIndex={resultSelectedIndex}
        setResultSelectedIndex={setResultSelectedIndex}
        selectedResultChoiceIds={selectedResultChoiceIds}
        activateResultChoice={activateResultChoice}
        activateSecondaryAction={activateSecondaryAction}
        toggleResultChoice={toggleResultChoice}
        closeLauncher={closeLauncher}
        visibleFiltered={visibleFiltered}
        selectedItem={selectedItem}
        setSelectedIndex={setSelectedIndex}
        isWorkflowObjectLauncherItem={isWorkflowObjectLauncherItem}
        selectItem={selectItemWithHistoryActions}
        hostSurfaceTarget={hostSurfaceTarget}
        clearLauncherHostSurface={clearLauncherHostSurface}
        query={query}
        setQuery={setQuery}
        locale={locale}
        searchPlaceholder={t(locale, 'palette.globalPlaceholder')}
        requestSurfaceBack={hostSurfaceTarget ? leaveHostSurface : requestSurfaceBack}
        requestSurfaceClose={hostSurfaceTarget ? closeLauncher : requestSurfaceClose}
        handleCompositionStart={handleCompositionStart}
        handleCompositionEnd={handleCompositionEnd}
        clipboardBlock={clipboardBlock}
        onExecuteObjectAction={executeObjectAction}
        objectActionCount={objectActions.length}
        selectedActionIndex={selectedObjectActionIndex}
        setSelectedActionIndex={(value) => setSelectedObjectActionIndex(value)}
        onObjectActionController={(controller) => { objectActionControllerRef.current = controller }}
        expandSelectedObjectAction={() => objectActionControllerRef.current?.expand()}
        executeSelectedObjectAction={(keepOpen) => objectActionControllerRef.current?.execute(keepOpen)}
      />
    </div>
  )
}
