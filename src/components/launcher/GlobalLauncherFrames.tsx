import { lazy, Suspense, type RefObject } from 'react'
import { Search } from 'lucide-react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { LauncherHostSurfaceTarget, PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { CollectInputFrame, ResultFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'
import { PluginSettingsContent } from '../PluginSettingsDialog'
import { PluginSurfaceRenderer } from '../pluginSurface/PluginSurfaceRenderer'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherMixedList, type LauncherMixedItem } from './LauncherMixedList'
import { LauncherResultChoiceRow } from './LauncherResultChoiceRow'

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
