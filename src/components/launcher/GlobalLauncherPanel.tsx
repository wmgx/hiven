import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { Locale } from '../../i18n'
import type { LauncherHostSurfaceTarget, PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { LauncherController, LauncherControllerState, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import type { GlobalLauncherActiveSurfaceFrame } from './GlobalLauncherFrames'
import { GlobalLauncherFrameSwitch } from './GlobalLauncherFrames'
import type { GlobalLauncherPermissionFrameState } from './GlobalLauncherPermissionFrame'
import { LauncherView } from './LauncherView'
import { getPlatformShortcutMeta, supportsParamCustomization } from './launcherParamShortcuts'
import { handleGlobalLauncherKeyDown } from './GlobalLauncherKeyboard'
import type { GlobalLauncherItem } from './GlobalLauncherItems'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import type { RecommendedAction, RecommendedOutputTarget } from '../../launcher/clipboard/actionRecommendation'
import { GLOBAL_LAUNCHER_SETTINGS_HEIGHT, STANDALONE_SURFACE_MAX_HEIGHT } from './GlobalLauncherLayout'
import { MAX_VISIBLE_IDLE } from './LauncherMixedList'
import { useAppStore } from '../../store'

type GlobalLauncherPanelProps = {
  panelRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
  /** Prefer over inputRef for focus-on-mount (cold open). */
  bindSearchInputRef?: (node: HTMLInputElement | null) => void
  controllerRef: RefObject<LauncherController | null>
  isImeComposingRef: RefObject<boolean>
  isKeyboardNavRef: RefObject<boolean>
  busy: boolean
  panelStyle: React.CSSProperties
  beginDrag: (event: React.PointerEvent<HTMLElement>) => void
  launcherSettingsTarget: { pluginId: string; source: PluginSettingsSource } | null
  closeSettingsDialog: () => void
  focusSearchInputAfterBack: () => void
  surfaceFrame: PluginSurfaceOpenTarget | null
  activeSurfaceFrame: GlobalLauncherActiveSurfaceFrame | null
  leaveSurface: () => void
  itemPermissionFrame: GlobalLauncherPermissionFrameState | null
  cancelItemPermissionPrompt: () => void
  grantItemPermissionsAndRun: () => void
  controllerState: LauncherControllerState | null | undefined
  resultSelectedIndex: number
  setResultSelectedIndex: (index: number) => void
  selectedResultChoiceIds: Set<string>
  activateResultChoice: (choice: LauncherResultChoice) => void
  activateSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  /** Package 4: paste collect-input preview text to foreground app. */
  pastePreviewText?: (text: string) => void | Promise<void>
  toggleResultChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  closeLauncher: () => void
  visibleFiltered: GlobalLauncherItem[]
  selectedItem?: GlobalLauncherItem
  /** List selection; -1 means recent-clipboard hint is focused. */
  selectedIndex?: number
  setSelectedIndex: (
    index: number | ((index: number) => number),
    options?: { pin?: boolean },
  ) => void
  isWorkflowObjectLauncherItem: (item: GlobalLauncherItem | undefined) => boolean
  selectItem: (item: GlobalLauncherItem | undefined, customizeParams?: boolean) => void
  hostSurfaceTarget: LauncherHostSurfaceTarget | null
  clearLauncherHostSurface: () => void
  query: string
  setQuery: (value: string) => void
  locale: Locale
  searchPlaceholder: string
  requestSurfaceBack: () => void
  requestSurfaceClose: () => void
  handleCompositionStart: () => void
  handleCompositionEnd: () => void
  clipboardBlock: ClipboardObjectBlockState
  onExecuteObjectAction?: (action: RecommendedAction, target: RecommendedOutputTarget) => void
  objectActionCount?: number
  selectedActionIndex?: number
  setSelectedActionIndex?: (index: number | ((index: number) => number)) => void
  onObjectActionController?: (controller: { expand: () => void; execute: (keepOpen?: boolean) => void } | null) => void
  expandSelectedObjectAction?: () => void
  executeSelectedObjectAction?: (keepOpen?: boolean) => void
}


export function GlobalLauncherPanel({
  panelRef,
  inputRef,
  bindSearchInputRef,
  controllerRef,
  isImeComposingRef,
  isKeyboardNavRef,
  busy,
  panelStyle,
  beginDrag,
  launcherSettingsTarget,
  closeSettingsDialog,
  focusSearchInputAfterBack,
  surfaceFrame,
  activeSurfaceFrame,
  leaveSurface,
  itemPermissionFrame,
  cancelItemPermissionPrompt,
  grantItemPermissionsAndRun,
  controllerState,
  resultSelectedIndex,
  setResultSelectedIndex,
  selectedResultChoiceIds,
  activateResultChoice,
  activateSecondaryAction,
  pastePreviewText,
  toggleResultChoice,
  closeLauncher,
  visibleFiltered,
  selectedItem,
  selectedIndex = 0,
  setSelectedIndex,
  isWorkflowObjectLauncherItem,
  selectItem,
  hostSurfaceTarget,
  clearLauncherHostSurface,
  query,
  setQuery,
  locale,
  searchPlaceholder,
  requestSurfaceBack,
  requestSurfaceClose,
  handleCompositionStart,
  handleCompositionEnd,
  clipboardBlock,
  onExecuteObjectAction,
  objectActionCount = 0,
  selectedActionIndex,
  setSelectedActionIndex,
  onObjectActionController,
  expandSelectedObjectAction,
  executeSelectedObjectAction,
}: GlobalLauncherPanelProps) {
  // Stable handlers so LauncherMixedListItem memo is not busted every parent render.
  const handleSearchSelectItem = useCallback((item: GlobalLauncherItem) => {
    selectItem(item)
  }, [selectItem])
  const toggleLauncherFavorite = useAppStore((s) => s.toggleLauncherFavorite)
  const launcherFavoriteKeys = useAppStore((s) => s.launcherFavoriteKeys)
  const handleToggleFavorite = useCallback((item: GlobalLauncherItem) => {
    const key = item.kind === 'domain' ? item.domainItem.systemKey : item.id
    if (key) toggleLauncherFavorite(key)
  }, [toggleLauncherFavorite])
  const isFavoriteSelected = Boolean(
    selectedItem
      && launcherFavoriteKeys.includes(
        selectedItem.kind === 'domain' ? selectedItem.domainItem.systemKey : selectedItem.id,
      ),
  )
  /**
   * Hover select only after real pointer movement.
   * Initial overlap (open under cursor / list re-render under cursor) must not
   * steal the keyboard/default selection.
   */
  const hoverSelectArmedRef = useRef(false)
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null)
  const listIdentity = visibleFiltered.map((item) => item.id).join('\0')
  useEffect(() => {
    hoverSelectArmedRef.current = false
    lastPointerRef.current = null
  }, [query, listIdentity])

  const handleSearchHoverIndex = useCallback((index: number) => {
    if (!hoverSelectArmedRef.current) return
    if (isKeyboardNavRef.current) return
    setSelectedIndex(index)
  }, [isKeyboardNavRef, setSelectedIndex])

  const handleSearchMouseMove = useCallback((event: { clientX: number; clientY: number; target: EventTarget | null }) => {
    const prev = lastPointerRef.current
    const next = { x: event.clientX, y: event.clientY }
    lastPointerRef.current = next
    // First sample only records position — no select yet.
    if (!prev) return
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    // ~2px movement threshold filters layout/jitter without feeling laggy.
    if (dx * dx + dy * dy < 4) return

    hoverSelectArmedRef.current = true
    isKeyboardNavRef.current = false

    // After keyboard nav, mouseenter may not re-fire on the same row — pick under pointer.
    const row = (event.target as HTMLElement | null)?.closest?.('[data-launcher-row-index]')
    if (row instanceof HTMLElement) {
      const index = Number(row.dataset.launcherRowIndex)
      if (Number.isFinite(index)) setSelectedIndex(index)
    }
  }, [isKeyboardNavRef, setSelectedIndex])
  return (
    <LauncherView
      hostId="global-launcher"
      ref={panelRef}
      busy={busy}
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
        hostSurfaceTarget,
        surfaceFrame,
        itemPermissionFrame,
        controllerState,
        controllerRef,
        resultSelectedIndex,
        setResultSelectedIndex,
        toggleResultChoice,
        activateResultSecondary: activateSecondaryAction,
        pastePreviewText,
        isKeyboardNavRef,
        visibleFilteredLength: !query && visibleFiltered.length > MAX_VISIBLE_IDLE
          ? MAX_VISIBLE_IDLE
          : visibleFiltered.length,
        setSelectedIndex,
        selectedItem,
        visibleItems: !query && visibleFiltered.length > MAX_VISIBLE_IDLE
          ? visibleFiltered.slice(0, MAX_VISIBLE_IDLE)
          : visibleFiltered,
        isWorkflowObjectLauncherItem,
        selectItem,
        handleClipboardBackspace: clipboardBlock?.handleBackspace,
        hasClipboardHint: Boolean(clipboardBlock?.hint && !clipboardBlock?.block),
        attachHintAsBlock: clipboardBlock?.attachHintAsBlock,
        isClipboardHintSelected: selectedIndex < 0,
        selectedIndex,
        // Clipboard recommendations are rendered as normal launcher list rows
        // (plugin dynamicItems). Dedicated RecommendedActionRow UI is disabled,
        // so arrow keys must drive selectedIndex — not selectedObjectActionIndex.
        hasObjectActions: false,
        objectActionCount,
        setSelectedObjectActionIndex: setSelectedActionIndex,
        expandSelectedObjectAction,
        executeSelectedObjectAction,
        onToggleFavorite: handleToggleFavorite,
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
        bindSearchInputRef={bindSearchInputRef}
        query={query}
        searchPlaceholder={searchPlaceholder}
        visibleFiltered={visibleFiltered}
        selectedItem={selectedItem}
        locale={locale}
        resultSelectedIndex={resultSelectedIndex}
        selectedResultChoiceIds={selectedResultChoiceIds}
        showCustomizeHint={selectedItem?.kind === 'domain' && supportsParamCustomization(selectedItem.domainItem)}
        showWorkflowObjectHint={isWorkflowObjectLauncherItem(selectedItem)}
        customizeShortcutLabel={getPlatformShortcutMeta().label}
        isFavoriteSelected={isFavoriteSelected}
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
        onExitCommand={() => {
          const ctl = controllerRef.current as { exitCommand?: () => boolean; back?: () => boolean } | null
          if (ctl?.exitCommand) ctl.exitCommand()
          else ctl?.back?.()
          focusSearchInputAfterBack()
        }}
        onCollectInputChange={(value) => controllerRef.current?.setInputText(value)}
        onActivateResultChoice={activateResultChoice}
        onSecondaryAction={activateSecondaryAction}
        onPastePreviewText={pastePreviewText}
        onSubmitCollectInput={() => { void controllerRef.current?.submitInput?.() }}
        onHoverResultChoice={setResultSelectedIndex}
        onToggleResultChoice={toggleResultChoice}
        onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0, { pin: false }) }}
        onSearchSelectItem={handleSearchSelectItem}
        onSearchHoverIndex={handleSearchHoverIndex}
        onSearchMouseMove={handleSearchMouseMove}
        isKeyboardNavRef={isKeyboardNavRef}
        clipboardBlock={clipboardBlock}
        clipboardHintSelected={selectedIndex < 0}
        onExecuteAction={onExecuteObjectAction}
        selectedActionIndex={selectedActionIndex}
        onSelectedActionIndexChange={setSelectedActionIndex}
        onObjectActionController={onObjectActionController}
      />
    </LauncherView>
  )
}
