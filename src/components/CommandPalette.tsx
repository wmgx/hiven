import { useCallback, useEffect, useMemo, useRef, useState as useReactState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type RefObject } from 'react'
import { Check, ChevronLeft, Pin, Search } from 'lucide-react'
import { localized, useAppStore } from '../store'
import { t } from '../i18n'
import { resolveIcon } from '../utils/resolveIcon'
import { usePluginRegistryVersion } from '../workspace/pluginRegistry'
import type { CollectInputFrame, ParamInputFrame, ResultFrame } from '../workspace/launcher/controller'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../workspace/launcher/display'
import { LauncherParamStep, resolveParamValueLabel } from './launcher/LauncherParamStep'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsDefaultParamRun, supportsParamCustomization } from './launcher/launcherParamShortcuts'
import type { LauncherItem as DomainLauncherItem, LauncherResultChoice, LauncherSurfaceId } from '../workspace/launcher/types'
import type { LauncherHostConfig } from '../launcher/LauncherHostConfig'
import { useLauncherSession } from '../launcher/useLauncherSession'
import {
  CollectInputStep as SharedCollectInputStep,
  LauncherSearch,
  LauncherShell,
  ResultStep as SharedResultStep,
} from '../launcher/ui'

export function CommandPalette() {
  return <EditorCommandBarHost />
}

const EDITOR_COMMAND_BAR_SURFACE_ID: LauncherSurfaceId = 'editor-command-bar'

const EDITOR_COMMAND_BAR_HOST_CONFIG: LauncherHostConfig = {
  hostId: EDITOR_COMMAND_BAR_SURFACE_ID,
  capabilities: ['editor-actions', 'collect-input', 'param-input', 'result-choice'],
  presentation: {
    shellClassName: 'command-launcher-panel global-launcher-panel overflow-hidden outline-none palette-panel',
    panelClassName: 'command-launcher-panel global-launcher-panel overflow-hidden outline-none palette-panel',
    overlayZIndex: 1000,
    topOffset: 54,
  },
  closeBehavior: {
    restoreFocus: true,
    requestClose: () => {},
  },
}

