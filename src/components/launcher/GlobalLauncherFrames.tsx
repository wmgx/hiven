import { lazy, Suspense, type RefObject } from 'react'
import { Search } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { LauncherHostSurfaceTarget, PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { CollectInputFrame, ParamInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'
import { PluginSettingsContent } from '../PluginSettingsDialog'
import { PluginSurfacePermissionGate, PluginSurfaceRenderer } from '../pluginSurface/PluginSurfaceRenderer'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherParamStep, resolveParamValueLabel } from './LauncherParamStep'
import { LauncherMixedList, type LauncherMixedItem } from './LauncherMixedList'
import { LauncherResultChoiceRow } from './LauncherResultChoiceRow'
import type { PluginPermission, PluginUiSurfaceContribution } from '../../workspace/pluginTypes'


export type GlobalLauncherPermissionFrame = {
  permissions: PluginPermission[]
}

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
}: {
  hostSurfaceTarget: LauncherHostSurfaceTarget | null
  hostSurfaceHeight: number
  launcherSettingsTarget: { pluginId: string; source: PluginSettingsSource } | null
  settingsHeight: number
  surfaceFrame: PluginSurfaceOpenTarget | null
  activeSurfaceFrame: GlobalLauncherActiveSurfaceFrame | null
  itemPermissionFrame: GlobalLauncherPermissionFrame | null
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
      <div className="global-launcher-body" style={{ height: 260 }}>
        <PluginSurfacePermissionGate
          permissions={itemPermissionFrame.permissions}
          locale={locale}
          onBack={onPermissionBack}
          onGrant={onPermissionGrant}
        />
      </div>
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
    />
  )
}

function localizedParamLabel(label: string, labelI18n: Record<string, string> | undefined, locale: Locale) {
  return labelI18n?.[locale] ?? label
}

const SettingsSurface = lazy(() => import('../../surfaces/SettingsSurface').then((mod) => ({ default: mod.SettingsSurface })))
const PluginsSurface = lazy(() => import('../../surfaces/PluginsSurface').then((mod) => ({ default: mod.PluginsSurface })))

export function GlobalLauncherSystemSurfaceFrame({
  target,
  height,
}: {
  target: LauncherHostSurfaceTarget
  height: number
}) {
  return (
    <div
      className="global-launcher-host-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height }}
    >
      <div className="global-launcher-body" style={{ height, maxHeight: height, overflow: 'hidden' }}>
        <Suspense fallback={<div className="view-loading" />}>
          {target === 'settings' ? <SettingsSurface /> : <PluginsSurface />}
        </Suspense>
      </div>
    </div>
  )
}

export function GlobalLauncherSettingsFrame({
  pluginId,
  source,
  locale,
  height,
  onClose,
}: {
  pluginId: string
  source: PluginSettingsSource
  locale: Locale
  height: number
  onClose: () => void
}) {
  return (
    <div
      className="global-launcher-settings-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height }}
    >
      <PluginSettingsContent
        pluginId={pluginId}
        source={source}
        locale={locale}
        onClose={onClose}
      />
    </div>
  )
}

export function GlobalLauncherPluginSurfaceFrame({
  target,
  locale,
  shellHeight,
  onBack,
  onClose,
}: {
  target: PluginSurfaceOpenTarget
  locale: Locale
  shellHeight: number
  onBack: () => void
  onClose: () => void
}) {
  return (
    <div
      className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={{ height: shellHeight }}
    >
      <div className="global-launcher-body" style={{ maxHeight: shellHeight, height: shellHeight, overflow: 'hidden' }}>
        <PluginSurfaceRenderer
          target={target}
          locale={locale}
          presentation="global-launcher"
          contextSurfaceId="global-launcher"
          onBack={onBack}
          onClose={onClose}
        />
      </div>
    </div>
  )
}

