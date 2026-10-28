import type { LauncherSearchRecovery } from '../../workspace/launcher/searchRecovery'
import { type MouseEvent as ReactMouseEvent, type MutableRefObject, type ReactNode, type RefObject } from 'react'
import { t, type Locale } from '../../i18n'
import { localized, type LauncherHostSurfaceTarget, type PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsDialogTarget } from '../../workspace/pluginSettingsStore'
import type { AiSendFrame, CollectInputFrame, LauncherControllerState, ParamInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherBranchChoices, resolveParamValueLabel } from './LauncherBranchChoices'
import type { LauncherMixedItem } from './LauncherMixedList'
import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import { GlobalLauncherSystemSurfaceFrame } from './GlobalLauncherSystemSurfaceFrame'
import { GlobalLauncherSettingsFrame } from './GlobalLauncherSettingsFrame'
import { GlobalLauncherPluginSurfaceFrame } from './GlobalLauncherPluginSurfaceFrame'
import { GlobalLauncherSearchFrame } from './GlobalLauncherSearchFrame'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import { GlobalLauncherResultFrame } from './GlobalLauncherResultFrame'
import { GlobalLauncherPermissionFrame, type GlobalLauncherPermissionFrameState } from './GlobalLauncherPermissionFrame'
import { GlobalLauncherCollectInputFrame } from './GlobalLauncherCollectInputFrame'
import { GlobalLauncherAiSendFrame } from './GlobalLauncherAiSendFrame'
import type { LauncherSurfaceUnsavedChangesReport } from './useLauncherSurfaceBackgroundIdle'
import type { LauncherBrowseCategory } from '../../workspace/launcher/browseItems'
import { surfaceHeight } from '../../workspace/surfaceGeometry'

export type GlobalLauncherActiveSurfaceFrame = {
  surface: PluginUiSurfaceContribution
}

