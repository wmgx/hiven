import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { t, type Locale } from '../../i18n'
import type { LauncherHostSurfaceTarget, PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { CollectInputFrame, LauncherController, LauncherControllerState, ParamInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherExecuteResult, LauncherResultChoice } from '../../workspace/launcher/types'
import { createDeleteSavedActionItem, createRenameSavedActionItem } from '../../workspace/launcher/hostActions'
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
import { useAppStore } from '../../store'
import { showToast } from '../../workspace/toast'

type GlobalLauncherPanelProps = {
  panelRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  /** Prefer over inputRef for focus-on-mount (cold open). */
  bindSearchInputRef?: (node: HTMLInputElement | HTMLTextAreaElement | null) => void
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
  surfaceFillsWindow?: boolean
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
  pastePreviewText?: (text: string, isCurrent: () => boolean) => Promise<LauncherExecuteResult>
  toggleResultChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  closeLauncher: () => void
  visibleFiltered: GlobalLauncherItem[]
  nearbySaveItem?: GlobalLauncherItem
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
  browsingActions: boolean
  onBrowseActions: () => void
  onLeaveActionBrowser: () => void
  availableItemKeys: ReadonlySet<string>
  locale: Locale
  searchPlaceholder: string
  requestSurfaceBack: () => void
  requestSurfaceClose: () => void
  handleCompositionStart: () => void
  handleCompositionEnd: () => void
  clipboardBlock: ClipboardObjectBlockState
  onEditMaterial?: () => void
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
  surfaceFillsWindow = false,
  leaveSurface: _omit_leaveSurface,
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
  closeLauncher: _omit_closeLauncher,
  visibleFiltered,
  nearbySaveItem,
  selectedItem,
  selectedIndex = 0,
  setSelectedIndex,
  isWorkflowObjectLauncherItem,
  selectItem,
  hostSurfaceTarget,
  clearLauncherHostSurface: _omit_clearLauncherHostSurface,
  query,
  setQuery,
  browsingActions,
  onBrowseActions,
  onLeaveActionBrowser,
  availableItemKeys,
  locale,
  searchPlaceholder,
  requestSurfaceBack,
  requestSurfaceClose,
  handleCompositionStart,
  handleCompositionEnd,
  clipboardBlock,
  onEditMaterial,
  onExecuteObjectAction,
  objectActionCount = 0,
  selectedActionIndex,
  setSelectedActionIndex,
  onObjectActionController,
  expandSelectedObjectAction,
  executeSelectedObjectAction,
}: GlobalLauncherPanelProps) {
  const activatePreviewPaste = pastePreviewText
    ? (choice: LauncherResultChoice) => controllerRef.current?.activatePreviewPaste(choice, pastePreviewText)
    : undefined
  // Stable handlers so LauncherMixedListItem memo is not busted every parent render.
  const handleSearchSelectItem = useCallback((item: GlobalLauncherItem) => {
    selectItem(item)
  }, [selectItem])
  const handleRenameSavedAction = useCallback((item: GlobalLauncherItem) => {
    const artifactId = item.domainItem.savedActionArtifactId
    if (!artifactId) return
    void controllerRef.current?.selectItem(createRenameSavedActionItem(artifactId))
  }, [controllerRef])
  const handleDeleteSavedAction = useCallback((item: GlobalLauncherItem) => {
    if (!item.domainItem.savedActionArtifactId || !item.domainItem.savedActionSnapshot) return
    void controllerRef.current?.selectItem(createDeleteSavedActionItem(item.domainItem))
  }, [controllerRef])
  const toggleLauncherFavorite = useAppStore((s) => s.toggleLauncherFavorite)
  const launcherFavoriteKeys = useAppStore((s) => s.launcherFavoriteKeys)
  const handleToggleFavorite = useCallback((item: GlobalLauncherItem) => {
    const key = item.kind === 'domain' ? item.domainItem.systemKey : item.id
    if (!key || !availableItemKeys.has(key)) return
    const index = visibleFiltered.findIndex((candidate) => candidate.id === item.id)
    if (index >= 0) setSelectedIndex(index)
    try {
      // Preserve the Add/Remove intent shown in this render, even if another
      // window has already changed the same key before its storage event arrives.
      toggleLauncherFavorite(key, !launcherFavoriteKeys.includes(key))
    } catch {
      showToast(t(locale, 'palette.favoriteSaveFailed'), 'error')
    }
  }, [availableItemKeys, launcherFavoriteKeys, locale, setSelectedIndex, toggleLauncherFavorite, visibleFiltered])
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
  }, [query])

  /**
   * Debounced providers (app search, browser history/tabs, …) can re-rank or
   * insert rows under an already-hovering, perfectly still cursor — no native
   * mouseenter fires for that, so selectedIndex would keep pointing at the old
   * row index while a different item slides into it (reported as "hovering
   * row N, but row N+1 lights up"). Only resync when hover was already
   * driving selection — a fresh open/query must still not hover-select
   * whatever happens to sit under the cursor.
   */
  useEffect(() => {
    const pointer = lastPointerRef.current
    if (!hoverSelectArmedRef.current || !pointer) return
    const el = document.elementFromPoint(pointer.x, pointer.y)
    const row = el instanceof HTMLElement ? el.closest('[data-launcher-row-index]') : null
    if (!(row instanceof HTMLElement)) return
    const index = Number(row.dataset.launcherRowIndex)
    if (Number.isFinite(index)) setSelectedIndex(index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listIdentity])

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
        setResultSelectedIndex: setResultSelectedIndex as never,
        toggleResultChoice: toggleResultChoice as never,
        activateResultSecondary: activateSecondaryAction as never,
        pastePreviewText: activatePreviewPaste,
        isKeyboardNavRef,
        visibleFilteredLength: visibleFiltered.length,
        setSelectedIndex,
        selectedItem,
        visibleItems: visibleFiltered,
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
        surfaceFillsWindow={surfaceFillsWindow}
        itemPermissionFrame={itemPermissionFrame}
        controllerState={controllerState}
        inputRef={inputRef}
        bindSearchInputRef={bindSearchInputRef}
        query={query}
        searchPlaceholder={searchPlaceholder}
        visibleFiltered={visibleFiltered}
        nearbySaveItem={nearbySaveItem}
        selectedItem={selectedItem}
        locale={locale}
        resultSelectedIndex={resultSelectedIndex}
        selectedResultChoiceIds={selectedResultChoiceIds}
        showCustomizeHint={selectedItem?.kind === 'domain' && supportsParamCustomization(selectedItem.domainItem)}
        showWorkflowObjectHint={isWorkflowObjectLauncherItem(selectedItem)}
        customizeShortcutLabel={getPlatformShortcutMeta().label}
        isFavoriteSelected={isFavoriteSelected}
        isImeComposingRef={isImeComposingRef}
        browsingActions={browsingActions}
        onBrowseActions={onBrowseActions}
        onLeaveActionBrowser={onLeaveActionBrowser}
        truncateSearchItems={false}
        onToggleSearchFavorite={handleToggleFavorite}
        onRenameSavedAction={handleRenameSavedAction}
        onDeleteSavedAction={handleDeleteSavedAction}
        favoriteKeys={launcherFavoriteKeys}
        pinnableItemKeys={availableItemKeys}
        onSettingsClose={() => {
          closeSettingsDialog()
          focusSearchInputAfterBack()
        }}
        onSurfaceBack={requestSurfaceBack}
        onSurfaceClose={requestSurfaceClose}
        onPermissionBack={cancelItemPermissionPrompt}
        onPermissionGrant={grantItemPermissionsAndRun}
        onParamQueryChange={(value, frame) => controllerRef.current?.setParamQuery(value, frame)}
        onParamSelectedIndexChange={(index, frame) => controllerRef.current?.setParamSelectedIndex(index, frame)}
        onParamCommit={(value, frame) => { void controllerRef.current?.commitCurrentParam(value, frame) }}
        onParamMultiToggle={(value, frame) => controllerRef.current?.toggleCurrentMultiParamValue(value, frame)}
        onFrameBack={(frame) => {
          const handled = controllerRef.current?.back(frame)
          if (handled || !frame) focusSearchInputAfterBack()
        }}
        onExitCommand={(frame) => {
          const ctl = controllerRef.current as { exitCommand?: (frame?: CollectInputFrame | ParamInputFrame) => boolean; back?: (frame?: CollectInputFrame | ParamInputFrame) => boolean } | null
          const handled = ctl?.exitCommand ? ctl.exitCommand(frame) : ctl?.back?.(frame)
          if (handled || !frame) focusSearchInputAfterBack()
        }}
        onCollectInputChange={(value, frame) => controllerRef.current?.setInputText(value, frame)}
        onActivateResultChoice={activateResultChoice}
        onSecondaryAction={activateSecondaryAction}
        onPastePreviewText={activatePreviewPaste}
        canEditPreviewParam={(key, frame) => Boolean(controllerRef.current?.canEditPreviewParam(key, frame))}
        onEditPreviewParam={(key, frame) => controllerRef.current?.editPreviewParam(key, frame)}
        onSubmitCollectInput={(frame) => { void controllerRef.current?.submitInput?.(frame) }}
        onCaptureSelection={() => { void controllerRef.current?.captureInput() }}
        onHoverResultChoice={setResultSelectedIndex}
        onToggleResultChoice={toggleResultChoice}
        onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0, { pin: false }) }}
        onSearchSelectItem={handleSearchSelectItem}
        onSearchHoverIndex={handleSearchHoverIndex}
        onSearchMouseMove={handleSearchMouseMove}
        isKeyboardNavRef={isKeyboardNavRef}
        clipboardBlock={clipboardBlock}
        onEditMaterial={onEditMaterial}
        clipboardHintSelected={selectedIndex < 0}
        onExecuteAction={onExecuteObjectAction}
        selectedActionIndex={selectedActionIndex}
        onSelectedActionIndexChange={setSelectedActionIndex}
        onObjectActionController={onObjectActionController}
      />
    </LauncherView>
  )
}
