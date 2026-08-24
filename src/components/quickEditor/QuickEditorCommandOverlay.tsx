import { useCallback, useEffect, useMemo, useRef, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  const initialQuery = useAppStore((s) => s.quickEditorCommandInitialQuery)
  const closeCommand = useAppStore((s) => s.closeQuickEditorCommand)
  const locale = useAppStore((s) => s.locale)
  const tQuickEditor = useT('quickEditor')
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const isKeyboardNavRef = useRef(false)
  const internalPointerDownRef = useRef(false)
  const internalPointerResetRef = useRef<number | null>(null)
  const blurCloseFrameRef = useRef<number | null>(null)
  /** Suppress blur-close while React remounts header (search → result frame). */
  const suppressBlurCloseUntilRef = useRef(0)
  const { isImeComposingRef, handleCompositionStart, handleCompositionEnd } = useGlobalLauncherImeComposition()

  const {
    query,
    rankingQuery,
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
  const isResultFrame = activeResultFrame?.kind === 'result'
  const {
    resultSelectedIndex,
    setResultSelectedIndex,
    selectedResultChoiceIds,
    activateResultChoice,
    activateSecondaryAction,
    toggleResultChoice,
  } = useGlobalLauncherResultFrame({
    controller: controllerRef.current,
    activeResultFrame: isResultFrame ? activeResultFrame : null,
  })

  const emptyClipboardBlock = useMemo<ClipboardObjectBlockState>(() => ({
    mode: 'search-only',
    block: null,
    isExiting: false,
    hint: null,
    removeBlock: () => {},
    selectBlockForDelete: () => {},
    handleBackspace: () => false,
    attachHintAsBlock: () => {},
  }), [])

  const visibleFiltered = useMemo(() => buildGlobalLauncherItems({
    rankedLauncherItems: rankedItems.slice(0, MAX_OVERLAY_ITEMS),
    query: rankingQuery,
    locale,
  }), [locale, rankingQuery, rankedItems])
  const selectedItem = visibleFiltered[Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))]

  const hoverSelectArmedRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const listIdentity = visibleFiltered.map((item) => item.id).join('\0')
  useEffect(() => {
    hoverSelectArmedRef.current = false
    lastPointerRef.current = null
  }, [query, listIdentity])

  const handleSearchHoverIndex = (index: number) => {
    if (!hoverSelectArmedRef.current || isKeyboardNavRef.current) return
    setSelectedIndex(index)
  }

  const handleSearchMouseMove = (event: { clientX: number; clientY: number; target: EventTarget | null }) => {
    const previous = lastPointerRef.current
    const next = { x: event.clientX, y: event.clientY }
    lastPointerRef.current = next
    if (!previous) return
    const dx = next.x - previous.x
    const dy = next.y - previous.y
    if (dx * dx + dy * dy < 4) return

    hoverSelectArmedRef.current = true
    isKeyboardNavRef.current = false
    const row = (event.target as HTMLElement | null)?.closest?.('[data-launcher-row-index]')
    if (row instanceof HTMLElement) {
      const index = Number(row.dataset.launcherRowIndex)
      if (Number.isFinite(index)) setSelectedIndex(index)
    }
  }

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
      if (initialQuery) {
        setQuery(initialQuery)
        setSelectedIndex(0, { pin: false })
      }
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setSelectedIndex(0, { pin: false })
    }
  }, [open, initialQuery, setQuery, setSelectedIndex])

  // Result frame has no search input — keep the panel focused so ↑↓ / Space work.
  useEffect(() => {
    if (!open || !isResultFrame) return
    suppressBlurCloseUntilRef.current = Date.now() + 120
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, isResultFrame, activeResultFrame?.kind === 'result' ? activeResultFrame.sourceTitle : null])

  // Capture-phase window listener: result list has no inputs; React onKeyDown
  // only fires when the panel subtree is focused. Monaco/editor may steal focus.
  useEffect(() => {
    if (!open || !isResultFrame) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const key = event.key
      const isNav =
        key === 'ArrowDown' ||
        key === 'ArrowUp' ||
        key === 'Enter' ||
        key === ' ' ||
        key === 'Spacebar' ||
        event.code === 'Space'
      if (!isNav) return
      // Synthesize a minimal React-like event for the shared handler.
      const synthetic = {
        key: event.key,
        code: event.code,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
        defaultPrevented: event.defaultPrevented,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        target: event.target,
      } as unknown as ReactKeyboardEvent<HTMLElement>
      handleGlobalLauncherKeyDown({
        event: synthetic,
        isImeComposingRef,
        launcherSettingsTarget: null,
        hostSurfaceTarget: null,
        surfaceFrame: null,
        itemPermissionFrame: null,
        controllerState,
        controllerRef,
        resultSelectedIndex,
        setResultSelectedIndex: setResultSelectedIndex as never,
        toggleResultChoice: toggleResultChoice as never,
        isKeyboardNavRef,
        visibleFilteredLength: visibleFiltered.length,
        setSelectedIndex,
        selectedItem,
        isWorkflowObjectLauncherItem: () => false,
        selectItem: (item) => selectMixedItem(item),
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    open,
    isResultFrame,
    controllerState,
    controllerRef,
    resultSelectedIndex,
    setResultSelectedIndex,
    toggleResultChoice,
    isImeComposingRef,
    visibleFiltered.length,
    selectedItem,
    setSelectedIndex,
  ])

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
    if (Date.now() < suppressBlurCloseUntilRef.current) return
    const panel = event.currentTarget
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && panel.contains(nextTarget)) return
    if (blurCloseFrameRef.current !== null) window.cancelAnimationFrame(blurCloseFrameRef.current)
    blurCloseFrameRef.current = window.requestAnimationFrame(() => {
      blurCloseFrameRef.current = null
      if (Date.now() < suppressBlurCloseUntilRef.current) return
      const activeElement = document.activeElement
      if (internalPointerDownRef.current) return
      if (activeElement && panel.contains(activeElement)) return
      closeCommandAndRestoreFocus()
    })
  }

  const handlePanelKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    handleGlobalLauncherKeyDown({
      event,
      isImeComposingRef,
      launcherSettingsTarget: null,
      hostSurfaceTarget: null,
      surfaceFrame: null,
      itemPermissionFrame: null,
      controllerState,
      controllerRef,
      resultSelectedIndex,
      setResultSelectedIndex: setResultSelectedIndex as never,
      toggleResultChoice: toggleResultChoice as never,
      isKeyboardNavRef,
      visibleFilteredLength: visibleFiltered.length,
      setSelectedIndex,
      selectedItem,
      isWorkflowObjectLauncherItem: () => false,
      selectItem: (item) => selectMixedItem(item),
    })
  }

  const overlayContent = (
    <div
      ref={panelRef}
      data-launcher-host="quick-editor-command"
      className="quick-editor-command-panel z-50 flex flex-col overflow-hidden outline-none"
      tabIndex={-1}
      onPointerDownCapture={markInternalPointerDown}
      onBlur={closeOnFocusLeave}
      onKeyDown={handlePanelKeyDown}
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
        onSecondaryAction={activateSecondaryAction}
        onHoverResultChoice={setResultSelectedIndex}
        onToggleResultChoice={toggleResultChoice}
        onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0, { pin: false }) }}
        onSearchSelectItem={(item) => selectMixedItem(item)}
        onSearchHoverIndex={handleSearchHoverIndex}
        onSearchMouseMove={handleSearchMouseMove}
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
