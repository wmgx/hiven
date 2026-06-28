import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { t, type Locale } from '../../i18n'
import { usePluginRegistryVersion } from '../../workspace/pluginRegistry'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../../utils/imeKeyboard'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { LauncherView } from '../../components/launcher/LauncherView'
import { GlobalLauncherFrameSwitch } from '../../components/launcher/GlobalLauncherFrames'
import { getPlatformShortcutMeta, supportsParamCustomization } from '../../components/launcher/launcherParamShortcuts'
import { handleGlobalLauncherKeyDown } from '../../components/launcher/GlobalLauncherKeyboard'
import { useGlobalLauncherResultFrame } from '../../components/launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../../components/launcher/GlobalLauncherItems'
import { buildGlobalLauncherPanelStyle, GLOBAL_LAUNCHER_SETTINGS_HEIGHT, STANDALONE_SURFACE_MAX_HEIGHT } from '../../components/launcher/GlobalLauncherLayout'
import { usePluginPermissionStore } from '../../workspace/pluginPermissions'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { useGlobalLauncherSurfaceRegistry } from '../../components/launcher/GlobalLauncherSurfaceRegistry'
import { useCloseStandaloneLauncherOnBlur, useFocusGlobalLauncherSurfaceShell, useGlobalLauncherNativeDrag, useStandaloneLauncherResize } from '../../components/launcher/GlobalLauncherWindowLifecycle'
import { closeGlobalLauncherWindow, finishPinnedLauncherSelection } from '../../components/launcher/GlobalLauncherClose'
import {
  buildItemPermissionFrame,
  executeGlobalLauncherDomainItem,
  grantGlobalLauncherItemPermissions,
  isWorkflowObjectLauncherItem,
  resolvePluginSurfaceTarget,
  type LauncherItemPermissionFrame,
} from '../../components/launcher/GlobalLauncherSelection'
import { useGlobalLauncherSurfaceFrame } from '../../components/launcher/GlobalLauncherSurfaceFrame'

