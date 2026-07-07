import { useCallback, useEffect, useMemo, useRef, type FocusEvent } from 'react'
import { useAppStore } from '../../store'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { filterEditorCommandBarItems } from '../../workspace/launcher/types'
import { createQuickEditorLauncherApi } from '../../workspace/quickEditor/quickEditorActions'
import { GlobalLauncherFrameSwitch } from '../launcher/GlobalLauncherFrames'
import { useGlobalLauncherResultFrame } from '../launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../launcher/GlobalLauncherItems'
import { handleGlobalLauncherKeyDown } from '../launcher/GlobalLauncherKeyboard'
import { useGlobalLauncherImeComposition } from '../launcher/GlobalLauncherHostLifecycle'
import { executeGlobalLauncherDomainItem } from '../launcher/GlobalLauncherSelection'
import { isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'
import { quickEditorImperative } from './quickEditorImperative'
import { useT } from '../../i18n'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'

const MAX_OVERLAY_ITEMS = 12

export function QuickEditorCommandOverlay() {
  const open = useAppStore((s) => s.quickEditorCommandOpen)
  const closeCommand = useAppStore((s) => s.closeQuickEditorCommand)
  const locale = useAppStore((s) => s.locale)
  const tQuickEditor = useT('quickEditor')
  const inputRef = useRef<HTMLInputElement>(null)
  const isKeyboardNavRef = useRef(false)
  const internalPointerDownRef = useRef(false)
  const internalPointerResetRef = useRef<number | null>(null)
  const blurCloseFrameRef = useRef<number | null>(null)
  const { isImeComposingRef, handleCompositionStart, handleCompositionEnd } = useGlobalLauncherImeComposition()

  const {
    query,
    setQuery,
    selectedIndex,
    setSelectedIndex,
    controllerRef,
    controllerState,
    rankedItems,
  } = useLauncherSession({
    hostId: 'quick-editor-command',
    open,
    requestClose: closeCommandAndRestoreFocus,
    staticItemFilter: filterEditorCommandBarItems,
    makeApi: createQuickEditorLauncherApi,
  })

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
    controller: controllerRef.current,
    activeResultFrame: activeResultFrame?.kind === 'result' ? activeResultFrame : null,
  })

  const emptyClipboardBlock = useMemo<ClipboardObjectBlockState>(() => ({
    mode: 'search-only',
    block: null,
    hint: null,
    removeBlock: () => {},
    selectBlockForDelete: () => {},
    handleBackspace: () => false,
    attachHintAsBlock: () => {},
  }), [])

  const visibleFiltered = useMemo(() => buildGlobalLauncherItems({
    rankedLauncherItems: rankedItems.slice(0, MAX_OVERLAY_ITEMS),
    query,
    locale,
    recentActionNames: [],
    actionUsageCounts: {},
  }), [locale, query, rankedItems])
  const selectedItem = visibleFiltered[Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))]

  const selectMixedItem = (item?: GlobalLauncherItem) => {
    if (item?.kind === 'domain') {
      executeGlobalLauncherDomainItem({
        item: item.domainItem,
        controller: controllerRef.current,
      })
    }
  }
  const focusSearchInputAfterBack = () => requestAnimationFrame(() => inputRef.current?.focus())

  function closeCommandAndRestoreFocus() {
    closeCommand()
    requestAnimationFrame(() => quickEditorImperative.triggerFocus())
  }

  const overlayEscapeHandler = useCallback((event: KeyboardEvent): boolean => {
    if (controllerRef.current?.back?.()) {
      requestAnimationFrame(() => inputRef.current?.focus())
      event.preventDefault()
      event.stopPropagation()
      return true
    }
    event.preventDefault()
    event.stopPropagation()
    closeCommand()
    requestAnimationFrame(() => quickEditorImperative.triggerFocus())
    return true
  }, [closeCommand, controllerRef, inputRef])

  useEffect(() => {
    if (!open) return
    quickEditorImperative.registerOverlayEscape(overlayEscapeHandler)
    return () => quickEditorImperative.unregisterOverlayEscape()
  }, [open, overlayEscapeHandler])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open, setQuery, setSelectedIndex])

  useEffect(() => () => {
    if (internalPointerResetRef.current !== null) window.clearTimeout(internalPointerResetRef.current)
    if (blurCloseFrameRef.current !== null) window.cancelAnimationFrame(blurCloseFrameRef.current)
  }, [])

  if (!open) return null

  const isDetached = isQuickEditorDetachedWindow()

  const markInternalPointerDown = () => {
    internalPointerDownRef.current = true
    if (internalPointerResetRef.current !== null) window.clearTimeout(internalPointerResetRef.current)
    internalPointerResetRef.current = window.setTimeout(() => {
      internalPointerDownRef.current = false
      internalPointerResetRef.current = null
    }, 0)
  }

  const closeOnFocusLeave = (event: FocusEvent<HTMLDivElement>) => {
    const panel = event.currentTarget
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && panel.contains(nextTarget)) return
    if (blurCloseFrameRef.current !== null) window.cancelAnimationFrame(blurCloseFrameRef.current)
    blurCloseFrameRef.current = window.requestAnimationFrame(() => {
      blurCloseFrameRef.current = null
      const activeElement = document.activeElement
      if (internalPointerDownRef.current) return
      if (activeElement && panel.contains(activeElement)) return
      closeCommandAndRestoreFocus()
    })
  }

  const overlayContent = (
    <div
      data-launcher-host="quick-editor-command"
      className="quick-editor-command-panel z-50 flex flex-col overflow-hidden"
      tabIndex={-1}
      onPointerDownCapture={markInternalPointerDown}
      onBlur={closeOnFocusLeave}
      onKeyDown={(event) => handleGlobalLauncherKeyDown({
        event,
        isImeComposingRef,
        launcherSettingsTarget: null,
        hostSurfaceTarget: null,
        surfaceFrame: null,
        itemPermissionFrame: null,
        controllerState,
        controllerRef,
        resultSelectedIndex,
        setResultSelectedIndex,
        toggleResultChoice,
        isKeyboardNavRef,
        visibleFilteredLength: visibleFiltered.length,
        setSelectedIndex,
        selectedItem,
        isWorkflowObjectLauncherItem: () => false,
        selectItem: (item) => selectMixedItem(item),
      })}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    >
      <GlobalLauncherFrameSwitch
        hostSurfaceTarget={null}
        hostSurfaceHeight={0}
        launcherSettingsTarget={null}
        settingsHeight={0}
        surfaceFrame={null}
        activeSurfaceFrame={null}
        itemPermissionFrame={null}
        controllerState={controllerState}
        inputRef={inputRef}
        query={query}
        searchPlaceholder={tQuickEditor('commandPlaceholder')}
        visibleFiltered={visibleFiltered}
        selectedItem={selectedItem}
        locale={locale}
        resultSelectedIndex={resultSelectedIndex}
        selectedResultChoiceIds={selectedResultChoiceIds}
        showCustomizeHint={false}
        showWorkflowObjectHint={false}
        customizeShortcutLabel="⌘↵"
        onSettingsClose={closeCommandAndRestoreFocus}
        onSurfaceBack={closeCommandAndRestoreFocus}
        onSurfaceClose={closeCommandAndRestoreFocus}
        onPermissionBack={closeCommandAndRestoreFocus}
        onPermissionGrant={() => {}}
        onParamQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
        onParamSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
        onParamCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
        onParamMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
        onFrameBack={() => {
          if (controllerRef.current?.back?.()) focusSearchInputAfterBack()
          else closeCommandAndRestoreFocus()
        }}
        onCollectInputChange={(value) => controllerRef.current?.setInputText(value)}
        onActivateResultChoice={activateResultChoice}
        onHoverResultChoice={setResultSelectedIndex}
        onToggleResultChoice={toggleResultChoice}
        onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0) }}
        onSearchSelectItem={(item) => selectMixedItem(item)}
        onSearchHoverIndex={(index) => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
        onSearchMouseMove={() => { isKeyboardNavRef.current = false }}
        clipboardBlock={emptyClipboardBlock}
      />
    </div>
  )

  if (isDetached) {
    return (
      <div
        className="quick-editor-command-layer quick-editor-command-layer--detached absolute inset-0 z-50"
      >
        {overlayContent}
      </div>
    )
  }

  return (
    <div className="quick-editor-command-layer absolute inset-0 z-50">
      {overlayContent}
    </div>
  )
}