export function GlobalLauncherSearchFrame({
  inputRef,
  query,
  placeholder,
  error,
  items,
  selectedItem,
  locale,
  showCustomizeHint,
  showWorkflowObjectHint,
  customizeShortcutLabel,
  onQueryChange,
  onSelectItem,
  onHoverIndex,
  onMouseMove,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  placeholder: string
  error?: string | null
  items: LauncherMixedItem[]
  selectedItem?: LauncherMixedItem
  locale: Locale
  showCustomizeHint: boolean
  showWorkflowObjectHint: boolean
  customizeShortcutLabel: string
  onQueryChange: (value: string) => void
  onSelectItem: (item: LauncherMixedItem) => void
  onHoverIndex: (index: number) => void
  onMouseMove: () => void
}) {
  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <Search className="ico" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
        />
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[12px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <div className="global-launcher-body l-list" onMouseMove={onMouseMove}>
        <LauncherMixedList
          items={items}
          selected={selectedItem}
          locale={locale}
          onSelect={onSelectItem}
          onHoverIndex={onHoverIndex}
        />
      </div>
      <div className="global-launcher-footer l-foot">
        <LauncherHintKey keys="↑↓" label={t(locale, 'palette.select')} />
        <LauncherHintKey keys="↵" label={t(locale, 'palette.confirm')} />
        {showCustomizeHint && (
          <LauncherHintKey keys={`${customizeShortcutLabel}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
        )}
        {showWorkflowObjectHint && (
          <LauncherHintKey keys="tab" label={t(locale, 'palette.select')} />
        )}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}

export function GlobalLauncherCollectInputFrame({
  inputRef,
  frame,
  busy,
  error,
  locale,
  paramChips,
  onInputChange,
  onBack,
  onActivateChoice,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  frame: CollectInputFrame
  busy: boolean
  error?: string | null
  locale: Locale
  paramChips: { label: string; value: string }[]
  onInputChange: (value: string) => void
  onBack: () => void
  onActivateChoice: (choice: LauncherResultChoice) => void
}) {
  const placeholder = frame.input.placeholder ?? ''
  const previewChoices = frame.previewOutput?.choices ?? []

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <button className="back" type="button" onClick={onBack}>‹</button>
        <span className="title">
          <span className="t-ico">{resolveIcon(frame.item.display.icon, 14, resolveDisplayTitle(frame.item.display, locale))}</span>
          {resolveDisplayTitle(frame.item.display, locale)}
        </span>
        {paramChips.map((chip) => (
          <span
            key={chip.label}
            className="kbd shrink-0 max-w-[100px] truncate"
            title={`${chip.label}: ${chip.value}`}
          >
            {chip.value}
          </span>
        ))}
        <span className="vbar" />
        <input
          ref={inputRef}
          value={frame.inputText}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={placeholder}
          className="mono"
        />
        {busy && (
          <span className="meta">...</span>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      {previewChoices.length > 0 && (
        <div className="global-launcher-body l-results">
          {previewChoices.map((choice, index) => (
            <LauncherResultChoiceRow
              key={choice.id}
              choice={choice}
              index={index}
              selected={index === 0}
              onSelect={() => onActivateChoice(choice)}
            />
          ))}
        </div>
      )}
      <div className="global-launcher-footer l-foot">
        {previewChoices.length > 0
          ? <LauncherHintText label={t(locale, 'palette.enterToCopy')} />
          : <LauncherHintKey keys="↵" label={t(locale, 'palette.quickEntryRun')} />}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}

export function GlobalLauncherResultFrame({
  frame,
  error,
  locale,
  selectedIndex,
  selectedChoiceIds,
  onBack,
  onHoverChoice,
  onToggleChoice,
}: {
  frame: ResultFrame
  error?: string | null
  locale: Locale
  selectedIndex: number
  selectedChoiceIds: Set<string>
  onBack: () => void
  onHoverChoice: (index: number) => void
  onToggleChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
}) {
  const choices = frame.output.choices
  const selection = frame.output.selection
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, choices.length - 1))
  const selectedCount = selectedChoiceIds.size
  const countLabel = selection?.type === 'multi'
    ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: selection.max })
    : null

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <button className="back" type="button" onClick={onBack}>‹</button>
        <span className="title">
          {frame.sourceTitle}
        </span>
      </div>
      <div className="global-launcher-body l-results">
        {choices.map((choice, index) => {
          const checked = selectedChoiceIds.has(choice.id)
          const disabled = selection?.type === 'multi' && selectedCount >= selection.max && !checked
          return (
            <LauncherResultChoiceRow
              key={choice.id}
              choice={choice}
              index={index}
              selected={index === clampedSelectedIndex}
              checked={checked}
              disabled={disabled}
              multi={selection?.type === 'multi'}
              onHover={() => onHoverChoice(index)}
              onSelect={() => onToggleChoice(choice, frame)}
            />
          )
        })}
      </div>
      {error && (
        <div className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      <div className="global-launcher-footer l-foot">
        {countLabel && <LauncherHintText label={countLabel} />}
        <LauncherHintKey keys="↵" label={selection?.type === 'multi' ? t(locale, 'palette.select') : t(locale, 'palette.confirm')} />
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
