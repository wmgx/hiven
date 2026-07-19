import type { RefObject } from 'react'
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

type GlobalLauncherPanelProps = {
  panelRef: RefObject<HTMLDivElement | null>
  inputRef: RefObject<HTMLInputElement | null>
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
  toggleResultChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  closeLauncher: () => void
  visibleFiltered: GlobalLauncherItem[]
  selectedItem?: GlobalLauncherItem
  setSelectedIndex: (index: number | ((index: number) => number)) => void
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
  toggleResultChoice,
  closeLauncher,
  visibleFiltered,
  selectedItem,
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
        isKeyboardNavRef,
        visibleFilteredLength: !query && visibleFiltered.length > MAX_VISIBLE_IDLE
          ? MAX_VISIBLE_IDLE
          : visibleFiltered.length,
        setSelectedIndex,
        selectedItem,
        isWorkflowObjectLauncherItem,
        selectItem,
        handleClipboardBackspace: clipboardBlock?.handleBackspace,
        hasClipboardHint: Boolean(clipboardBlock?.hint && !clipboardBlock?.block),
        attachHintAsBlock: clipboardBlock?.attachHintAsBlock,
        hasObjectActions: Boolean(clipboardBlock?.block && objectActionCount > 0),
        objectActionCount,
        setSelectedObjectActionIndex: setSelectedActionIndex,
        expandSelectedObjectAction,
        executeSelectedObjectAction,
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
        searchPlaceholder={searchPlaceholder}
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
        onSecondaryAction={activateSecondaryAction}
        onHoverResultChoice={setResultSelectedIndex}
        onToggleResultChoice={toggleResultChoice}
        onSearchQueryChange={(value) => { setQuery(value); setSelectedIndex(0) }}
        onSearchSelectItem={(item) => selectItem(item)}
        onSearchHoverIndex={(index) => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
        onSearchMouseMove={() => { isKeyboardNavRef.current = false }}
        clipboardBlock={clipboardBlock}
        onExecuteAction={onExecuteObjectAction}
        selectedActionIndex={selectedActionIndex}
        onSelectedActionIndexChange={setSelectedActionIndex}
        onObjectActionController={onObjectActionController}
      />
    </LauncherView>
  )
}
