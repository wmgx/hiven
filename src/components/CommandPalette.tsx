import { useState, useEffect, useMemo, useRef } from 'react'
import { useAppStore, localized } from '../store'
import type { PaletteParamModel } from '../store'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { applyEffects } from '../workspace/effectRunner'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { resolvePluginInputs, buildPluginCommandContext } from '../workspace/pluginInputResolver'
import { effectsFromPluginCommandResult } from '../workspace/pluginCommandRunner'
import { showToast } from '../workspace/toast'
import type { CommandEntry } from '../workspace/pluginRegistry'
import type { CommandParam, InputSlot, PaneInput, InstantSuggestion, InstantSuggestionProvider } from '../workspace/pluginTypes'
import type { ResolvedInputs } from '../workspace/pluginTypes'
import { Search, Check, Pin } from 'lucide-react'
import { t, type Locale } from '../i18n'
import { makePluginT } from '../i18n/pluginI18nRegistry'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { resolveIcon } from '../utils/resolveIcon'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { pinyinMatch, scoreSearchableFields, searchableFieldsMatch } from '../workspace/searchRanking'

// 步骤类型
type Step =
  | { type: 'search' }
  | { type: 'param'; paramIndex: number }

type PaletteItem =
  | { kind: 'instant'; provider: InstantSuggestionProvider; suggestion: InstantSuggestion; isDev: boolean }
  | { kind: 'plugin'; entry: CommandEntry; isDev: boolean }

