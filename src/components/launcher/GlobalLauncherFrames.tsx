import { type RefObject } from 'react'
import type { Locale } from '../../i18n'
import type { LauncherHostSurfaceTarget, PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { CollectInputFrame, ParamInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherParamStep, resolveParamValueLabel } from './LauncherParamStep'
import type { LauncherMixedItem } from './LauncherMixedList'
import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import { GlobalLauncherSystemSurfaceFrame } from './GlobalLauncherSystemSurfaceFrame'
import { GlobalLauncherSettingsFrame } from './GlobalLauncherSettingsFrame'
import { GlobalLauncherPluginSurfaceFrame } from './GlobalLauncherPluginSurfaceFrame'
import { GlobalLauncherSearchFrame } from './GlobalLauncherSearchFrame'
import type { ClipboardObjectBlockState } from '../../launcher/clipboard/useClipboardObjectBlock'
import type { RecommendedAction, RecommendedOutputTarget } from '../../launcher/clipboard/actionRecommendation'
import { GlobalLauncherResultFrame } from './GlobalLauncherResultFrame'
import { GlobalLauncherPermissionFrame, type GlobalLauncherPermissionFrameState } from './GlobalLauncherPermissionFrame'
import { GlobalLauncherCollectInputFrame } from './GlobalLauncherCollectInputFrame'

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
  itemPermissionFrame,
  controllerState,
  inputRef,
  query,
  searchPlaceholder,
  visibleFiltered,
  selectedItem,
  locale,
  resultSelectedIndex,
  selectedResultChoiceIds,
  showCustomizeHint,
  showWorkflowObjectHint,
  customizeShortcutLabel,
  onSettingsClose,
  onSurfaceBack,
  onSurfaceClose,
  onPermissionBack,
  onPermissionGrant,
  onParamQueryChange,
  onParamSelectedIndexChange,
  onParamCommit,
  onParamMultiToggle,
  onFrameBack,
  onCollectInputChange,
  onActivateResultChoice,
  onHoverResultChoice,
  onToggleResultChoice,
  onSearchQueryChange,
  onSearchSelectItem,
  onSearchHoverIndex,
  onSearchMouseMove,
  clipboardBlock,
  onExecuteAction,
  selectedActionIndex,
  onSelectedActionIndexChange,
  onObjectActionController,
}: {
  hostSurfaceTarget: LauncherHostSurfaceTarget | null
  hostSurfaceHeight: number
  launcherSettingsTarget: { pluginId: string; source: PluginSettingsSource } | null
  settingsHeight: number
  surfaceFrame: PluginSurfaceOpenTarget | null
  activeSurfaceFrame: GlobalLauncherActiveSurfaceFrame | null
  itemPermissionFrame: GlobalLauncherPermissionFrameState | null
  controllerState: { frames: Array<CollectInputFrame | ParamInputFrame | ResultFrame | { kind: string }>; error?: string | null; busy: boolean } | null | undefined
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  searchPlaceholder: string
  visibleFiltered: LauncherMixedItem[]
  selectedItem?: LauncherMixedItem
  locale: Locale
  resultSelectedIndex: number
  selectedResultChoiceIds: Set<string>
  showCustomizeHint: boolean
  showWorkflowObjectHint: boolean
  customizeShortcutLabel: string
  onSettingsClose: () => void
  onSurfaceBack: () => void
  onSurfaceClose: () => void
  onPermissionBack: () => void
  onPermissionGrant: () => void
  onParamQueryChange: (value: string) => void
  onParamSelectedIndexChange: (index: number) => void
  onParamCommit: (value: unknown) => void
  onParamMultiToggle: (value: unknown) => void
  onFrameBack: () => void
  onCollectInputChange: (value: string) => void
  onActivateResultChoice: (choice: LauncherResultChoice) => void
  onHoverResultChoice: (index: number) => void
  onToggleResultChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  onSearchQueryChange: (value: string) => void
  onSearchSelectItem: (item: LauncherMixedItem) => void
  onSearchHoverIndex: (index: number) => void
  onSearchMouseMove: () => void
  clipboardBlock: ClipboardObjectBlockState
  onExecuteAction?: (action: RecommendedAction, target: RecommendedOutputTarget) => void
  selectedActionIndex?: number
  onSelectedActionIndexChange?: (index: number) => void
  onObjectActionController?: (controller: { expand: () => void; execute: (keepOpen?: boolean) => void } | null) => void
}) {
  if (hostSurfaceTarget) {
    return <GlobalLauncherSystemSurfaceFrame target={hostSurfaceTarget} height={hostSurfaceHeight} />
  }

  if (launcherSettingsTarget) {
    return (
      <GlobalLauncherSettingsFrame
        pluginId={launcherSettingsTarget.pluginId}
        source={launcherSettingsTarget.source}
        locale={locale}
        height={settingsHeight}
        onClose={onSettingsClose}
      />
    )
  }

  if (surfaceFrame) {
    if (!activeSurfaceFrame) {
      return <div className="p-4 text-center text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>Surface not found</div>
    }
    return (
      <GlobalLauncherPluginSurfaceFrame
        target={surfaceFrame}
        locale={locale}
        shellHeight={activeSurfaceFrame.surface.shell?.defaultHeight ?? 480}
        onBack={onSurfaceBack}
        onClose={onSurfaceClose}
      />
    )
  }

  if (itemPermissionFrame) {
    return (
      <GlobalLauncherPermissionFrame
        frame={itemPermissionFrame}
        locale={locale}
        onBack={onPermissionBack}
        onGrant={onPermissionGrant}
      />
    )
  }

  const topFrame = controllerState && controllerState.frames.length > 1
    ? controllerState.frames[controllerState.frames.length - 1]
    : null

  if (topFrame?.kind === 'param-input') {
    const frame = topFrame as ParamInputFrame
    return (
      <LauncherParamStep
        frame={frame}
        error={controllerState?.error}
        busy={controllerState?.busy ?? false}
        locale={locale}
        headerClassName="global-launcher-header l-search"
        bodyClassName="global-launcher-body l-list opt"
        footerClassName="global-launcher-footer l-foot"
        onQueryChange={onParamQueryChange}
        onSelectedIndexChange={onParamSelectedIndexChange}
        onCommit={onParamCommit}
        onMultiToggle={onParamMultiToggle}
        onBack={onFrameBack}
      />
    )
  }

  if (topFrame?.kind === 'collect-input') {
    const frame = topFrame as CollectInputFrame
    const paramChips: { label: string; value: string }[] = []
    if (frame.params && frame.item.params) {
      for (const p of frame.item.params) {
        const val = frame.params[p.key]
        if (val !== undefined && val !== null) {
          paramChips.push({ label: localizedParamLabel(p.label, p.labelI18n, locale), value: resolveParamValueLabel(p, val, locale) })
        }
      }
    }
    return (
      <GlobalLauncherCollectInputFrame
        inputRef={inputRef}
        frame={frame}
        busy={controllerState?.busy ?? false}
        error={controllerState?.error}
        locale={locale}
        paramChips={paramChips}
        onInputChange={onCollectInputChange}
        onBack={onFrameBack}
        onActivateChoice={onActivateResultChoice}
      />
    )
  }

  if (topFrame?.kind === 'result') {
    const frame = topFrame as ResultFrame
    return (
      <GlobalLauncherResultFrame
        frame={frame}
        error={controllerState?.error}
        locale={locale}
        selectedIndex={resultSelectedIndex}
        selectedChoiceIds={selectedResultChoiceIds}
        onBack={onFrameBack}
        onHoverChoice={onHoverResultChoice}
        onToggleChoice={onToggleResultChoice}
      />
    )
  }

  return (
    <GlobalLauncherSearchFrame
      inputRef={inputRef}
      query={query}
      placeholder={searchPlaceholder}
      clipboardBlock={clipboardBlock}
      error={controllerState?.error}
      items={visibleFiltered}
      selectedItem={selectedItem}
      locale={locale}
      showCustomizeHint={showCustomizeHint}
      showWorkflowObjectHint={showWorkflowObjectHint}
      customizeShortcutLabel={customizeShortcutLabel}
      onQueryChange={onSearchQueryChange}
      onSelectItem={onSearchSelectItem}
      onHoverIndex={onSearchHoverIndex}
      onMouseMove={onSearchMouseMove}
      onExecuteAction={onExecuteAction}
      selectedActionIndex={selectedActionIndex}
      onSelectedActionIndexChange={onSelectedActionIndexChange}
      onObjectActionController={onObjectActionController}
    />
  )
}

function localizedParamLabel(label: string, labelI18n: Record<string, string> | undefined, locale: Locale) {
  return labelI18n?.[locale] ?? label
}
