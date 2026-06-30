import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
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
import { writeClipboardText } from '../../workspace/pluginClipboard'
import { createEditorPane, replaceEditorSelection, insertIntoEditor, openEditorPanel } from '../../workspace/editorBridge'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { prepareLauncherInputSource, restoreLauncherInputSource } from '../../workspace/windowManager/launcherWindow'

export function GlobalLauncherHost() {
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
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const pluginSurfaceToolTarget = useAppStore((s) => s.pluginSurfaceToolTarget)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const launcherHostSurfaceTarget = useAppStore((s) => s.launcherHostSurfaceTarget)
  const clearLauncherHostSurface = useAppStore((s) => s.clearLauncherHostSurface)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const closeAfterActionRef = useRef<() => void>(() => {})
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
  const clipboardText = clipboardBlock.block?.payloadText ?? undefined

  const {
    query,
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
    clipboardText,
  })

  const objectActions: RecommendedAction[] = [] // Disabled: recommendations now come from plugin dynamicItems + textMatch

  useEffect(() => {
    if (!open) return
    void prepareLauncherInputSource().catch((error) => {
      console.warn('[hiven] Failed to prepare launcher input source:', error)
    })
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
    closeLauncher: () => closeLauncher(),
  })

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



  const visibleFiltered = useMemo(() => {
    void pluginRegistryVersion
    return buildGlobalLauncherItems({
      mode,
      pinnedActions,
      rankedLauncherItems,
      query,
      locale,
      recentActionNames,
      actionUsageCounts,
    })
  }, [actionUsageCounts, locale, mode, pinnedActions, pluginRegistryVersion, query, rankedLauncherItems, recentActionNames])

  const { restoreFocus, focusSearchInputAfterBack } = useGlobalLauncherFocusSession({
    open,
    inputRef,
    setQuery,
    setSelectedIndex,
  })

  const resetLauncherSession = useCallback(() => {
    clearPluginSurfaceTool()
    clearLauncherHostSurface()
    setSurfaceFrame(null)
    setItemPermissionFrame(null)
    if (usePluginSettingsStore.getState().settingsDialogTarget?.presentation === 'global-launcher') {
      closeSettingsDialog()
    }
    setQuery('')
    setSelectedIndex(0)
    controllerRef.current?.reset()
  }, [clearLauncherHostSurface, clearPluginSurfaceTool, closeSettingsDialog])

  const closeLauncher = useCallback(() => {
    resetLauncherSession()
    void closeGlobalLauncherWindow({
      standaloneLauncher,
      overlay,
      hideOverlayWindow: true,
      restoreFocus,
      setOpen,
    })
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  // Close launcher after a command has been executed (don't hide the main window)
  const closeLauncherAfterAction = useCallback(() => {
    resetLauncherSession()
    void closeGlobalLauncherWindow({
      standaloneLauncher,
      overlay,
      hideOverlayWindow: false,
      restoreFocus,
      setOpen,
    })
  }, [overlay, resetLauncherSession, setOpen, standaloneLauncher, restoreFocus])

  useEffect(() => {
    closeAfterActionRef.current = closeLauncherAfterAction
  }, [closeLauncherAfterAction])

  useCloseStandaloneLauncherOnBlur({
    open,
    standaloneLauncher,
    closeOnBlur: activeSurfaceFrame?.surface.shell?.closeOnBlur,
    closeLauncher,
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
    toggleResultChoice,
  } = useGlobalLauncherResultFrame({
    controller,
    activeResultFrame: activeResultFrame?.kind === 'result' ? activeResultFrame : null,
  })

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
    mode,
    controllerState,
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
    openPinnedAction,
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
    launcherSettingsTarget,
    closeSettingsDialog,
    settingsDialogTarget,
    surfaceFrame,
    leaveSurface,
    hostSurfaceTarget,
    clearLauncherHostSurface,
    itemPermissionFrame,
    cancelItemPermissionPrompt,
    controllerRef,
    closeLauncher,
    focusSearchInputAfterBack,
  })


  const executeObjectAction = useCallback(async (action: RecommendedAction, target: RecommendedOutputTarget) => {
    const block = clipboardBlock.block
    if (!block) return

    const result = await executeRecommendedAction({ block, action, target }, {
      copyText: writeClipboardText,
      copyAndKeepOpen: writeClipboardText,
      openInEditor: async (text, options) => {
        await createEditorPane({ text, title: options?.title, language: options?.language })
      },
      openPluginSurface: async (pluginId) => {
        await openPluginSurface({ source: 'builtin' as PluginSettingsSource, pluginId, surfaceId: 'main' })
      },
      openUrl: async (url) => {
        await openUrl(url)
      },
      replaceSelection: async (text) => {
        await replaceEditorSelection(text)
      },
      newPane: async (text, options) => {
        await createEditorPane({ text, title: options?.title, language: options?.language })
      },
      insertBelow: async (text) => {
        await insertIntoEditor(text)
      },
      openBottomPanel: async (actionId, text) => {
        await openEditorPanel({ panelId: actionId, inputs: { text } })
      },
      setRenderer: async (actionId, text) => {
        await openEditorPanel({ panelId: actionId, inputs: { text } })
      },
    })

    if (result.ok && target !== 'copy-and-keep-open') {
      closeLauncherAfterAction()
    }
  }, [clipboardBlock.block, closeLauncherAfterAction, openPluginSurface])

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
        toggleResultChoice={toggleResultChoice}
        closeLauncher={closeLauncher}
        visibleFiltered={visibleFiltered}
        selectedItem={selectedItem}
        setSelectedIndex={setSelectedIndex}
        isWorkflowObjectLauncherItem={isWorkflowObjectLauncherItem}
        selectItem={selectItem}
        hostSurfaceTarget={hostSurfaceTarget}
        query={query}
        setQuery={setQuery}
        locale={locale}
        searchPlaceholder={t(locale, 'palette.globalPlaceholder')}
        requestSurfaceBack={requestSurfaceBack}
        requestSurfaceClose={requestSurfaceClose}
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
