import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type RefObject } from 'react'
import { Check, ChevronLeft, Pin, Search } from 'lucide-react'
import { useAppStore } from '../store'
import { t } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { resolveIcon } from '../utils/resolveIcon'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { resolvePluginSettings } from '../workspace/pluginSettingsStore'
import { LauncherController } from '../workspace/launcher/controller'
import type { CollectInputFrame, LauncherControllerState, ParamInputFrame, ResultFrame } from '../workspace/launcher/controller'
import { createPluginLauncherApi } from '../workspace/launcher/pluginApi'
import { collectDynamicItems, collectStaticCandidates, filterDynamicForSurface } from '../workspace/launcher/registry'
import { rankLauncherItems } from '../workspace/launcher/ranking'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../workspace/launcher/display'
import { resolvePluginSettingsSource } from '../workspace/launcher/pluginSource'
import { LauncherParamStep } from './launcher/LauncherParamStep'
import { getPlatformShortcutMeta, shouldCustomizeParams, supportsDefaultParamRun, supportsParamCustomization } from './launcher/launcherParamShortcuts'
import type { ContributionSource } from '../workspace/pluginTypes'
import type { LauncherItem as DomainLauncherItem, LauncherResultChoice, LauncherSurfaceId } from '../workspace/launcher/types'

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const pinPluginCommand = useAppStore((s) => s.pinPluginCommand)
  const locale = useAppStore((s) => s.locale)
  const launcherUsageBySurface = useAppStore((s) => s.launcherUsageBySurface)
  const recordLauncherSelection = useAppStore((s) => s.recordLauncherSelection)
  const pluginRegistryVersion = usePluginRegistryVersion()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [controllerState, setControllerState] = useState<LauncherControllerState | null>(null)
  const [dynamicItems, setDynamicItems] = useState<DomainLauncherItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const controllerRef = useRef<LauncherController | null>(null)
  const dynamicQueryRef = useRef('')
  const isKeyboardNavRef = useRef(false)
  const isImeComposingRef = useRef(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setQuery('')
      setSelectedIndex(0)
      setDynamicItems([])
      dynamicQueryRef.current = ''

      if (!controllerRef.current) {
        controllerRef.current = new LauncherController({
          surfaceId: 'command-palette' as LauncherSurfaceId,
          api: createPluginLauncherApi(),
          locale,
          makeT: (item) => makePluginT(item.pluginId ?? '', locale),
          getSettings: (item) => {
            if (!item.pluginId || !item.source) return undefined
            const def = pluginRegistry.getPluginDefinition(item.pluginId, item.source)
            const settingsContribution = def?.settings
            if (!settingsContribution) return undefined
            return resolvePluginSettings(item.source, item.pluginId, settingsContribution).value
          },
          recordSelection: (surfaceId, item) => {
            recordLauncherSelection(surfaceId, item.systemKey)
          },
          requestClose: () => setOpen(false),
          onChange: (state) => setControllerState({ ...state }),
        })
      }
      controllerRef.current.reset()
      setTimeout(() => inputRef.current?.focus(), 50)
    })
    return () => {
      cancelled = true
    }
  }, [locale, open, recordLauncherSelection, setOpen])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setDynamicItems([])
      dynamicQueryRef.current = ''
      return
    }
    dynamicQueryRef.current = q
    const timer = setTimeout(async () => {
      if (dynamicQueryRef.current !== q) return
      const getSettingsForPlugin = (pluginId: string, source: ContributionSource) => {
        const def = pluginRegistry.getPluginDefinition(pluginId, source)
        const settingsContribution = def?.settings
        if (!settingsContribution) return undefined
        const settingsSource = resolvePluginSettingsSource(pluginId, source)
        return resolvePluginSettings(settingsSource, pluginId, settingsContribution).value
      }
      const items = await collectDynamicItems(q, locale, getSettingsForPlugin)
      if (dynamicQueryRef.current !== q) return
      setDynamicItems(filterDynamicForSurface(items, 'command-palette'))
    }, 150)
    return () => clearTimeout(timer)
  }, [query, open, locale])

  const rankedLauncherItems = useMemo<DomainLauncherItem[]>(() => {
    void pluginRegistryVersion
    const staticCandidates = collectStaticCandidates('command-palette')
    const allCandidates = [...staticCandidates, ...dynamicItems]
    return rankLauncherItems(
      {
        query: query.trim(),
        locale,
        surfaceId: 'command-palette',
        usage: launcherUsageBySurface,
        now: Date.now(),
      },
      allCandidates,
    )
  }, [query, locale, pluginRegistryVersion, dynamicItems, launcherUsageBySurface])

  const topFrame = controllerState?.frames[controllerState.frames.length - 1]
  const inControllerFrame = topFrame && topFrame.kind !== 'list'

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
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
    if (inControllerFrame) return

    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
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

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 flex items-start justify-center pt-[70px] z-50 palette-overlay ${open ? 'open' : ''}`}
      style={{ pointerEvents: 'auto', visibility: 'visible', zIndex: 1000 }}
      onClick={(event) => { if (event.target === event.currentTarget) setOpen(false) }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[min(630px,90vw)] overflow-hidden outline-none palette-panel"
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--radius-xl)',
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      >
        {!inControllerFrame && (
          <SearchStep
            inputRef={inputRef}
            query={query}
            setQuery={(value) => { setQuery(value); setSelectedIndex(0) }}
            items={rankedLauncherItems}
            selectedIndex={selectedIndex}
            selectItem={selectItem}
            onPinItem={pinLauncherItem}
            setSelectedIndex={setSelectedIndex}
            isKeyboardNavRef={isKeyboardNavRef}
            locale={locale}
            error={controllerState?.error ?? null}
            busy={controllerState?.busy ?? false}
          />
        )}

        {topFrame?.kind === 'collect-input' && (
          <CollectInputStep
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
          <ResultStep
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
      </div>
    </div>
  )
}

function SearchStep({
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
      <div className="flex items-center px-3.5 gap-2 h-[44px]" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <Search size={16} style={{ color: 'var(--color-text-tertiary)' }} />
        <input
          ref={inputRef}
          className="flex-1 border-none outline-none text-sm bg-transparent"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={t(locale, 'palette.search')}
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
      <div className="command-palette-results py-1" onMouseMove={() => { isKeyboardNavRef.current = false }}>
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
      <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
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

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <div
      ref={ref}
      className={`cmd-item ${selected ? 'selected' : ''}`}
      style={{ background: selected ? 'var(--color-accent-light)' : 'transparent' }}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div
        className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs font-semibold shrink-0"
        style={{
          background: selected ? 'var(--color-accent)' : 'var(--color-background-tertiary)',
          color: selected ? 'white' : 'var(--color-text-secondary)',
        }}
      >
        {resolveIcon(item.display.icon, 14, item.systemKey)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {item.source === 'dev' && (
            <span className="text-[9px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: 'var(--color-accent)', color: '#fff' }}>DEV</span>
          )}
          <div className="text-[13px] font-medium truncate" style={{ color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
            {title}
          </div>
        </div>
        {subtitle && (
          <div className="text-[11px]" style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
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
        <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}>↵</kbd>
      )}
    </div>
  )
}

function CollectInputStep({ frame, error, busy, onInputChange, onSubmit, onBack, locale }: {
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

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  return (
    <>
      <div className="flex items-center px-3.5 gap-2 h-[44px]" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <button className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-medium" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{title}</span>
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
      <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <HintKey keys="↵" label={t(locale, 'palette.submit')} />
        <HintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}

function ResultStep({ frame, error, busy, onActivateChoice, onActivateSecondary, onSubmitSelection, onBack, locale }: {
  frame: ResultFrame
  error: string | null
  busy: boolean
  onActivateChoice: (choice: LauncherResultChoice) => void
  onActivateSecondary: (choice: LauncherResultChoice, actionId: string) => void
  onSubmitSelection: (choices: LauncherResultChoice[]) => void
  onBack: () => void
  locale: import('../i18n').Locale
}) {
  const [selectedChoiceIndex, setSelectedChoiceIndex] = useState(0)
  const [selectedChoiceIds, setSelectedChoiceIds] = useState<string[]>([])
  const choices = frame.output.choices ?? []
  const selection = frame.output.selection?.type === 'multi' ? frame.output.selection : null
  const selectedChoices = choices.filter((choice) => selectedChoiceIds.includes(choice.id))
  const canSubmitSelection = selection
    ? selectedChoices.length >= selection.min && selectedChoices.length <= selection.max
    : false

  useEffect(() => {
    setSelectedChoiceIndex(0)
    setSelectedChoiceIds([])
  }, [frame])

  function toggleChoice(choice: LauncherResultChoice) {
    if (!selection || busy) return
    setSelectedChoiceIds((current) => {
      if (current.includes(choice.id)) return current.filter((id) => id !== choice.id)
      if (current.length >= selection.max) return current
      return [...current, choice.id]
    })
  }

  function submitSelection() {
    if (!selection || !canSubmitSelection || busy) return
    onSubmitSelection(selectedChoices)
  }

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
  }, [choices, selectedChoiceIndex, busy, onActivateChoice, onBack, selection, selectedChoices, canSubmitSelection])

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
      <div className="command-palette-results py-1">
        {choices.map((choice, index) => {
          const isSelected = selectedChoiceIndex === index
          const isChecked = selectedChoiceIds.includes(choice.id)
          return (
            <div
              key={choice.id}
              className={`cmd-item ${isSelected ? 'selected' : ''}`}
              style={{ background: isSelected ? 'var(--color-accent-light)' : 'transparent' }}
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
      <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
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
    <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
      <kbd className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)' }}>{keys}</kbd>
      {label}
    </span>
  )
}