type SelectedPluginCommand = {
  entry: CommandEntry
  isDev: boolean
  inputs: ResolvedInputs
  params: PaletteParamModel[]
  customizeParams: boolean
  inputSlots: InputSlot[]
  inputParamKeys: Record<string, string>
  inputPairParamKey?: string
  inputPairSlotKeys?: string[]
  clipboardText?: string
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const setLastCommandStatus = useAppStore((s) => s.setLastCommandStatus)
  const recentActionNames = useAppStore((s) => s.recentActionNames)
  const pushRecentAction = useAppStore((s) => s.pushRecentAction)
  const actionUsageCounts = useAppStore((s) => s.actionUsageCounts)
  const pinPluginCommand = useAppStore((s) => s.pinPluginCommand)
  const locale = useAppStore((s) => s.locale)
  const shortcutMeta = useMemo(() => getPlatformShortcutMeta(), [])

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [step, setStep] = useState<Step>({ type: 'search' })
  const [selectedPlugin, setSelectedPlugin] = useState<SelectedPluginCommand | null>(null)
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isKeyboardNavRef = useRef(false)
  const isImeComposingRef = useRef(false)

  const pluginRegistryVersion = usePluginRegistryVersion()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setQuery('')
      setSelectedIndex(0)
      setStep({ type: 'search' })
      setSelectedPlugin(null)
      setParams({})
      setInputValue('')
      setInputError('')
      setMultiSelected([])
      setTimeout(() => inputRef.current?.focus(), 50)
    })
    return () => {
      cancelled = true
    }
  }, [open])

  // 过滤 + 排序：plugin 命令，支持缩写匹配和复合评分
  const allFiltered = useMemo<PaletteItem[]>(() => {
    void pluginRegistryVersion

    const allItems: PaletteItem[] = pluginRegistry.getAllCommands().map(({ contribution, meta, isDev }) => ({
      kind: 'plugin' as const,
      entry: { contribution, meta },
      isDev,
    }))

    const q = query.trim().toLowerCase()

    // 过滤（含缩写匹配）
    const filtered = q ? allItems.filter((item) => paletteItemMatchesQuery(item, q, locale)) : allItems

    // 按复合评分降序排列
    const sorted = [...filtered].sort((a, b) =>
      scorePaletteItem(b, q, locale, recentActionNames, actionUsageCounts) -
      scorePaletteItem(a, q, locale, recentActionNames, actionUsageCounts)
    )

    // 计算 instant suggestions 并置顶
    if (q && q.length <= 500) {
      const instantSuggestions = computeInstantSuggestions(q, locale)
      if (instantSuggestions.length > 0) {
        return [...instantSuggestions, ...sorted]
      }
    }

    return sorted
  }, [query, recentActionNames, actionUsageCounts, locale, pluginRegistryVersion])

  // 当前参数
  const currentParam: PaletteParamModel | null =
    step.type === 'param'
      ? (selectedPlugin?.params ?? [])[step.paramIndex] ?? null
      : null

  // 当前参数的选项列表（单选/多选模式）
  const currentOptions = useMemo(() => {
    if (!currentParam) return []
    // Dynamic options via optionsFn
    if (currentParam.optionsFn) {
      return currentParam.optionsFn()
    }
    if (currentParam.type === 'boolean') {
      return [
        { label: locale === 'zh' ? '是' : 'Yes', value: 'true' },
        { label: locale === 'zh' ? '否' : 'No', value: 'false' },
      ]
    }
    if (currentParam.type === 'single-select' || currentParam.type === 'multi-select') {
      return (currentParam.options || []).map((o) =>
        typeof o === 'string' ? { label: o, value: o } : { label: localized(o.label, o.labelI18n, locale), value: o.value }
      )
    }
    return []
  }, [currentParam, locale])

  // 是否为输入模式
  const isInputMode = currentParam?.type === 'text' || currentParam?.type === 'textarea' || currentParam?.type === 'number'
  // 是否为多选模式
  const isMultiSelect = currentParam?.type === 'multi-select'
  const isFilterableSelect = currentParam?.type === 'single-select' || currentParam?.type === 'multi-select'
  const visibleOptions = useMemo(() => {
    if (!isFilterableSelect) return currentOptions
    const q = inputValue.trim().toLowerCase()
    if (!q) return currentOptions
    return currentOptions.filter((option) => paramOptionMatchesQuery(option, q))
  }, [currentOptions, inputValue, isFilterableSelect])

  useEffect(() => {
    if (step.type !== 'param' || !isFilterableSelect) return
    setSelectedIndex((index) => {
      if (visibleOptions.length === 0) return 0
      return Math.min(index, visibleOptions.length - 1)
    })
  }, [isFilterableSelect, step.type, visibleOptions.length])

  // Execute a plugin command with already-resolved inputs
  async function executePluginCommand(
    entry: CommandEntry,
    isDev: boolean,
    inputs: ResolvedInputs,
    finalParams?: Record<string, unknown>
  ) {
    const commandTitle = getPluginDisplayTitle(entry, isDev, locale)
    setLastCommandStatus({ title: commandTitle, status: 'running', updatedAt: Date.now() })
    const ctx = buildPluginCommandContext(inputs, finalParams ?? getDefaultPluginParams(entry.contribution.params ?? []))
    try {
      const result = await entry.contribution.run(ctx)
      const effects = effectsFromPluginCommandResult(result, { isDev, ownerPluginId: entry.meta.pluginId })
      if (effects.length > 0) {
        const runResult = applyEffects(effects)
        if (runResult.errors.length > 0) {
          setLastCommandStatus({ title: commandTitle, status: 'error', message: runResult.errors[0], updatedAt: Date.now() })
        } else {
          setLastCommandStatus({ title: commandTitle, status: 'success', updatedAt: Date.now() })
        }
      } else {
        setLastCommandStatus({ title: commandTitle, status: 'success', updatedAt: Date.now() })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setLastCommandStatus({ title: commandTitle, status: 'error', message: msg, updatedAt: Date.now() })
    }
    setOpen(false)
    setSelectedPlugin(null)
  }

  function startPluginParamFlow(entry: CommandEntry, isDev: boolean, inputs: ResolvedInputs, customizeParams: boolean) {
    const pluginParams = normalizePluginParams(entry.contribution.params ?? [])
    const initialParams = getDefaultActionParams(pluginParams)
    if (pluginParams.length === 0) {
      executePluginCommand(entry, isDev, inputs, initialParams)
      return
    }
    if (supportsDefaultParamRun(entry.contribution, pluginParams) && !customizeParams) {
      executePluginCommand(entry, isDev, inputs, initialParams)
      return
    }

    const pluginSelection: SelectedPluginCommand = {
      entry,
      isDev,
      inputs,
      params: pluginParams,
      customizeParams,
      inputSlots: [],
      inputParamKeys: {},
    }
    setSelectedPlugin(pluginSelection)
    setParams(initialParams)
    goToParam(pluginSelection, 0, initialParams)
  }

  function startPluginInputParamFlow(
    entry: CommandEntry,
    isDev: boolean,
    slots: InputSlot[],
    clipboardText: string | undefined,
    customizeParams: boolean
  ) {
    const { params: inputParams, inputParamKeys, inputPairParamKey, inputPairSlotKeys } = buildPluginInputParams(slots, clipboardText)
    const pluginParams = normalizePluginParams(entry.contribution.params ?? [])
    const allParams = [...inputParams, ...pluginParams]
    const initialParams = getDefaultActionParams(allParams)

    const pluginSelection: SelectedPluginCommand = {
      entry,
      isDev,
      inputs: {},
      params: allParams,
      customizeParams,
      inputSlots: slots,
      inputParamKeys,
      inputPairParamKey,
      inputPairSlotKeys,
      clipboardText,
    }
    setSelectedPlugin(pluginSelection)
    setParams(initialParams)
    goToParam(pluginSelection, 0, initialParams)
  }

  async function runPluginCommand(entry: CommandEntry, isDev: boolean, customizeParams: boolean) {
    pushRecentAction(entry.contribution.id)
    const slots = entry.contribution.inputs ?? []
    const resolution = entry.contribution.inputResolution ?? { strategy: 'use-active' as const, fallback: 'fail' as const }

    // Pre-read clipboard if any clipboard slots exist
    const needsClipboard = slots.some((s) => s.kind === 'clipboard') || shouldOfferPaneFallbacks(slots)
    let clipboardText: string | undefined
    if (needsClipboard) {
      try {
        clipboardText = (await readText()) ?? ''
      } catch {
        clipboardText = ''
      }
    }

    const resolveResult = resolvePluginInputs(slots, resolution, clipboardText !== undefined ? { clipboardText } : undefined)

    if (!resolveResult.ok) {
      if (resolveResult.reason === 'prompt') {
        startPluginInputParamFlow(entry, isDev, resolveResult.slots, clipboardText, customizeParams)
        return
      }
      if (resolveResult.reason === 'needs-clipboard') {
        const commandTitle = getPluginDisplayTitle(entry, isDev, locale)
        setLastCommandStatus({ title: commandTitle, status: 'error', message: t(locale, 'palette.clipboardUnavailable'), updatedAt: Date.now() })
        showToast(t(locale, 'palette.clipboardUnavailable'), 'error')
        setOpen(false)
        return
      }
      // reason === 'fail' — toast already shown by resolver
      const commandTitle = getPluginDisplayTitle(entry, isDev, locale)
      setLastCommandStatus({ title: commandTitle, status: 'error', updatedAt: Date.now() })
      setOpen(false)
      return
    }

    startPluginParamFlow(entry, isDev, resolveResult.inputs, customizeParams)
  }

  function selectItem(item: PaletteItem, customizeParams = false) {
    if (item.kind === 'instant') {
      executeInstantSuggestion(item.suggestion)
      return
    }
    runPluginCommand(item.entry, item.isDev, customizeParams)
  }

  async function executeInstantSuggestion(suggestion: InstantSuggestion) {
    const action = suggestion.action
    try {
      if (action.type === 'copy') {
        const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
        await writeText(action.text)
        showToast(t(locale, 'palette.copied'), 'success')
      } else if (action.type === 'insert') {
        applyEffects([{ type: 'text.replace', target: 'active-input', text: action.text } as never])
      } else if (action.type === 'effects') {
        applyEffects(action.effects)
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      showToast(msg, 'error')
    }
    setOpen(false)
  }

  function shouldCustomizeParams(metaKey: boolean, ctrlKey: boolean) {
    return shortcutMeta.modifier === 'meta' ? metaKey : ctrlKey
  }

  function goToParam(
    plugin: SelectedPluginCommand,
    index: number,
    currentParams: Record<string, unknown>
  ) {
    const paramsList = plugin.params
    if (index >= paramsList.length) {
      // 所有参数配置完毕，执行
      const { inputs, commandParams } = resolveSelectedPluginCommand(plugin, currentParams)
      executePluginCommand(plugin.entry, plugin.isDev, inputs, commandParams)
      return
    }
    const param = paramsList[index]
    if (shouldSkipPluginCommandParam(plugin, param)) {
      goToParam(plugin, index + 1, currentParams)
      return
    }

    // Skip multi-select params when optionsFn returns <= maxSelect items (no choice needed)
    if ((param.type === 'multi-select' || param.type === 'single-select') && param.optionsFn) {
      const dynamicOpts = param.optionsFn()
      if (param.type === 'multi-select' && param.maxSelect && dynamicOpts.length <= param.maxSelect) {
        // Auto-select all and skip
        const allValues = dynamicOpts.map(o => o.value)
        const newParams = { ...currentParams, [param.key]: allValues }
        setParams(newParams)
        goToParam(plugin, index + 1, newParams)
        return
      }
    }

    setStep({ type: 'param', paramIndex: index })
    setSelectedIndex(0)
    setInputValue('')
    setInputError('')

    if (param.type === 'multi-select') {
      const defaultVal = currentParams[param.key]
      setMultiSelected(Array.isArray(defaultVal) ? defaultVal : [])
    } else {
      setMultiSelected([])
    }

    // 单选类型，预选默认值
    if (param.type === 'boolean') {
      const val = currentParams[param.key]
      setSelectedIndex(val ? 0 : 1)
    } else if (param.type === 'single-select') {
      const opts = getParamOptionValues(param)
      const idx = opts.indexOf(currentParams[param.key])
      setSelectedIndex(idx >= 0 ? idx : 0)
    } else if (param.type === 'text' || param.type === 'textarea' || param.type === 'number') {
      setInputValue(String(currentParams[param.key] ?? ''))
    }

    setTimeout(() => {
      if (param.type === 'text' || param.type === 'textarea' || param.type === 'number' || param.type === 'single-select' || param.type === 'multi-select') {
        inputRef.current?.focus()
      } else {
        panelRef.current?.focus()
      }
    }, 30)
  }

  function confirmCurrentParam(selectedIndexOverride?: number) {
    if (!selectedPlugin || !currentParam) return
    const index = step.type === 'param' ? step.paramIndex : 0
    const newParams = { ...params }
    const optionIndex = selectedIndexOverride ?? selectedIndex

    if (currentParam.type === 'boolean') {
      newParams[currentParam.key] = optionIndex === 0
    } else if (currentParam.type === 'single-select') {
      const opts = visibleOptions.map((option) => option.value)
      const selectedValue = opts[optionIndex]
      if (selectedValue === undefined) return
      newParams[currentParam.key] = selectedValue
    } else if (currentParam.type === 'multi-select') {
      if (currentParam.required && currentParam.maxSelect && multiSelected.length !== currentParam.maxSelect) {
        setInputError(t(locale, 'palette.needTwoPanes'))
        return
      }
      setInputError('')
      newParams[currentParam.key] = multiSelected
    } else if (currentParam.type === 'number') {
        const num = Number(inputValue)
        if (isNaN(num)) {
          setInputError(t(locale, 'palette.invalidNumber'))
          return
        }
        setInputError('')
        newParams[currentParam.key] = num
      } else {
        // text / textarea
        if (currentParam.required && !inputValue.trim()) {
          setInputError(t(locale, 'palette.fieldRequired'))
          return
        }
      setInputError('')
      newParams[currentParam.key] = inputValue
    }

    setParams(newParams)
    goToParam(selectedPlugin, index + 1, newParams)
  }

  function toggleMultiWithAutoConfirm(val: string) {
    setMultiSelected((prev) => {
      if (prev.includes(val)) {
        // Deselect
        return prev.filter((v) => v !== val)
      } else {
        // At maxSelect — ignore new selections (disabled items handle UI)
        if (currentParam?.maxSelect && prev.length >= currentParam.maxSelect) {
          return prev
        }
        return [...prev, val]
      }
    })
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // 忽略 IME 组合输入中的按键（中文输入法回车上屏等）
    if (shouldIgnoreImeKeyDown(e, isImeComposingRef)) return

    // 搜索步骤
    if (step.type === 'search') {
      if (e.key === 'Escape') { setOpen(false); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); isKeyboardNavRef.current = true; setSelectedIndex((i) => Math.min(i + 1, allFiltered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); isKeyboardNavRef.current = true; setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = allFiltered[selectedIndex]
        if (item) selectItem(item, shouldCustomizeParams(e.metaKey, e.ctrlKey))
      }
      return
    }

    // 参数步骤
    if (e.key === 'Escape') {
      // 返回上一步
      if (step.type === 'param' && step.paramIndex > 0 && selectedPlugin) {
        goToParam(selectedPlugin, step.paramIndex - 1, params)
      } else {
        setStep({ type: 'search' })
        setSelectedPlugin(null)
        setTimeout(() => inputRef.current?.focus(), 30)
      }
      return
    }

    if (isInputMode) {
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmCurrentParam()
      }
      return
    }

    if (isMultiSelect) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, Math.max(0, visibleOptions.length - 1))) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === ' ') {
        e.preventDefault()
        const val = visibleOptions[selectedIndex]?.value
        if (val) {
          toggleMultiWithAutoConfirm(val)
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmCurrentParam()
      }
      return
    }

    // 单选 (boolean / single-select)
    const optionCount = isFilterableSelect ? visibleOptions.length : currentOptions.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, Math.max(0, optionCount - 1))) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmCurrentParam()
    }
  }

  if (!open) return null

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  return (
    <div
      className={`fixed inset-0 flex items-start justify-center pt-[70px] z-50 palette-overlay ${open ? 'open' : ''}`}
      style={{
        pointerEvents: 'auto',
        visibility: 'visible',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
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
        {step.type === 'search' && (
          <SearchStep
            inputRef={inputRef}
            query={query}
            setQuery={(v) => { setQuery(v); setSelectedIndex(0) }}
            filteredItems={allFiltered}
            selectedIndex={selectedIndex}
            onSelectItem={(item, customizeParams) => selectItem(item, customizeParams)}
            onPinItem={(item) => {
              if (item.kind !== 'plugin') return
              pinPluginCommand({
                kind: 'plugin-command',
                actionId: item.entry.contribution.id,
                pluginId: item.entry.meta.pluginId,
                title: item.entry.contribution.title || item.entry.contribution.id,
                titleI18n: item.entry.contribution.titleI18n,
                icon: item.entry.contribution.icon,
                isDev: item.isDev,
                live: item.entry.contribution.live,
              })
              setOpen(false)
            }}
            setSelectedIndex={setSelectedIndex}
            isKeyboardNavRef={isKeyboardNavRef}
            shouldCustomizeParams={shouldCustomizeParams}
            shortcutMeta={shortcutMeta}
            locale={locale}
          />
        )}

        {step.type === 'param' && currentParam && (
          <ParamStep
            inputRef={inputRef}
            actionName={selectedPlugin ? getPluginDisplayTitle(selectedPlugin.entry, selectedPlugin.isDev, locale) : ''}
            param={currentParam}
            paramIndex={step.paramIndex}
            totalParams={(selectedPlugin?.params ?? []).length}
            options={visibleOptions}
            selectedIndex={selectedIndex}
            isInputMode={isInputMode}
            isMultiSelect={isMultiSelect}
            inputValue={inputValue}
            setInputValue={(value) => {
              setInputValue(value)
              if (isFilterableSelect) setSelectedIndex(0)
            }}
            inputError={inputError}
            multiSelected={multiSelected}
            onToggleMulti={(val) => {
              toggleMultiWithAutoConfirm(val)
            }}
            onSelectItem={(i) => { setSelectedIndex(i); confirmCurrentParam(i) }}
            optionQuery={isFilterableSelect ? inputValue : ''}
            isFilterableSelect={isFilterableSelect}
            locale={locale}
          />
        )}
      </div>
    </div>
  )
}

// 搜索步骤
function SearchStep({
  inputRef, query, setQuery, filteredItems, selectedIndex, onSelectItem, onPinItem, setSelectedIndex, isKeyboardNavRef, shouldCustomizeParams, shortcutMeta, locale,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  setQuery: (v: string) => void
  filteredItems: PaletteItem[]
  selectedIndex: number
  onSelectItem: (item: PaletteItem, customizeParams: boolean) => void
  onPinItem: (item: PaletteItem) => void
  setSelectedIndex: (i: number) => void
  isKeyboardNavRef: React.MutableRefObject<boolean>
  shouldCustomizeParams: (metaKey: boolean, ctrlKey: boolean) => boolean
  shortcutMeta: ShortcutMeta
  locale: import('../i18n').Locale
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
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="command-palette-results py-1" onMouseMove={() => { isKeyboardNavRef.current = false }}>
        {filteredItems.map((item, i) => (
          <ActionItem key={i} item={item} selected={selectedIndex === i} onClick={(event) => onSelectItem(item, shouldCustomizeParams(event.metaKey, event.ctrlKey))} onPin={() => onPinItem(item)} onMouseEnter={() => { if (!isKeyboardNavRef.current) setSelectedIndex(i) }} shortcutMeta={shortcutMeta} locale={locale} />
        ))}
        {filteredItems.length === 0 && (
          <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.noResults')}</div>
        )}
      </div>
      <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        <HintKey keys="↵" label={t(locale, 'palette.select')} />
        <HintKey keys="esc" label={t(locale, 'palette.close')} />
      </div>
    </>
  )
}

// 参数配置步骤
function ParamStep({
  inputRef, actionName, param, paramIndex, totalParams,
  options, selectedIndex, isInputMode, isMultiSelect,
  inputValue, setInputValue, inputError,
  multiSelected, onToggleMulti, onSelectItem, optionQuery, isFilterableSelect, locale,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  actionName: string
  param: PaletteParamModel
  paramIndex: number
  totalParams: number
  options: { label: string; value: string }[]
  selectedIndex: number
  isInputMode: boolean
  isMultiSelect: boolean
  inputValue: string
  setInputValue: (v: string) => void
  inputError: string
  multiSelected: string[]
  onToggleMulti: (val: string) => void
  onSelectItem: (i: number) => void
  optionQuery: string
  isFilterableSelect: boolean
  locale: import('../i18n').Locale
}) {
  const hintText = param.hintI18n?.[locale] || param.hint || ''
  const maxSelect = param.maxSelect

  return (
    <>
      {/* Header */}
      <div className="flex items-center px-3.5 h-[44px] gap-2" style={{ borderBottom: isInputMode ? 'none' : '0.5px solid var(--color-border-tertiary)' }}>
        <span className="text-[11px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
          {paramIndex + 1}/{totalParams}
        </span>
        <span className="text-[13px] font-medium shrink-0" style={{ color: 'var(--color-text-primary)' }}>{localized(param.label, param.labelI18n, locale)}</span>
        {param.required && (
          <span className="text-[10px] px-1.5 rounded shrink-0" style={{ background: 'var(--color-error-bg)', color: 'var(--color-error-text)' }}>{t(locale, 'palette.required')}</span>
        )}
        {isFilterableSelect && (
          <div className="flex items-center flex-1 min-w-0 gap-1.5">
            <Search size={14} className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            <input
              ref={inputRef}
              className="flex-1 min-w-0 border-none outline-none text-sm bg-transparent"
              style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
              placeholder={t(locale, 'palette.filterOptions')}
              value={optionQuery}
              onChange={(e) => setInputValue(e.target.value)}
              autoFocus
            />
          </div>
        )}
        {isInputMode && (
          <input
            ref={inputRef}
            className="flex-1 min-w-0 text-sm px-3 py-1.5 rounded-md outline-none"
            style={{
              background: 'var(--color-background-secondary)',
              border: inputError ? '1px solid var(--color-error)' : '0.5px solid var(--color-border-secondary)',
              color: 'var(--color-text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
            placeholder={param.type === 'number' ? t(locale, 'palette.inputNumber') : t(locale, 'palette.inputText')}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value)
            }}
            autoFocus
          />
        )}
        {isMultiSelect && maxSelect && (
          <span className="text-[11px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}>
            {multiSelected.length}/{maxSelect}
          </span>
        )}
        {!isMultiSelect && (
          <span className="ml-auto text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{actionName}</span>
        )}
      </div>

      {/* 输入错误/提示 */}
      {(inputError || (isInputMode && param.type === 'number')) && (
        <div className="px-3.5 pb-2">
          {inputError && (
            <div className="text-[11px] mt-1" style={{ color: 'var(--color-error)' }}>{inputError}</div>
          )}
          {param.type === 'number' && (
            <div className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.numbersOnly')}</div>
          )}
        </div>
      )}

      {/* 单选列表 */}
      {!isInputMode && !isMultiSelect && (
        <div className="max-h-[240px] overflow-y-auto py-1">
          {options.map((opt, i) => (
            <div
              key={opt.value}
              className="flex items-center px-3.5 py-2 cursor-pointer gap-2.5"
              style={{ background: selectedIndex === i ? 'var(--color-accent-light)' : 'transparent' }}
              onClick={() => onSelectItem(i)}
            >
              <div
                className="w-4 h-4 rounded-full border flex items-center justify-center shrink-0"
                style={{
                  borderColor: selectedIndex === i ? 'var(--color-accent)' : 'var(--color-border-secondary)',
                  background: selectedIndex === i ? 'var(--color-accent)' : 'transparent',
                }}
              >
                {selectedIndex === i && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              <span className="text-[13px]" style={{ color: selectedIndex === i ? 'var(--color-accent-hover)' : 'var(--color-text-primary)' }}>
                {opt.label}
              </span>
            </div>
          ))}
          {options.length === 0 && (
            <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.noOptions')}</div>
          )}
        </div>
      )}

      {/* 多选列表 */}
      {isMultiSelect && (
        <div className="max-h-[240px] overflow-y-auto py-1">
          {options.map((opt, i) => {
            const checked = multiSelected.includes(opt.value)
            const atLimit = !!(param.maxSelect && multiSelected.length >= param.maxSelect)
            const disabled = atLimit && !checked
            return (
              <div
                key={opt.value}
                className={`flex items-center px-3.5 py-2 gap-2.5 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                style={{
                  background: selectedIndex === i ? 'var(--color-accent-light)' : 'transparent',
                  opacity: disabled ? 0.4 : 1,
                }}
                onClick={() => !disabled && onToggleMulti(opt.value)}
              >
                <div
                  className="w-4 h-4 rounded border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: checked ? 'var(--color-accent)' : 'var(--color-border-secondary)',
                    background: checked ? 'var(--color-accent)' : 'transparent',
                  }}
                >
                  {checked && <Check size={10} color="white" />}
                </div>
                <span className="text-[13px]" style={{ color: 'var(--color-text-primary)' }}>
                  {opt.label}
                </span>
              </div>
            )
          })}
          {options.length === 0 && (
            <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.noOptions')}</div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex gap-3 px-3.5 py-1.5" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        {isInputMode && <HintKey keys="↵" label={t(locale, 'palette.confirm')} />}
        {!isInputMode && !isMultiSelect && <HintKey keys="↑↓" label={t(locale, 'palette.select')} />}
        {!isInputMode && !isMultiSelect && <HintKey keys="↵" label={t(locale, 'palette.confirm')} />}
        {isMultiSelect && <HintKey keys="space" label={t(locale, 'palette.toggle')} />}
        {isMultiSelect && <HintKey keys="↵" label={t(locale, 'palette.confirm')} />}
        <HintKey keys="esc" label={t(locale, 'palette.back')} />
        {hintText && (
          <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{hintText}</span>
        )}
      </div>
    </>
  )
}

function ActionItem({ item, selected, onClick, onPin, onMouseEnter, shortcutMeta, locale }: { item: PaletteItem; selected: boolean; onClick: (event: React.MouseEvent<HTMLDivElement>) => void; onPin: () => void; onMouseEnter: () => void; shortcutMeta: ShortcutMeta; locale: Locale }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  if (item.kind === 'instant') {
    const { suggestion, isDev } = item
    const title = localized(suggestion.title, suggestion.titleI18n, locale)
    const subtitle = localized(suggestion.subtitle ?? '', suggestion.subtitleI18n, locale)
    const actionLabel = localized(suggestion.actionLabel ?? '', suggestion.actionLabelI18n, locale)

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
          {resolveIcon(suggestion.icon, 14, suggestion.id)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isDev && (
              <span className="text-[9px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: 'var(--color-accent)', color: '#fff' }}>DEV</span>
            )}
            <div className="text-[13px] font-medium truncate" style={{ color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
              {title}
            </div>
          </div>
          <div className="text-[11px]" style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
            {subtitle}
          </div>
        </div>
        {actionLabel && (
          <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)', color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)' }}>
            {actionLabel}
          </span>
        )}
        {selected && (
          <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}>↵</kbd>
        )}
      </div>
    )
  }

  const isDev = item.isDev
  const name = item.entry.contribution.id
  const title = getPluginDisplayTitle(item.entry, item.isDev, locale)
  const subtitle = localized(item.entry.contribution.description || item.entry.contribution.id, item.entry.contribution.descriptionI18n, locale)
  const icon = item.entry.contribution.icon
  const canCustomizeParams = supportsDefaultParamRun(item.entry.contribution, normalizePluginParams(item.entry.contribution.params ?? []))
  const canPin = isCommandPinnable(item)

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
        {resolveIcon(icon, 14, name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {isDev && (
            <span className="text-[9px] px-1 py-0.5 rounded font-semibold shrink-0" style={{ background: 'var(--color-accent)', color: '#fff' }}>DEV</span>
          )}
          <div className="text-[13px] font-medium truncate" style={{ color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
            {title}
          </div>
        </div>
        <div className="text-[11px]" style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
          {subtitle}
        </div>
      </div>
      {canCustomizeParams && (
        <div
          className="customize-shortcut-chip flex items-center gap-1.5 shrink-0 rounded-md px-1.5 py-0.5"
          title={`${shortcutMeta.label} ${localized('params', { zh: '参数' }, locale)}`}
          style={{
            background: selected ? 'var(--color-background-primary)' : 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-tertiary)',
          }}
        >
          <kbd
            className="text-[10px] leading-none"
            style={{
              color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-secondary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {shortcutMeta.label}
          </kbd>
          <span className="text-[10px] leading-none">{t(locale, 'palette.customizeParamsLabel')}</span>
        </div>
      )}
      {canPin && (
        <button
          data-testid="command-palette-pin-action"
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

function HintKey({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
      <kbd className="text-[10px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)' }}>{keys}</kbd>
      {label}
    </span>
  )
}

// ── 推荐算法辅助函数 ───────────────────────────────────────────────────────────

function normalizeInstantSuggestions(suggestion: InstantSuggestion | InstantSuggestion[] | null): InstantSuggestion[] {
  if (!suggestion) return []
  return Array.isArray(suggestion) ? suggestion : [suggestion]
}

/** Compute instant suggestions for the given query */
function computeInstantSuggestions(query: string, locale: Locale): PaletteItem[] {
  const providers = pluginRegistry.getAllInstantSuggestionProviders()
  if (providers.length === 0) return []

  const sorted = [...providers].sort(
    (a, b) => (b.contribution.priority ?? 0) - (a.contribution.priority ?? 0)
  )

  const items: PaletteItem[] = []
  for (const { contribution, meta, isDev } of sorted) {
    try {
      const pluginT = makePluginT(meta.pluginId, locale)
      const suggestions = normalizeInstantSuggestions(contribution.suggest({ query, locale, t: pluginT }))
      for (const suggestion of suggestions) {
        items.push({
          kind: 'instant',
          provider: contribution,
          suggestion,
          isDev,
        })
      }
    } catch {
      // Single provider error should not break the palette
    }
  }

  return items
}

function paramOptionMatchesQuery(option: { label: string; value: string }, query: string): boolean {
  const label = option.label.toLowerCase()
  const value = option.value.toLowerCase()
  return label.includes(query) || (isSearchableOptionValue(value) && value.includes(query)) || pinyinMatch(option.label, query)
}

function isSearchableOptionValue(value: string): boolean {
  return !value.includes(':')
}

function isCommandPinnable(item: PaletteItem): boolean {
  if (item.kind !== 'plugin') return false
  return item.entry.contribution.live?.pinnable !== false
}

/** 检查 query 是否匹配某个 PaletteItem（含缩写匹配） */
function paletteItemMatchesQuery(item: PaletteItem, q: string, locale: import('../i18n').Locale): boolean {
  if (item.kind !== 'plugin') return false
  const contribution = item.entry.contribution
  return searchableFieldsMatch({
    id: contribution.id,
    title: contribution.title,
    titleI18n: contribution.titleI18n,
    description: contribution.description,
    descriptionI18n: contribution.descriptionI18n,
    aliases: contribution.aliases,
  }, q, locale)
}

/**
 * 计算 PaletteItem 的综合推荐分（越高越靠前）。
 *
 * 无搜索词时：recency(0-50) + log(频次)×5
 * 有搜索词时：匹配质量层(×1000) + recency + log(频次)×5
 *   层级：精确名/id(6) > 名前缀(5) > 标题前缀(4) > 词边界(3) > 缩写(2) > 子串(1)
 */
function scorePaletteItem(
  item: PaletteItem,
  q: string,
  locale: import('../i18n').Locale,
  recentNames: string[],
  usageCounts: Record<string, number>
): number {
  if (item.kind !== 'plugin') return 0
  const contribution = item.entry.contribution
  return scoreSearchableFields({
    id: contribution.id,
    title: contribution.title,
    titleI18n: contribution.titleI18n,
    description: contribution.description,
    descriptionI18n: contribution.descriptionI18n,
    aliases: contribution.aliases,
  }, q, locale, recentNames, usageCounts)
}

// ─────────────────────────────────────────────────────────────────────────────

type ShortcutMeta = {
  modifier: 'meta' | 'ctrl'
  label: string
}

function getPlatformShortcutMeta(): ShortcutMeta {
  return isMacPlatform() ? { modifier: 'meta', label: '⌘' } : { modifier: 'ctrl', label: 'Ctrl' }
}

function isMacPlatform(): boolean {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  const platform = nav?.platform || ''
  const userAgent = nav?.userAgent || ''
  const userAgentDataPlatform = (nav as Navigator & { userAgentData?: { platform?: string } } | undefined)?.userAgentData?.platform || ''
  return /Mac|iPhone|iPad|iPod/i.test(`${platform} ${userAgentDataPlatform} ${userAgent}`)
}

function normalizePluginParams(pluginParams: CommandParam[]): PaletteParamModel[] {
  return pluginParams.map((param) => ({
    key: param.key,
    label: param.label,
    labelI18n: param.labelI18n,
    type: param.type,
    options: param.options,
    default: param.default,
    required: param.required,
    hint: param.hint,
    hintI18n: param.hintI18n,
  }))
}

function getDefaultActionParams(paramList: PaletteParamModel[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const param of paramList) {
    result[param.key] = param.default ?? getDefaultForType(param)
  }
  return result
}

function getDefaultPluginParams(paramList: CommandParam[]): Record<string, unknown> {
  return getDefaultActionParams(normalizePluginParams(paramList))
}

function supportsDefaultParamRun(
  command: { optionalParams?: boolean },
  paramList: PaletteParamModel[]
): boolean {
  return command.optionalParams === true && hasExplicitDefaultParams(paramList)
}

function hasExplicitDefaultParams(paramList: PaletteParamModel[]): boolean {
  return paramList.length > 0 && paramList.every((param) => param.default !== undefined)
}

function shouldSkipPluginCommandParam(plugin: SelectedPluginCommand, param: PaletteParamModel): boolean {
  if (plugin.customizeParams) return false
  const pluginParams = normalizePluginParams(plugin.entry.contribution.params ?? [])
  if (!supportsDefaultParamRun(plugin.entry.contribution, pluginParams)) return false
  return !Object.values(plugin.inputParamKeys).includes(param.key)
}

function getParamOptionValues(param: PaletteParamModel): string[] {
  if (param.optionsFn) return param.optionsFn().map((option) => option.value)
  return (param.options || []).map((option) => typeof option === 'string' ? option : option.value)
}

function buildPluginInputParams(
  slots: InputSlot[],
  clipboardText?: string
): { params: PaletteParamModel[]; inputParamKeys: Record<string, string>; inputPairParamKey?: string; inputPairSlotKeys?: string[] } {
  const paneSlots = slots.filter((slot) => slot.kind === 'pane')
  const inputParamKeys: Record<string, string> = {}
  const params: PaletteParamModel[] = []
  const offerFallbacks = shouldOfferPaneFallbacks(slots)

  if (paneSlots.length === 2 && paneSlots.every((slot) => slot.required)) {
    const pairKey = '__input:panePair'
    inputParamKeys[paneSlots[0].key] = pairKey
    inputParamKeys[paneSlots[1].key] = pairKey
    params.push({
      key: pairKey,
      label: 'Select 2 panes',
      labelI18n: { zh: '选择 2 个面板' },
      type: 'multi-select',
      required: true,
      maxSelect: 2,
      optionsFn: () => buildPanePairInputOptions(offerFallbacks, clipboardText),
      default: getDefaultPanePairInputValues(offerFallbacks),
      hint: 'Select any two panes or sources to compare',
      hintI18n: { zh: '选择任意两个面板或来源进行对比' },
    })
    return { params, inputParamKeys, inputPairParamKey: pairKey, inputPairSlotKeys: paneSlots.map((slot) => slot.key) }
  }

  for (const slot of paneSlots) {
    const key = `__input:${slot.key}`
    inputParamKeys[slot.key] = key
    params.push({
      key,
      label: slot.label || slot.key,
      labelI18n: slot.labelI18n,
      type: 'single-select',
      required: slot.required,
      optionsFn: () => buildPaneInputOptions(slot, offerFallbacks, clipboardText),
      default: getDefaultPaneInputValue(slot, paneSlots, offerFallbacks),
      hint: 'Select a pane or source',
      hintI18n: { zh: '选择一个面板或来源' },
    })
  }

  return { params, inputParamKeys }
}

function buildPanePairInputOptions(
  offerFallbacks: boolean,
  clipboardText?: string
): { label: string; value: string }[] {
  const locale = useAppStore.getState().locale
  const ws = useWorkspaceStore.getState()
  const options = ws.paneOrder.map((paneId) => ({
    label: ws.panes[paneId]?.title || paneId,
    value: `pane:${paneId}`,
  }))

  if (offerFallbacks) {
    if (clipboardText) {
      options.push({
        label: `${t(locale, 'palette.clipboard')} (${formatPreview(clipboardText)})`,
        value: 'source:clipboard',
      })
    }
    options.push(
      { label: t(locale, 'palette.emptyRightPane'), value: 'source:empty-pane' },
      { label: t(locale, 'palette.duplicateCurrentPane'), value: 'source:duplicate' }
    )
  }

  return options
}

function buildPaneInputOptions(
  slot: InputSlot,
  offerFallbacks: boolean,
  clipboardText?: string
): { label: string; value: string }[] {
  const ws = useWorkspaceStore.getState()
  const locale = useAppStore.getState().locale
  const options = ws.paneOrder.map((paneId) => ({
    label: ws.panes[paneId]?.title || paneId,
    value: `pane:${paneId}`,
  }))

  if (offerFallbacks && slot.key !== 'original') {
    if (clipboardText) {
      options.push({
        label: `${t(locale, 'palette.clipboard')} (${formatPreview(clipboardText)})`,
        value: 'source:clipboard',
      })
    }
    options.push(
      { label: t(locale, 'palette.emptyRightPane'), value: 'source:empty-pane' },
      { label: t(locale, 'palette.duplicateCurrentPane'), value: 'source:duplicate' }
    )
  }

  return options
}

function getDefaultPaneInputValue(
  slot: InputSlot,
  paneSlots: InputSlot[],
  offerFallbacks: boolean
): string {
  const ws = useWorkspaceStore.getState()
  const slotIndex = paneSlots.findIndex((paneSlot) => paneSlot.key === slot.key)

  if (slotIndex === 0 && ws.activePaneId) {
    return `pane:${ws.activePaneId}`
  }
  if (slotIndex === 1) {
    const fallbackPaneId = ws.paneOrder.find((paneId) => paneId !== ws.activePaneId)
    if (fallbackPaneId) return `pane:${fallbackPaneId}`
    if (offerFallbacks) return 'source:empty-pane'
  }

  return ws.paneOrder[0] ? `pane:${ws.paneOrder[0]}` : ''
}

function getDefaultPanePairInputValues(offerFallbacks: boolean): string[] {
  const ws = useWorkspaceStore.getState()
  const values: string[] = []
  if (ws.activePaneId) values.push(`pane:${ws.activePaneId}`)
  const secondPaneId = ws.paneOrder.find((paneId) => paneId !== ws.activePaneId)
  if (secondPaneId) values.push(`pane:${secondPaneId}`)
  if (values.length < 2 && offerFallbacks) values.push('source:empty-pane')
  return values.slice(0, 2)
}

function shouldOfferPaneFallbacks(slots: InputSlot[]): boolean {
  const paneSlots = slots.filter((slot) => slot.kind === 'pane' && slot.required)
  return paneSlots.length > 1 && useWorkspaceStore.getState().paneOrder.length === 1
}

function resolveSelectedPluginCommand(
  plugin: SelectedPluginCommand,
  finalParams: Record<string, unknown>
): { inputs: ResolvedInputs; commandParams: Record<string, unknown> } {
  const inputs: ResolvedInputs = { ...plugin.inputs }
  const commandParams: Record<string, unknown> = {}
  const inputParamKeySet = new Set(Object.values(plugin.inputParamKeys))

  for (const [key, value] of Object.entries(finalParams)) {
    if (!inputParamKeySet.has(key)) commandParams[key] = value
  }

  if (plugin.inputPairParamKey && plugin.inputPairSlotKeys) {
    const values = Array.isArray(finalParams[plugin.inputPairParamKey]) ? finalParams[plugin.inputPairParamKey] as string[] : []
    plugin.inputPairSlotKeys.forEach((slotKey, index) => {
      inputs[slotKey] = resolvePaneInputValue(values[index] ?? '', plugin.clipboardText)
    })
  } else {
    for (const slot of plugin.inputSlots) {
      if (slot.kind !== 'pane') continue
      const paramKey = plugin.inputParamKeys[slot.key]
      const value = String(finalParams[paramKey] ?? '')
      inputs[slot.key] = resolvePaneInputValue(value, plugin.clipboardText)
    }
  }

  return { inputs, commandParams }
}

function resolvePaneInputValue(value: string, clipboardText?: string): PaneInput {
  const ws = useWorkspaceStore.getState()
  const locale = useAppStore.getState().locale
  if (value.startsWith('pane:')) {
    const paneId = value.slice('pane:'.length)
    return toPaneInput(paneId, ws.panes[paneId])
  }

  if (value === 'source:clipboard') {
    const newPaneId = ws.createPane({ text: clipboardText ?? '', title: t(locale, 'palette.clipboard'), focus: false, direction: 'right' })
    return toPaneInput(newPaneId, useWorkspaceStore.getState().panes[newPaneId])
  }

  if (value === 'source:duplicate') {
    const sourcePane = ws.panes[ws.activePaneId] ?? ws.panes[ws.paneOrder[0]]
    const newPaneId = ws.createPane({ text: sourcePane?.text ?? '', title: locale === 'zh' ? '副本' : 'Copy', language: sourcePane?.language, stickyScroll: sourcePane?.stickyScroll === true, focus: false, direction: 'right' })
    return toPaneInput(newPaneId, useWorkspaceStore.getState().panes[newPaneId])
  }

  const newPaneId = ws.createPane({ text: '', focus: false, direction: 'right' })
  return toPaneInput(newPaneId, useWorkspaceStore.getState().panes[newPaneId])
}

function toPaneInput(paneId: string, pane: ReturnType<typeof useWorkspaceStore.getState>['panes'][string] | undefined): PaneInput {
  return {
    kind: 'pane',
    paneId,
    text: pane?.text ?? '',
    title: pane?.title ?? 'New Pane',
    language: pane?.language ?? 'plaintext',
    stickyScroll: pane?.stickyScroll === true,
  }
}

function formatPreview(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 30 ? `${compact.slice(0, 30)}...` : compact
}

function getPluginDisplayTitle(entry: CommandEntry, isDev: boolean, locale: Locale): string {
  const title = localized(entry.contribution.title || entry.contribution.id, entry.contribution.titleI18n, locale)
  return isDev ? `[DEV] ${title}` : title
}

function getDefaultForType(param: PaletteParamModel): unknown {
  switch (param.type) {
    case 'boolean': return false
    case 'number': return 0
    case 'text': return ''
    case 'textarea': return ''
    case 'single-select': {
      const opts = param.options || []
      if (opts.length === 0) return ''
      const first = opts[0]
      return typeof first === 'string' ? first : first.value
    }
    case 'multi-select': return []
    default: return ''
  }
}