type LauncherItem = GlobalLauncherItem

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
  const pluginPermissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const pluginSurfaceToolTarget = useAppStore((s) => s.pluginSurfaceToolTarget)
  const clearPluginSurfaceTool = useAppStore((s) => s.clearPluginSurfaceTool)
  const launcherHostSurfaceTarget = useAppStore((s) => s.launcherHostSurfaceTarget)
  const clearLauncherHostSurface = useAppStore((s) => s.clearLauncherHostSurface)
  const settingsDialogTarget = usePluginSettingsStore((s) => s.settingsDialogTarget)
  const closeSettingsDialog = usePluginSettingsStore((s) => s.closeSettingsDialog)
  const closeAfterActionRef = useRef<() => void>(() => {})
  const [itemPermissionFrame, setItemPermissionFrame] = useState<LauncherItemPermissionFrame | null>(null)
  const isKeyboardNavRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isImeComposingRef = useRef(false)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const standaloneLauncher = isStandaloneLauncherWindow()
  const launcherSettingsTarget = settingsDialogTarget?.presentation === 'global-launcher'
    ? settingsDialogTarget
    : null
  const hostSurfaceTarget = launcherHostSurfaceTarget
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
  })

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    })
  }, [open])

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

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

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

  const selectItem = (item: LauncherItem | undefined, customizeParams = false) => {
    if (!item) return

    if (item.kind === 'domain') {
      const pluginSurfaceTarget = resolvePluginSurfaceTarget(item.domainItem)
      if (pluginSurfaceTarget) {
        clearPluginSurfaceTool()
        void openPluginSurface(pluginSurfaceTarget)
        return
      }

      const permissionFrame = buildItemPermissionFrame(item.domainItem, customizeParams)
      if (permissionFrame) {
        setItemPermissionFrame(permissionFrame)
        return
      }

      executeDomainItem(item.domainItem, customizeParams)
      return
    }

    if (item.kind === 'pinned') {
      void finishPinnedLauncherSelection({
        pinnedId: item.id,
        standaloneLauncher,
        overlay,
        openPinnedAction,
        restoreFocus,
        setOpen,
      })
    }
  }

  function executeDomainItem(item: DomainLauncherItem, customizeParams = false) {
    executeGlobalLauncherDomainItem({
      item,
      controller: controllerRef.current,
      customizeParams,
    })
  }

  function grantItemPermissionsAndRun() {
    if (!itemPermissionFrame) return
    grantGlobalLauncherItemPermissions(itemPermissionFrame, grantPluginPermissions)
    const item = itemPermissionFrame.item
    const customizeParams = itemPermissionFrame.customizeParams
    setItemPermissionFrame(null)
    executeDomainItem(item, customizeParams)
  }

  function cancelItemPermissionPrompt() {
    setItemPermissionFrame(null)
    focusSearchInputAfterBack()
  }

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

    if (hostSurfaceTarget) {
      clearLauncherHostSurface()
      focusSearchInputAfterBack()
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
  }, [clearLauncherHostSurface, closeLauncher, closeSettingsDialog, hostSurfaceTarget, itemPermissionFrame, launcherSettingsTarget, leaveSurface, settingsDialogTarget, surfaceFrame])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleHostEscape, true)
    return () => window.removeEventListener('keydown', handleHostEscape, true)
  }, [handleHostEscape, open])

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

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
      <LauncherView
        hostId="global-launcher"
        ref={panelRef}
        busy={controllerState?.busy ?? false}
        className="global-launcher-panel overflow-hidden outline-none palette-panel"
        style={panelStyle}
        tabIndex={-1}
        onPointerDown={beginDrag}
        onContextMenu={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return
          event.preventDefault()
        }}
        onKeyDown={(event) => handleGlobalLauncherKeyDown({
          event,
          isImeComposingRef,
          launcherSettingsTarget,
          closeSettingsDialog,
          focusSearchInputAfterBack,
          surfaceFrame,
          leaveSurface,
          itemPermissionFrame,
          cancelItemPermissionPrompt,
          controllerState,
          controllerRef,
          resultSelectedIndex,
          setResultSelectedIndex,
          toggleResultChoice,
          closeLauncher,
          isKeyboardNavRef,
          visibleFilteredLength: visibleFiltered.length,
          setSelectedIndex,
          selectedItem,
          isWorkflowObjectLauncherItem,
          selectItem,
        })}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        <GlobalLauncherFrameSwitch
          hostSurfaceTarget={hostSurfaceTarget}
          hostSurfaceHeight={STANDALONE_SURFACE_MAX_HEIGHT}
          launcherSettingsTarget={launcherSettingsTarget}
          settingsHeight={GLOBAL_LAUNCHER_SETTINGS_HEIGHT}
          surfaceFrame={surfaceFrame}
          activeSurfaceFrame={activeSurfaceFrame}
          itemPermissionFrame={itemPermissionFrame}
          controllerState={controllerState}
          inputRef={inputRef}
          query={query}
          searchPlaceholder={t(locale, 'palette.globalPlaceholder')}
          visibleFiltered={visibleFiltered}
          selectedItem={selectedItem}
          locale={locale}
          resultSelectedIndex={resultSelectedIndex}
          selectedResultChoiceIds={selectedResultChoiceIds}
          showCustomizeHint={selectedItem?.kind === 'domain' && supportsParamCustomization(selectedItem.domainItem)}
          showWorkflowObjectHint={isWorkflowObjectLauncherItem(selectedItem)}
          customizeShortcutLabel={getPlatformShortcutMeta().label}
          onSettingsClose={() => {
            closeSettingsDialog()
            focusSearchInputAfterBack()
          }}
          onSurfaceBack={requestSurfaceBack}
          onSurfaceClose={requestSurfaceClose}
          onPermissionBack={cancelItemPermissionPrompt}
          onPermissionGrant={grantItemPermissionsAndRun}
          onParamQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
          onParamSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
          onParamCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
          onParamMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
          onFrameBack={() => {
            controllerRef.current?.back()
            focusSearchInputAfterBack()
          }}
          onCollectInputChange={(value) => controllerRef.current?.setInputText(value)}
          onActivateResultChoice={activateResultChoice}
          onHoverResultChoice={setResultSelectedIndex}
          onToggleResultChoice={toggleResultChoice}
          onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0) }}
          onSearchSelectItem={(item) => selectItem(item)}
          onSearchHoverIndex={(index) => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
          onSearchMouseMove={() => { isKeyboardNavRef.current = false }}
        />
      </LauncherView>
    </div>
  )
}

function isStandaloneLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}