export function EditorCommandBarHost() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const pinPluginCommand = useAppStore((s) => s.pinPluginCommand)
  const locale = useAppStore((s) => s.locale)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const panelRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<{ restoreFocus: () => void } | null>(null)

  const closePalette = useCallback(() => {
    setOpen(false)
    sessionRef.current?.restoreFocus()
  }, [setOpen])

  const hostConfig = useMemo<LauncherHostConfig>(() => ({
    ...EDITOR_COMMAND_BAR_HOST_CONFIG,
    closeBehavior: {
      ...EDITOR_COMMAND_BAR_HOST_CONFIG.closeBehavior,
      requestClose: closePalette,
    },
  }), [closePalette])

  const session = useLauncherSession({
    open,
    hostConfig,
    locale,
    launcherUsageBySurface,
    pluginRegistryVersion,
    recordSelection: recordLauncherSelection,
    focusDelay: 50,
  })
  useEffect(() => {
    sessionRef.current = session
  }, [session])

  const {
    controllerRef,
    controllerState,
    inControllerFrame,
    inputRef,
    isKeyboardNavRef,
    query,
    rankedLauncherItems,
    selectedIndex,
    setSearchQuery,
    setSelectedIndex,
    topFrame,
  } = session

  function focusSearchInputAfterBack() {
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function selectItem(item: DomainLauncherItem | undefined, customizeParams = false) {
    if (!item) return
    if (!customizeParams && !supportsDefaultParamRun(item)) {
      void controllerRef.current?.selectItem(item, { customizeParams: true })
      return
    }
    void controllerRef.current?.selectItem(item, { customizeParams })
  }

  function pinLauncherItem(item: DomainLauncherItem) {
    if (item.pinnable === false) return
    pinPluginCommand({
      kind: 'plugin-command',
      actionId: item.systemKey,
      pluginId: item.pluginId ?? '',
      title: item.display.title,
      titleI18n: item.display.titleI18n,
      icon: item.display.icon,
      isDev: item.source === 'dev',
      live: { pinnable: true },
    })
    closePalette()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (session.shouldIgnoreKeyDown(event.nativeEvent)) return
    if (inControllerFrame) return

    if (event.key === 'Escape') {
      event.preventDefault()
      closePalette()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      isKeyboardNavRef.current = true
      setSelectedIndex((index) => Math.min(index + 1, Math.max(0, rankedLauncherItems.length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      isKeyboardNavRef.current = true
      setSelectedIndex((index) => Math.max(index - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selectItem(rankedLauncherItems[selectedIndex], shouldCustomizeParams(event.metaKey, event.ctrlKey))
    }
  }

  if (!open) return null

  return (
    <LauncherShell
      open={open}
      overlayClassName={`fixed inset-0 flex items-start justify-center pt-[54px] z-50 palette-overlay ${open ? 'open' : ''}`}
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1000 }}
      panelRef={panelRef}
      panelClassName={hostConfig.presentation.panelClassName}
      onOverlayClick={(event) => { if (event.target === event.currentTarget) closePalette() }}
      onKeyDown={handleKeyDown}
      onCompositionStart={session.handleCompositionStart}
      onCompositionEnd={session.handleCompositionEnd}
    >
      {!inControllerFrame && (
        <LauncherSearch
          inputRef={inputRef}
          query={query}
          setQuery={setSearchQuery}
          items={rankedLauncherItems}
          selectedIndex={selectedIndex}
          selectItem={selectItem}
          onPinItem={pinLauncherItem}
          setSelectedIndex={setSelectedIndex}
          isKeyboardNavigation={() => isKeyboardNavRef.current}
          onMouseNavigation={() => { isKeyboardNavRef.current = false }}
          locale={locale}
          error={controllerState?.error ?? null}
          busy={controllerState?.busy ?? false}
        />
      )}

      {topFrame?.kind === 'collect-input' && (
        <SharedCollectInputStep
          frame={topFrame as CollectInputFrame}
          error={controllerState?.error ?? null}
          busy={controllerState?.busy ?? false}
          onInputChange={(text) => controllerRef.current?.setInputText(text)}
          onSubmit={() => controllerRef.current?.submitInput()}
          onBack={() => {
            controllerRef.current?.back()
            focusSearchInputAfterBack()
          }}
          locale={locale}
        />
      )}

      {topFrame?.kind === 'param-input' && (
        <LauncherParamStep
          frame={topFrame as ParamInputFrame}
          error={controllerState?.error ?? null}
          busy={controllerState?.busy ?? false}
          locale={locale}
          onQueryChange={(value) => controllerRef.current?.setParamQuery(value)}
          onSelectedIndexChange={(index) => controllerRef.current?.setParamSelectedIndex(index)}
          onCommit={(value) => { void controllerRef.current?.commitCurrentParam(value) }}
          onBack={() => {
            controllerRef.current?.back()
            focusSearchInputAfterBack()
          }}
        />
      )}

      {topFrame?.kind === 'result' && (
        <SharedResultStep
          frame={topFrame as ResultFrame}
          error={controllerState?.error ?? null}
          busy={controllerState?.busy ?? false}
          onActivateChoice={(choice) => controllerRef.current?.activateChoice(choice)}
          onActivateSecondary={(choice, actionId) => controllerRef.current?.activateSecondary(choice, actionId)}
          onSubmitSelection={(choices) => controllerRef.current?.submitResultSelection(choices)}
          onBack={() => {
            controllerRef.current?.back()
            focusSearchInputAfterBack()
          }}
          locale={locale}
        />
      )}
    </LauncherShell>
  )
}

export function SearchStep({
  inputRef,
  query,
  setQuery,
  items,
  selectedIndex,
  selectItem,
  onPinItem,
  setSelectedIndex,
  isKeyboardNavRef,
  locale,
  error,
  busy,
}: {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  setQuery: (value: string) => void
  items: DomainLauncherItem[]
  selectedIndex: number
  selectItem: (item: DomainLauncherItem, customizeParams?: boolean) => void
  onPinItem: (item: DomainLauncherItem) => void
  setSelectedIndex: (index: number) => void
  isKeyboardNavRef: MutableRefObject<boolean>
  locale: import('../i18n').Locale
  error: string | null
  busy: boolean
}) {
  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <Search className="ico" />
        <input
          ref={inputRef}
          placeholder={t(locale, 'palette.globalPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {busy && (
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>…</span>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[11px]" style={{ color: 'var(--color-error)', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          {error}
        </div>
      )}
      <div className="command-palette-results global-launcher-body l-list" onMouseMove={() => { isKeyboardNavRef.current = false }}>
        {items.map((item, index) => (
          <LauncherActionItem
            key={item.systemKey}
            item={item}
            selected={selectedIndex === index}
            onClick={(e) => selectItem(item, shouldCustomizeParams(e.metaKey, e.ctrlKey))}
            onPin={() => onPinItem(item)}
            onMouseEnter={() => { if (!isKeyboardNavRef.current) setSelectedIndex(index) }}
            locale={locale}
          />
        ))}
        {items.length === 0 && (
          <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            {t(locale, 'palette.noResults')}
          </div>
        )}
      </div>
      <div className="global-launcher-footer l-foot">
        <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        <HintKey keys="↵" label={t(locale, 'palette.select')} />
        {supportsParamCustomization(items[selectedIndex]) && (
          <HintKey keys={`${getPlatformShortcutMeta().label}↵`} label={t(locale, 'palette.customizeParamsLabel')} />
        )}
        <HintKey keys="esc" label={t(locale, 'palette.close')} />
      </div>
    </>
  )
}

function LauncherActionItem({ item, selected, onClick, onPin, onMouseEnter, locale }: {
  item: DomainLauncherItem
  selected: boolean
  onClick: (event: MouseEvent<HTMLDivElement>) => void
  onPin: () => void
  onMouseEnter: () => void
  locale: import('../i18n').Locale
}) {
  const ref = useRef<HTMLDivElement>(null)
  const title = resolveDisplayTitle(item.display, locale)
  const subtitle = resolveDisplaySubtitle(item.display, locale)
  const canPin = item.pinnable !== false
  const shortcutMeta = getPlatformShortcutMeta()
  const showParamShortcut = supportsParamCustomization(item)
  const tag = item.display.icon?.startsWith('app-icon:')
    ? t(locale, 'palette.kindApp')
    : t(locale, 'palette.kindCommand')

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      className={`l-row command-launcher-row ${selected ? 'sel selected' : ''}`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <span
        className={item.display.icon?.startsWith('app-icon:') ? 'r-app' : 'r-ico'}
      >
        {resolveIcon(item.display.icon, 16, item.systemKey)}
      </span>
      <div
        className="r-main"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {item.source === 'dev' && (
            <span className="text-[9px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: 'var(--color-accent)', color: '#fff' }}>DEV</span>
          )}
          <div
            className="r-title launcher-item-title"
          >
            {title}
          </div>
        </div>
        {subtitle && (
          <div
            className="r-desc"
          >
            {subtitle}
          </div>
        )}
      </div>
      {item.behavior.type === 'collect-input' && (
        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}>
          {t(locale, 'palette.hasInput')}
        </span>
      )}
      {showParamShortcut && (
        <span className="customize-shortcut-chip text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}>
          {shortcutMeta.label}↵ {t(locale, 'palette.customizeParamsLabel')}
        </span>
      )}
      <span className="r-tag launcher-kind-tag">
        {tag}
      </span>
      {canPin && (
        <button
          data-testid="launcher-item-pin-action"
          className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0"
          title={t(locale, 'palette.pinAction')}
          style={{ color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onPin()
          }}
        >
          <Pin size={13} />
        </button>
      )}
      {selected && (
        <span className="r-kbd">↵</span>
      )}
    </div>
  )
}

export function CollectInputStep({ frame, error, busy, onInputChange, onSubmit, onBack, locale }: {
  frame: CollectInputFrame
  error: string | null
  busy: boolean
  onInputChange: (text: string) => void
  onSubmit: () => void
  onBack: () => void
  locale: import('../i18n').Locale
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const imeComposingRef = useRef(false)
  const title = resolveDisplayTitle(frame.item.display, locale)
  const placeholder = frame.item.behavior.type === 'collect-input'
    ? (frame.item.behavior.input?.placeholder ?? '')
    : ''

  const paramChips: { label: string; value: string }[] = []
  if (frame.params && frame.item.params) {
    for (const p of frame.item.params) {
      const val = frame.params[p.key]
      if (val !== undefined && val !== null) {
        paramChips.push({ label: localized(p.label, p.labelI18n, locale), value: resolveParamValueLabel(p, val, locale) })
      }
    }
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <>
      <div className="flex items-center px-3.5 gap-2 h-[44px]" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <button className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-medium shrink-0" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{title}</span>
        {paramChips.map((chip) => (
          <span
            key={chip.label}
            className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded shrink-0 max-w-[100px] truncate"
            style={{
              background: 'var(--color-background-tertiary)',
              border: '0.5px solid var(--color-border-tertiary)',
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
            title={`${chip.label}: ${chip.value}`}
          >
            {chip.value}
          </span>
        ))}
      </div>
      <div className="px-3.5 py-3">
        <input
          ref={inputRef}
          className="w-full border-none outline-none text-sm bg-transparent px-2 py-1.5 rounded-md"
          style={{
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
          }}
          placeholder={placeholder}
          value={frame.inputText}
          onChange={(event) => onInputChange(event.target.value)}
          onCompositionStart={() => { imeComposingRef.current = true }}
          onCompositionEnd={() => { imeComposingRef.current = false }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              if (imeComposingRef.current || busy) return
              onSubmit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onBack()
            }
          }}
          disabled={busy}
        />
        {error && (
          <div className="text-[11px] mt-1.5 px-1" style={{ color: 'var(--color-error)' }}>{error}</div>
        )}
      </div>
      <div className="global-launcher-footer l-foot">
        <HintKey keys="↵" label={t(locale, 'palette.submit')} />
        <HintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}

type LegacyResultStepProps = {
  frame: ResultFrame
  error: string | null
  busy: boolean
  onActivateChoice: (choice: LauncherResultChoice) => void
  onActivateSecondary: (choice: LauncherResultChoice, actionId: string) => void
  onSubmitSelection: (choices: LauncherResultChoice[]) => void
  onBack: () => void
  locale: import('../i18n').Locale
}

export function ResultStep(props: LegacyResultStepProps) {
  return <LegacyResultStepBody key={getLegacyResultFrameKey(props.frame)} {...props} />
}

function getLegacyResultFrameKey(frame: ResultFrame) {
  const choices = frame.output.choices ?? []
  const selectionType = frame.output.selection?.type ?? 'single'
  return `${frame.sourceTitle ?? ''}:${selectionType}:${choices.map((choice) => choice.id).join('|')}`
}

function LegacyResultStepBody({ frame, error, busy, onActivateChoice, onActivateSecondary, onSubmitSelection, onBack, locale }: LegacyResultStepProps) {
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useReactState(0)
  const [selectedChoiceKeys, setSelectedChoiceKeys] = useReactState<string[]>([])
  const choices = useMemo(() => frame.output.choices ?? [], [frame])
  const selection = frame.output.selection?.type === 'multi' ? frame.output.selection : null
  const selectedChoices = choices.filter((choice) => selectedChoiceKeys.includes(choice.id))
  const canSubmitSelection = selection
    ? selectedChoices.length >= selection.min && selectedChoices.length <= selection.max
    : false

  const toggleChoice = useCallback((choice: LauncherResultChoice) => {
    if (!selection || busy) return
    setSelectedChoiceKeys((current) => {
      if (current.includes(choice.id)) return current.filter((id) => id !== choice.id)
      if (current.length >= selection.max) return current
      return [...current, choice.id]
    })
  }, [busy, selection, setSelectedChoiceKeys])

  const submitSelection = useCallback(() => {
    if (!selection || !canSubmitSelection || busy) return
    onSubmitSelection(selectedChoices)
  }, [busy, canSubmitSelection, onSubmitSelection, selectedChoices, selection])

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedChoiceIndex((index) => Math.min(index + 1, choices.length - 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedChoiceIndex((index) => Math.max(index - 1, 0)) }
      if (selection && event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        const choice = choices[selectedChoiceIndex]
        if (choice) toggleChoice(choice)
      }
      if (event.key === 'Enter' && !busy) {
        event.preventDefault()
        event.stopPropagation()
        if (selection) {
          submitSelection()
          return
        }
        const choice = choices[selectedChoiceIndex]
        if (choice) onActivateChoice(choice)
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onBack()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [busy, choices, onActivateChoice, onBack, selectedChoiceIndex, selection, setSelectedChoiceIndex, submitSelection, toggleChoice])

  return (
    <>
      <div className="flex items-center px-3.5 gap-2 h-[44px]" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <button className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        {frame.sourceTitle && (
          <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{frame.sourceTitle}</span>
        )}
      </div>
      <div className="command-palette-results global-launcher-body l-list">
        {choices.map((choice, index) => {
          const isSelected = selectedChoiceIndex === index
          const isChecked = selectedChoiceKeys.includes(choice.id)
          return (
            <div
              key={choice.id}
              className={`l-row command-palette-choice-row ${isSelected ? 'sel selected' : ''}`}
              onClick={() => selection ? toggleChoice(choice) : onActivateChoice(choice)}
              onMouseEnter={() => setSelectedChoiceIndex(index)}
            >
              {selection && (
                <div
                  className="w-[22px] h-[22px] rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: isChecked ? 'var(--color-accent)' : 'var(--color-background-tertiary)',
                    color: isChecked ? 'white' : 'var(--color-text-tertiary)',
                  }}
                >
                  {isChecked && <Check size={13} />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: isSelected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {choice.title}
                </div>
                {choice.subtitle && (
                  <div className="text-[11px]" style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
                    {choice.subtitle}
                  </div>
                )}
              </div>
              {choice.secondaryActions && choice.secondaryActions.length > 0 && (
                <div className="flex gap-1 shrink-0">
                  {choice.secondaryActions.map((action) => (
                    <button
                      key={action.id}
                      className="text-[10px] px-1.5 py-0.5 rounded border-none cursor-pointer"
                      style={{
                        background: 'var(--color-background-secondary)',
                        border: '0.5px solid var(--color-border-tertiary)',
                        color: isSelected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)',
                      }}
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        onActivateSecondary(choice, action.id)
                      }}
                    >
                      {action.title}
                    </button>
                  ))}
                </div>
              )}
              {isSelected && !selection && (
                <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}>↵</kbd>
              )}
            </div>
          )
        })}
        {choices.length === 0 && (
          <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.noResults')}</div>
        )}
      </div>
      {error && (
        <div className="px-3.5 py-1.5 text-[11px]" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}
      <div className="global-launcher-footer l-foot">
        <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        {selection && <HintKey keys="space" label={t(locale, 'palette.toggle')} />}
        <HintKey keys="↵" label={selection?.submitTitle ?? t(locale, 'palette.select')} />
        {selection && (
          <span className="text-[11px]" style={{ color: canSubmitSelection ? 'var(--color-accent)' : 'var(--color-text-tertiary)' }}>
            {selectedChoices.length}/{selection.max}
          </span>
        )}
        <HintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}

function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="grp">
      <kbd>{keys}</kbd>
      {label}
    </span>
  )
}
