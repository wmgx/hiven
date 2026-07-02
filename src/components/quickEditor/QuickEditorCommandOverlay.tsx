import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../../store'
import { useLauncherSession } from '../../workspace/launcher/useLauncherSession'
import { filterEditorCommandBarItems } from '../../workspace/launcher/types'
import { createQuickEditorLauncherApi } from '../../workspace/quickEditor/quickEditorActions'
import { GlobalLauncherFrameSwitch } from '../launcher/GlobalLauncherFrames'
import { useGlobalLauncherResultFrame } from '../launcher/GlobalLauncherResults'
import { buildGlobalLauncherItems, type GlobalLauncherItem } from '../launcher/GlobalLauncherItems'
import { handleGlobalLauncherKeyDown } from '../launcher/GlobalLauncherKeyboard'
import { useGlobalLauncherImeComposition } from '../launcher/GlobalLauncherHostLifecycle'
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
    requestClose: closeCommand,
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
    pinnedActions: [],
    rankedLauncherItems: rankedItems.slice(0, MAX_OVERLAY_ITEMS),
    query,
    locale,
    recentActionNames: [],
    actionUsageCounts: {},
  }), [locale, query, rankedItems])
  const selectedItem = visibleFiltered[Math.min(selectedIndex, Math.max(0, visibleFiltered.length - 1))]

  const selectMixedItem = (item?: GlobalLauncherItem) => {
    if (item?.kind === 'domain') controllerRef.current?.selectItem(item.domainItem)
  }
  const focusSearchInputAfterBack = () => requestAnimationFrame(() => inputRef.current?.focus())

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
      setSelectedIndex(0)
    }
  }, [open, setQuery, setSelectedIndex])

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col overflow-hidden"
      style={{
        background: 'var(--color-background-primary, var(--panel, #fff))',
        borderRadius: 'inherit',
      }}
      onKeyDown={(event) => handleGlobalLauncherKeyDown({
        event,
        isImeComposingRef,
        launcherSettingsTarget: null,
        closeSettingsDialog: () => {},
        focusSearchInputAfterBack,
        hostSurfaceTarget: null,
        clearLauncherHostSurface: undefined,
        surfaceFrame: null,
        leaveSurface: () => {},
        itemPermissionFrame: null,
        cancelItemPermissionPrompt: () => {},
        controllerState,
        controllerRef,
        resultSelectedIndex,
        setResultSelectedIndex,
        toggleResultChoice,
        closeLauncher: closeCommand,
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
        onSettingsClose={closeCommand}
        onSurfaceBack={closeCommand}
        onSurfaceClose={closeCommand}
        onPermissionBack={closeCommand}
        onPermissionGrant={() => {}}
        onParamQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
        onParamSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
        onParamCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
        onParamMultiToggle={(value) => controllerRef.current?.toggleCurrentMultiParamValue(value)}
        onFrameBack={() => {
          if (controllerRef.current?.back?.()) focusSearchInputAfterBack()
          else closeCommand()
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
}