export function GlobalLauncherFrameSwitch({
  hostSurfaceTarget,
  hostSurfaceHeight,
  launcherSettingsTarget,
  settingsHeight,
  surfaceFrame,
  activeSurfaceFrame,
  surfaceFillsWindow = false,
  itemPermissionFrame,
  controllerState,
  inputRef,
  bindSearchInputRef,
  query,
  searchRecovery,
  searchPlaceholder,
  searchContext,
  visibleFiltered,
  selectedItem,
  locale,
  resultSelectedIndex,
  selectedResultChoiceIds,
  isFavoriteSelected,
  isImeComposingRef,
  browsingActions,
  browseCategory,
  onBrowseCategoryChange,
  onBrowseActions,
  onLeaveActionBrowser,
  truncateSearchItems,
  onToggleSearchFavorite,
  favoriteKeys,
  pinnableItemKeys,
  onSettingsClose,
  onSurfaceBack,
  onSurfaceClose,
  onSurfaceUnsavedChangesReport,
  onPermissionBack,
  onPermissionGrant,
  onParamQueryChange,
  onParamSelectedIndexChange,
  onParamCommit,
  onParamMultiToggle,
  onFrameBack,
  onExitCommand,
  onCollectInputChange,
  onRemoveCommandBlock,
  onCommandParamChange,
  onCommandBlockChange,
  onCopyAllChoices,
  onNextParam,
  onActivateResultChoice,
  onSecondaryAction,
  onPastePreviewText,
  onSubmitCollectInput,
  onHoverResultChoice,
  onToggleResultChoice,
  onSearchQueryChange,
  onSearchSelectItem,
  onSearchHoverIndex,
  onSearchMouseMove,
  isKeyboardNavRef,
  clipboardBlock,
  clipboardHintSelected,
  aiSendActions,
}: {
  /** Controller intents for the AI send confirmation and the disclosure line. */
  aiSendActions?: { confirm: () => void; toggleRemember: () => void; openSettings?: () => void; revoke: () => void }
  hostSurfaceTarget: LauncherHostSurfaceTarget | null
  hostSurfaceHeight: number
  launcherSettingsTarget: PluginSettingsDialogTarget
  settingsHeight: number
  surfaceFrame: PluginSurfaceOpenTarget | null
  activeSurfaceFrame: GlobalLauncherActiveSurfaceFrame | null
  surfaceFillsWindow?: boolean
  itemPermissionFrame: GlobalLauncherPermissionFrameState | null
  controllerState: { frames: Array<CollectInputFrame | ParamInputFrame | ResultFrame | { kind: string }>; error?: string | null; busy: boolean; deliveryIntent?: LauncherControllerState['deliveryIntent'] } | null | undefined
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  bindSearchInputRef?: (node: HTMLInputElement | HTMLTextAreaElement | null) => void
  query: string
  searchRecovery?: LauncherSearchRecovery
  searchPlaceholder: string
  searchContext?: string
  visibleFiltered: LauncherMixedItem[]
  selectedItem?: LauncherMixedItem
  locale: Locale
  resultSelectedIndex: number
  selectedResultChoiceIds: Set<string>
  /** Focused row is in launcher favorites. */
  isFavoriteSelected?: boolean
  isImeComposingRef: RefObject<boolean>
  browsingActions?: boolean
  browseCategory?: LauncherBrowseCategory
  onBrowseCategoryChange?: (category: LauncherBrowseCategory) => void
  onBrowseActions?: () => void
  onLeaveActionBrowser?: () => void
  truncateSearchItems?: boolean
  onToggleSearchFavorite?: (item: LauncherMixedItem) => void
  favoriteKeys?: readonly string[]
  pinnableItemKeys?: ReadonlySet<string>
  onSettingsClose: () => void
  onSurfaceBack: () => void
  onSurfaceClose: () => void
  onSurfaceUnsavedChangesReport?: (report: LauncherSurfaceUnsavedChangesReport) => void
  onPermissionBack: () => void
  onPermissionGrant: () => void
  onParamQueryChange: (value: string, frame?: ParamInputFrame) => void
  onParamSelectedIndexChange: (index: number, frame?: ParamInputFrame) => void
  onParamCommit: (value: unknown, frame?: ParamInputFrame) => void
  onParamMultiToggle: (value: unknown, frame?: ParamInputFrame) => void
  onFrameBack: (frame?: CollectInputFrame | ParamInputFrame) => void
  /** Command-tag × — pop entire command stack to list. */
  onExitCommand?: (frame?: CollectInputFrame | ParamInputFrame) => void
  onCollectInputChange: (value: string, frame?: CollectInputFrame) => void
  onRemoveCommandBlock?: (frame: CollectInputFrame) => void
  onCommandParamChange?: (key: string, value: unknown, frame: CollectInputFrame) => boolean | undefined
  /** paste: material becomes a Block · edit: ⌘E editor text · sync: replace the list Block */
  onCommandBlockChange?: (change: 'paste' | 'edit' | 'sync', text: string, frame: CollectInputFrame) => void
  /** ⌘↵ on a list of text results. */
  onCopyAllChoices?: () => void
  onNextParam?: (frame: ParamInputFrame) => void
  onActivateResultChoice: (choice: LauncherResultChoice) => void
  /** Collect-input / result secondary actions (id is plugin-defined). */
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  /** Package 4: paste live-preview text into the foreground app. */
  onPastePreviewText?: (choice: LauncherResultChoice) => void | Promise<void>
  /** Package 4: default collect-input submit when no destination chrome. */
  onSubmitCollectInput?: (frame?: CollectInputFrame) => void
  onHoverResultChoice: (index: number) => void
  onToggleResultChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  onSearchQueryChange: (value: string) => void
  onSearchSelectItem: (item: LauncherMixedItem) => void
  onSearchHoverIndex: (index: number) => void
  onSearchMouseMove: (event: ReactMouseEvent) => void
  isKeyboardNavRef?: MutableRefObject<boolean>
  clipboardBlock?: ClipboardObjectBlockState
  /** Recent-clipboard hint is the focused row (selectedIndex === -1). */
  clipboardHintSelected?: boolean
}) {
  if (hostSurfaceTarget) {
    return (
      <GlobalLauncherSystemSurfaceFrame
        target={hostSurfaceTarget}
        height={hostSurfaceHeight}
        onBack={onSurfaceBack}
        onClose={onSurfaceClose}
      />
    )
  }

  if (launcherSettingsTarget) {
    return (
      <GlobalLauncherSettingsFrame
        pluginId={launcherSettingsTarget.pluginId}
        source={launcherSettingsTarget.source}
        target={launcherSettingsTarget.target}
        locale={locale}
        height={settingsHeight}
        onClose={onSettingsClose}
      />
    )
  }

  if (surfaceFrame) {
    if (!activeSurfaceFrame) {
      return <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.surfaceNotFound')}</div>
    }
    const shell = activeSurfaceFrame.surface.shell
    return (
      <GlobalLauncherPluginSurfaceFrame
        target={surfaceFrame}
        locale={locale}
        shellHeight={surfaceHeight(shell?.inlineHeight)}
        autoHeight={shell?.autoHeight}
        fillsWindow={surfaceFillsWindow}
        title={localized(activeSurfaceFrame.surface.title, activeSurfaceFrame.surface.titleI18n, locale)}
        onUnsavedChangesReport={onSurfaceUnsavedChangesReport}
        onBack={onSurfaceBack}
        onClose={onSurfaceClose}
      />
    )
  }

  if (itemPermissionFrame) {
    return (
      <LauncherFlowFrame frameKey={`permission:${itemPermissionFrame.item.systemKey}`}>
        <GlobalLauncherPermissionFrame
          frame={itemPermissionFrame}
          locale={locale}
          onBack={onPermissionBack}
          onGrant={onPermissionGrant}
        />
      </LauncherFlowFrame>
    )
  }

  const topFrame = controllerState && controllerState.frames.length > 1
    ? controllerState.frames[controllerState.frames.length - 1]
    : null

  if (topFrame?.kind === 'param-input') {
    const frame = topFrame as ParamInputFrame
    return (
      <LauncherFlowFrame frameKey={`param:${frame.item.systemKey}:${frame.paramIndex}`}>
        <LauncherBranchChoices
          frame={frame}
          error={controllerState?.error ?? null}
          busy={controllerState?.busy ?? false}
          locale={locale}
          headerClassName="global-launcher-header l-search"
          bodyClassName="global-launcher-body l-list opt"
          footerClassName="global-launcher-footer l-foot"
          onQueryChange={(value) => onParamQueryChange(value, frame)}
          onSelectedIndexChange={(index) => onParamSelectedIndexChange(index, frame)}
          onCommit={(value) => onParamCommit(value, frame)}
          onMultiToggle={(value) => onParamMultiToggle(value, frame)}
          onBack={() => onFrameBack(frame)}
          onExitCommand={onExitCommand ? () => onExitCommand(frame) : undefined}
          onNextParam={() => onNextParam?.(frame)}
        />
      </LauncherFlowFrame>
    )
  }

  if (topFrame?.kind === 'ai-send' && aiSendActions) {
    const frame = topFrame as AiSendFrame
    return (
      <LauncherFlowFrame frameKey={`ai-send:${frame.item.systemKey}`}>
        <GlobalLauncherAiSendFrame
          frame={frame}
          locale={locale}
          onConfirm={aiSendActions.confirm}
          onToggleRemember={aiSendActions.toggleRemember}
          onOpenSettings={aiSendActions.openSettings}
          onBack={() => onFrameBack()}
        />
      </LauncherFlowFrame>
    )
  }

  if (topFrame?.kind === 'collect-input') {
    const frame = topFrame as CollectInputFrame
    const paramChips: { label: string; value: string }[] = []
    // Gray values always show the parameters this run will use.
    const params = frame.params ?? frame.item.defaultParams
    if (params && frame.item.params) {
      for (const p of frame.item.params) {
        const val = params[p.key]
        if (val !== undefined && val !== null) {
          paramChips.push({ label: localizedParamLabel(p.label, p.labelI18n, locale), value: resolveParamValueLabel(p, val, locale) })
        }
      }
    }
    return (
      <LauncherFlowFrame frameKey={`collect:${frame.item.systemKey}`}>
        <GlobalLauncherCollectInputFrame
          isImeComposingRef={isImeComposingRef}
          inputRef={inputRef}
          bindSearchInputRef={bindSearchInputRef}
          frame={frame}
          busy={controllerState?.busy ?? false}
          deliveryIntent={controllerState?.deliveryIntent}
          error={controllerState?.error ?? null}
          locale={locale}
          paramChips={paramChips}
          onInputChange={(value) => onCollectInputChange(value, frame)}
          onBack={() => onFrameBack(frame)}
          onExitCommand={onExitCommand ? () => onExitCommand(frame) : undefined}
          onActivateChoice={onActivateResultChoice}
          onSecondaryAction={onSecondaryAction}
          onPastePreviewText={onPastePreviewText}
          onSubmitPrimary={() => onSubmitCollectInput?.(frame)}
          attachedBlock={clipboardBlock?.block}
          onRemoveBlock={() => onRemoveCommandBlock?.(frame)}
          onParamChange={onCommandParamChange ? (key, value) => onCommandParamChange(key, value, frame) : undefined}
          onPasteAsBlock={(text) => onCommandBlockChange?.('paste', text, frame)}
          onBlockTextChange={(text) => onCommandBlockChange?.('edit', text, frame)}
          onSyncBlock={(text) => onCommandBlockChange?.('sync', text, frame)}
          onCopyAll={onCopyAllChoices}
          onRevokeAiSend={aiSendActions?.revoke}
        />
      </LauncherFlowFrame>
    )
  }

  if (topFrame?.kind === 'result') {
    const frame = topFrame as ResultFrame
    return (
      <LauncherFlowFrame frameKey={`result:${frame.sourceTitle ?? ''}`}>
        <GlobalLauncherResultFrame
          frame={frame}
          busy={controllerState?.busy ?? false}
          deliveryIntent={controllerState?.deliveryIntent}
          error={controllerState?.error ?? null}
          locale={locale}
          selectedIndex={resultSelectedIndex}
          selectedChoiceIds={selectedResultChoiceIds}
          onBack={onFrameBack}
          onHoverChoice={onHoverResultChoice}
          onToggleChoice={onToggleResultChoice}
          onSecondaryAction={onSecondaryAction}
          onPastePreviewText={onPastePreviewText}
          onCopyAll={onCopyAllChoices}
        />
      </LauncherFlowFrame>
    )
  }

  return (
    <>
    {controllerState?.deliveryIntent && (
      <span role="status" aria-live="polite">{t(locale, controllerState.deliveryIntent === 'copy' ? 'palette.outputCopying' : 'palette.outputDelivering')}</span>
    )}
    <GlobalLauncherSearchFrame
      inputRef={inputRef}
      bindSearchInputRef={bindSearchInputRef}
      query={query}
        searchRecovery={searchRecovery}
      placeholder={searchPlaceholder}
      searchContext={searchContext}
      clipboardBlock={clipboardBlock}
      clipboardHintSelected={clipboardHintSelected}
      error={controllerState?.error ?? null}
      items={visibleFiltered}
      busy={controllerState?.busy ?? false}
      selectedItem={selectedItem}
      locale={locale}
      isFavoriteSelected={isFavoriteSelected}
      browsingActions={browsingActions}
      browseCategory={browseCategory}
      onBrowseCategoryChange={onBrowseCategoryChange}
      onBrowseActions={onBrowseActions}
      onLeaveActionBrowser={onLeaveActionBrowser}
      truncateItems={truncateSearchItems}
      onToggleFavorite={onToggleSearchFavorite}
      favoriteKeys={favoriteKeys}
      pinnableItemKeys={pinnableItemKeys}
      onQueryChange={onSearchQueryChange}
      onSelectItem={onSearchSelectItem}
      onHoverIndex={onSearchHoverIndex}
      onMouseMove={onSearchMouseMove}
      isKeyboardNavRef={isKeyboardNavRef}
    />
    </>
  )
}

function LauncherFlowFrame({ frameKey, children }: { frameKey: string; children: ReactNode }) {
  return <div key={frameKey} className="global-launcher-flow-frame">{children}</div>
}

function localizedParamLabel(label: string, labelI18n: Record<string, string> | undefined, locale: Locale) {
  return labelI18n?.[locale] ?? label
}
