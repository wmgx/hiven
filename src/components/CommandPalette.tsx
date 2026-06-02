import { useState, useEffect, useMemo, useRef } from 'react'
import { useAppStore, localized } from '../store'
import type { ActionDef, ActionParam } from '../store'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { runLegacyAction } from '../workspace/commandAdapter'
import { applyEffects } from '../workspace/effectRunner'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import { resolvePluginInputs, buildPluginCommandContext } from '../workspace/pluginInputResolver'
import { showToast } from '../workspace/toast'
import type { CommandEntry } from '../workspace/pluginRegistry'
import type { CommandParam, InputSlot, PaneInput } from '../workspace/pluginTypes'
import type { ResolvedInputs } from '../workspace/pluginTypes'
import { Search, Check } from 'lucide-react'
import { t, type Locale } from '../i18n'
import { readText } from '@tauri-apps/plugin-clipboard-manager'
import { loadCDN, loadDeps } from '../utils/cdnLoader'
import { resolveIcon } from '../utils/resolveIcon'
import { pinyin } from 'pinyin-pro'

// 步骤类型
type Step =
  | { type: 'search' }
  | { type: 'param'; paramIndex: number }

type PaletteItem =
  | { kind: 'legacy'; action: ActionDef }
  | { kind: 'plugin'; entry: CommandEntry; isDev: boolean }

type SelectedPluginCommand = {
  entry: CommandEntry
  isDev: boolean
  inputs: ResolvedInputs
  params: ActionParam[]
  inputSlots: InputSlot[]
  inputParamKeys: Record<string, string>
  inputPairParamKey?: string
  inputPairSlotKeys?: string[]
  clipboardText?: string
}

export function CommandPalette() {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const actions = useAppStore((s) => s.actions)
  const disabledBuiltins = useAppStore((s) => s.settings.disabledBuiltins)
  const disabledCustoms = useAppStore((s) => s.settings.disabledCustoms)
  const setLastCommandStatus = useAppStore((s) => s.setLastCommandStatus)
  const recentActionNames = useAppStore((s) => s.recentActionNames)
  const pushRecentAction = useAppStore((s) => s.pushRecentAction)
  const actionUsageCounts = useAppStore((s) => s.actionUsageCounts)
  const persistParams = useAppStore((s) => s.settings.persistParams)
  const savedActionParams = useAppStore((s) => s.savedActionParams)
  const saveActionParams = useAppStore((s) => s.saveActionParams)
  const locale = useAppStore((s) => s.locale)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [step, setStep] = useState<Step>({ type: 'search' })
  const [selectedAction, setSelectedAction] = useState<ActionDef | null>(null)
  const [selectedPlugin, setSelectedPlugin] = useState<SelectedPluginCommand | null>(null)
  const [params, setParams] = useState<Record<string, unknown>>({})
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isKeyboardNavRef = useRef(false)

  const pluginRegistryVersion = usePluginRegistryVersion()

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setQuery('')
      setSelectedIndex(0)
      setStep({ type: 'search' })
      setSelectedAction(null)
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

  // 统一过滤 + 排序：legacy 与 plugin 命令合并，支持缩写匹配和复合评分
  const allFiltered = useMemo<PaletteItem[]>(() => {
    void pluginRegistryVersion

    // 去重收集 legacy items
    const seen = new Set<string>()
    const legacyItems: PaletteItem[] = actions
      .filter((a) => {
        if (seen.has(a.name)) return false
        seen.add(a.name)
        if (a.builtin) return !disabledBuiltins.includes(a.name)
        return !disabledCustoms.includes(a.name)
      })
      .map((action) => ({ kind: 'legacy' as const, action }))

    // 收集 plugin items
    const pluginItems: PaletteItem[] = pluginRegistry.getAllCommands().map(({ contribution, meta, isDev }) => ({
      kind: 'plugin' as const,
      entry: { contribution, meta },
      isDev,
    }))

    const allItems = [...legacyItems, ...pluginItems]
    const q = query.trim().toLowerCase()

    // 过滤（含缩写匹配）
    const filtered = q ? allItems.filter((item) => paletteItemMatchesQuery(item, q, locale)) : allItems

    // 按复合评分降序排列
    return [...filtered].sort((a, b) =>
      scorePaletteItem(b, q, locale, recentActionNames, actionUsageCounts) -
      scorePaletteItem(a, q, locale, recentActionNames, actionUsageCounts)
    )
  }, [query, actions, recentActionNames, actionUsageCounts, disabledBuiltins, disabledCustoms, locale, pluginRegistryVersion])

  // 当前参数
  const currentParam: ActionParam | null =
    step.type === 'param'
      ? (selectedPlugin?.params ?? selectedAction?.params ?? [])[step.paramIndex] ?? null
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

  async function runAction(action: ActionDef, finalParams: Record<string, unknown>) {
    pushRecentAction(action.name)
    const commandTitle = localized(action.title, action.titleI18n, locale)
    setLastCommandStatus({ title: commandTitle, status: 'running', updatedAt: Date.now() })

    // 保存参数（仅保存 boolean/select 类型的值，跳过动态参数）
    if (persistParams && action.params && action.params.length > 0) {
      const toSave: Record<string, unknown> = {}
      for (const param of action.params) {
        if (param.optionsFn) continue // 动态选项不持久化
        if (param.type === 'boolean' || param.type === 'single-select' || param.type === 'multi-select') {
          toSave[param.key] = finalParams[param.key]
        }
      }
      if (Object.keys(toSave).length > 0) {
        saveActionParams(action.name, toSave)
      }
    }

    // 获取 editor 实例，判断是否有选区
    const editor = useAppStore.getState().editorInstance
    const editorText = useWorkspaceStore.getState().getActivePaneText()
    let inputText = editorText

    if (editor) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        inputText = editor.getModel()?.getValueInRange(sel) || editorText
      }
    }

    // 加载脚本声明的 @deps 依赖并注入 ctx
    let deps: Record<string, unknown>
    try {
      deps = action.source ? await loadDeps(action.source) : {}
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setLastCommandStatus({ title: commandTitle, status: 'error', message, updatedAt: Date.now() })
      setOpen(false)
      return
    }

    const ctx = {
      input: { text: inputText },
      params: finalParams,
      readClipboard: async () => {
        try {
          return (await readText()) ?? ''
        } catch {
          return ''
        }
      },
      loadCDN,
      deps,
    }

    try {
      // Use command adapter + effect runner pipeline
      const commandResult = await runLegacyAction(action, ctx)

      if (commandResult.effects.length > 0) {
        const runResult = applyEffects(commandResult.effects)
        if (runResult.errors.length > 0) {
          setLastCommandStatus({ title: commandTitle, status: 'error', message: runResult.errors[0], updatedAt: Date.now() })
        } else {
          setLastCommandStatus({ title: commandTitle, status: 'success', updatedAt: Date.now() })
        }
      } else {
        setLastCommandStatus({ title: commandTitle, status: 'success', updatedAt: Date.now() })
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e)
      setLastCommandStatus({ title: commandTitle, status: 'error', message, updatedAt: Date.now() })
    }
    setOpen(false)
  }

  // Execute a plugin command with already-resolved inputs
  function executePluginCommand(
    entry: CommandEntry,
    isDev: boolean,
    inputs: ResolvedInputs,
    finalParams?: Record<string, unknown>
  ) {
    const commandTitle = getPluginDisplayTitle(entry, isDev, locale)
    setLastCommandStatus({ title: commandTitle, status: 'running', updatedAt: Date.now() })
    const ctx = buildPluginCommandContext(inputs, finalParams ?? getDefaultPluginParams(entry.contribution.params ?? []))
    try {
      const result = entry.contribution.run(ctx)
      // Stamp effects with _isDev so effectRunner uses dev registry for renderer/panel resolution
      const effects = isDev
        ? result.effects.map((e) => {
            if (e.type === 'pane.setRenderer') return { ...e, _isDev: true }
            if (e.type === 'panel.openV2') return { ...e, _isDev: true }
            return e
          })
        : result.effects
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

  function startPluginParamFlow(entry: CommandEntry, isDev: boolean, inputs: ResolvedInputs) {
    const pluginParams = normalizePluginParams(entry.contribution.params ?? [])
    const initialParams = getDefaultActionParams(pluginParams)
    if (pluginParams.length === 0) {
      executePluginCommand(entry, isDev, inputs, initialParams)
      return
    }

    const pluginSelection: SelectedPluginCommand = {
      entry,
      isDev,
      inputs,
      params: pluginParams,
      inputSlots: [],
      inputParamKeys: {},
    }
    setSelectedAction(null)
    setSelectedPlugin(pluginSelection)
    setParams(initialParams)
    goToParam(null, pluginSelection, 0, initialParams)
  }

  function startPluginInputParamFlow(
    entry: CommandEntry,
    isDev: boolean,
    slots: InputSlot[],
    clipboardText?: string
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
      inputSlots: slots,
      inputParamKeys,
      inputPairParamKey,
      inputPairSlotKeys,
      clipboardText,
    }
    setSelectedAction(null)
    setSelectedPlugin(pluginSelection)
    setParams(initialParams)
    goToParam(null, pluginSelection, 0, initialParams)
  }

  async function runPluginCommand(entry: CommandEntry, isDev: boolean) {
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
        startPluginInputParamFlow(entry, isDev, resolveResult.slots, clipboardText)
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

    startPluginParamFlow(entry, isDev, resolveResult.inputs)
  }

  function selectItem(item: PaletteItem) {
    if (item.kind === 'legacy') {
      selectAction(item.action)
    } else {
      runPluginCommand(item.entry, item.isDev)
    }
  }

  function selectAction(action: ActionDef) {
    setSelectedAction(action)
    setSelectedPlugin(null)
    // 初始化所有参数为默认值
    const p = getDefaultActionParams(action.params || [])
    // 如果开启了参数持久化，用上次保存的值覆盖默认值（仅覆盖 boolean 和 select 类型，跳过动态参数）
    if (persistParams && savedActionParams[action.name]) {
      const saved = savedActionParams[action.name]
      for (const param of action.params || []) {
        if (param.optionsFn) continue // 动态选项不恢复
        if (param.key in saved && (param.type === 'boolean' || param.type === 'single-select' || param.type === 'multi-select')) {
          p[param.key] = saved[param.key]
        }
      }
    }
    setParams(p)

    if (!action.params || action.params.length === 0) {
      // 无参数，直接执行
      runAction(action, p)
    } else {
      // 进入第一个参数步骤
      goToParam(action, null, 0, p)
    }
  }

  function goToParam(
    action: ActionDef | null,
    plugin: SelectedPluginCommand | null,
    index: number,
    currentParams: Record<string, unknown>
  ) {
    const paramsList = action?.params || plugin?.params || []
    if (index >= paramsList.length) {
      // 所有参数配置完毕，执行
      if (action) {
        runAction(action, currentParams)
      } else if (plugin) {
        const { inputs, commandParams } = resolveSelectedPluginCommand(plugin, currentParams)
        executePluginCommand(plugin.entry, plugin.isDev, inputs, commandParams)
      }
      return
    }
    const param = paramsList[index]

    // Skip multi-select params when optionsFn returns <= maxSelect items (no choice needed)
    if ((param.type === 'multi-select' || param.type === 'single-select') && param.optionsFn) {
      const dynamicOpts = param.optionsFn()
      if (param.type === 'multi-select' && param.maxSelect && dynamicOpts.length <= param.maxSelect) {
        // Auto-select all and skip
        const allValues = dynamicOpts.map(o => o.value)
        const newParams = { ...currentParams, [param.key]: allValues }
        setParams(newParams)
        goToParam(action, plugin, index + 1, newParams)
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
    if ((!selectedAction && !selectedPlugin) || !currentParam) return
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
    goToParam(selectedAction, selectedPlugin, index + 1, newParams)
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
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

    // 搜索步骤
    if (step.type === 'search') {
      if (e.key === 'Escape') { setOpen(false); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); isKeyboardNavRef.current = true; setSelectedIndex((i) => Math.min(i + 1, allFiltered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); isKeyboardNavRef.current = true; setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        const item = allFiltered[selectedIndex]
        if (item) selectItem(item)
      }
      return
    }

    // 参数步骤
    if (e.key === 'Escape') {
      // 返回上一步
      if (step.type === 'param' && step.paramIndex > 0) {
        goToParam(selectedAction, selectedPlugin, step.paramIndex - 1, params)
      } else {
        setStep({ type: 'search' })
        setSelectedAction(null)
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

  return (
    <div
      className={`fixed inset-0 flex items-start justify-center pt-[70px] z-50 palette-overlay ${open ? 'open' : ''}`}
      style={{ pointerEvents: open ? 'auto' : 'none' }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="w-[min(630px,90vw)] overflow-hidden outline-none palette-panel"
        style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        }}
        onKeyDown={handleKeyDown}
      >
        {step.type === 'search' && (
          <SearchStep
            inputRef={inputRef}
            query={query}
            setQuery={(v) => { setQuery(v); setSelectedIndex(0) }}
            filteredItems={allFiltered}
            selectedIndex={selectedIndex}
            onSelectItem={(item) => selectItem(item)}
            setSelectedIndex={setSelectedIndex}
            isKeyboardNavRef={isKeyboardNavRef}
            locale={locale}
          />
        )}

        {step.type === 'param' && currentParam && (
          <ParamStep
            inputRef={inputRef}
            actionName={selectedPlugin ? getPluginDisplayTitle(selectedPlugin.entry, selectedPlugin.isDev, locale) : selectedAction?.name ?? ''}
            param={currentParam}
            paramIndex={step.paramIndex}
            totalParams={(selectedPlugin?.params ?? selectedAction?.params ?? []).length}
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
  inputRef, query, setQuery, filteredItems, selectedIndex, onSelectItem, setSelectedIndex, isKeyboardNavRef, locale,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  setQuery: (v: string) => void
  filteredItems: PaletteItem[]
  selectedIndex: number
  onSelectItem: (item: PaletteItem) => void
  setSelectedIndex: (i: number) => void
  isKeyboardNavRef: React.MutableRefObject<boolean>
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
      <div className="max-h-[300px] overflow-y-auto py-1" onMouseMove={() => { isKeyboardNavRef.current = false }}>
        {filteredItems.map((item, i) => (
          <ActionItem key={i} item={item} selected={selectedIndex === i} onClick={() => onSelectItem(item)} onMouseEnter={() => { if (!isKeyboardNavRef.current) setSelectedIndex(i) }} locale={locale} />
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
  param: ActionParam
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

function ActionItem({ item, selected, onClick, onMouseEnter, locale }: { item: PaletteItem; selected: boolean; onClick: () => void; onMouseEnter: () => void; locale: Locale }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

  const isPlugin = item.kind === 'plugin'
  const isDev = isPlugin && item.isDev
  const name = isPlugin ? item.entry.contribution.id : item.action.name
  const title = isPlugin ? getPluginDisplayTitle(item.entry, item.isDev, locale) : localized(item.action.title, item.action.titleI18n, locale)
  const subtitle = isPlugin
    ? localized(item.entry.contribution.description || item.entry.contribution.id, item.entry.contribution.descriptionI18n, locale)
    : title
  const icon = isPlugin ? item.entry.contribution.icon : item.action.icon

  return (
    <div
      ref={ref}
      className="flex items-center px-3.5 py-1.5 cursor-pointer gap-2.5"
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
            {isPlugin ? title : name}
          </div>
        </div>
        <div className="text-[11px]" style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
          {subtitle}
        </div>
      </div>
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

/** 将命令 id/name 转为首字母缩写，例如 "json-format" → "jf" */
function getAcronym(name: string): string {
  return name.split(/[-_\s]+/).filter(Boolean).map((w) => w[0]).join('')
}

// 拼音转换缓存（避免在同一次渲染中重复计算）
const _pinyinCache = new Map<string, { full: string; initials: string }>()

/**
 * 拼音匹配：
 *   - 全拼包含：query "geshihua" 可匹配 "格式化"
 *   - 首字母前缀：query "gsh" 可匹配 "格式化"（声母 g-sh-h 的首字母）
 * 只对纯 ASCII 字母 query 生效，避免误触发。
 */
function pinyinMatch(text: string, query: string): boolean {
  if (!text || !query) return false
  if (!/^[a-z]+$/.test(query)) return false

  let cached = _pinyinCache.get(text)
  if (!cached) {
    const full = pinyin(text, { toneType: 'none', separator: '' }).toLowerCase()
    const initials = pinyin(text, { pattern: 'initial', toneType: 'none', separator: '' }).toLowerCase()
    cached = { full, initials }
    _pinyinCache.set(text, cached)
  }

  return cached.full.includes(query) || cached.initials.startsWith(query)
}

function paramOptionMatchesQuery(option: { label: string; value: string }, query: string): boolean {
  const label = option.label.toLowerCase()
  const value = option.value.toLowerCase()
  return label.includes(query) || (isSearchableOptionValue(value) && value.includes(query)) || pinyinMatch(option.label, query)
}

function isSearchableOptionValue(value: string): boolean {
  return !value.includes(':')
}

/** 检查 query 是否匹配某个 PaletteItem（含缩写匹配） */
function paletteItemMatchesQuery(item: PaletteItem, q: string, locale: import('../i18n').Locale): boolean {
  const id = item.kind === 'legacy' ? item.action.name : item.entry.contribution.id
  const name = id.toLowerCase()
  const title = (
    item.kind === 'legacy'
      ? localized(item.action.title, item.action.titleI18n, locale)
      : localized(item.entry.contribution.title || id, item.entry.contribution.titleI18n, locale)
  ).toLowerCase()

  if (name.includes(q) || title.includes(q)) return true

  const titleI18n = item.kind === 'legacy' ? item.action.titleI18n : item.entry.contribution.titleI18n
  if (Object.values(titleI18n || {}).some((v) => v && v.toLowerCase().includes(q))) return true

  const desc = item.kind === 'legacy' ? (item.action.description || '') : (item.entry.contribution.description || '')
  if (desc.toLowerCase().includes(q)) return true

  const descI18n = item.kind === 'legacy' ? item.action.descriptionI18n : item.entry.contribution.descriptionI18n
  if (Object.values(descI18n || {}).some((v) => v && v.toLowerCase().includes(q))) return true

  if (item.kind === 'legacy' && (item.action.aliases || []).some((a) => a.toLowerCase().includes(q))) return true

  const tags = item.kind === 'legacy' ? (item.action.tags || []) : (item.entry.contribution.tags || [])
  if (tags.some((tag) => tag.toLowerCase().includes(q))) return true

  // 缩写匹配：从 id/name 算一遍，再从英文原始 title 算一遍
  // 例如 id="json-diff.compare" name 缩写是 "jdc"，但 title="JSON Diff" 缩写是 "jd" ✓
  const acronym = getAcronym(name)
  if (acronym.startsWith(q) || acronym === q) return true

  const engTitle = (item.kind === 'legacy'
    ? item.action.title
    : (item.entry.contribution.title || id)
  ).toLowerCase()
  const titleAcronym = getAcronym(engTitle)
  if (titleAcronym.startsWith(q) || titleAcronym === q) return true

  // 拼音匹配：对所有中文文本字段检查全拼和首字母
  const zhTitle = (item.kind === 'legacy' ? item.action.titleI18n?.zh : item.entry.contribution.titleI18n?.zh) ?? ''
  const zhDesc = (item.kind === 'legacy' ? item.action.descriptionI18n?.zh : item.entry.contribution.descriptionI18n?.zh) ?? ''
  if (pinyinMatch(zhTitle || title, q)) return true
  if (zhDesc && pinyinMatch(zhDesc, q)) return true

  return false
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
  const id = item.kind === 'legacy' ? item.action.name : item.entry.contribution.id
  const recentIdx = recentNames.indexOf(id)
  const recencyScore = recentIdx >= 0 ? 50 - recentIdx : 0
  const freq = usageCounts[id] ?? 0
  const freqScore = Math.log1p(freq) * 5
  const baseScore = recencyScore + freqScore

  if (!q) return baseScore

  const name = id.toLowerCase()
  const title = (
    item.kind === 'legacy'
      ? localized(item.action.title, item.action.titleI18n, locale)
      : localized(item.entry.contribution.title || id, item.entry.contribution.titleI18n, locale)
  ).toLowerCase()

  let tier = 1 // 默认子串匹配层
  if (name === q || title === q) {
    tier = 6
  } else if (name.startsWith(q)) {
    tier = 5
  } else if (title.startsWith(q)) {
    tier = 4
  } else {
    // 词边界：name 或 title 按分隔符拆词后，有词以 q 开头
    const nameWords = name.split(/[-_\s]+/).filter(Boolean)
    const titleWords = title.split(/[-_\s]+/).filter(Boolean)
    if (nameWords.some((w) => w.startsWith(q)) || titleWords.some((w) => w.startsWith(q))) {
      tier = 3
    } else if (getAcronym(name).startsWith(q)) {
      // 缩写匹配
      tier = 2
    }
  }

  return tier * 1000 + baseScore
}

// ─────────────────────────────────────────────────────────────────────────────

function normalizePluginParams(pluginParams: CommandParam[]): ActionParam[] {
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

function getDefaultActionParams(paramList: ActionParam[]): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const param of paramList) {
    result[param.key] = param.default ?? getDefaultForType(param)
  }
  return result
}

function getDefaultPluginParams(paramList: CommandParam[]): Record<string, unknown> {
  return getDefaultActionParams(normalizePluginParams(paramList))
}

function getParamOptionValues(param: ActionParam): string[] {
  if (param.optionsFn) return param.optionsFn().map((option) => option.value)
  return (param.options || []).map((option) => typeof option === 'string' ? option : option.value)
}

function buildPluginInputParams(
  slots: InputSlot[],
  clipboardText?: string
): { params: ActionParam[]; inputParamKeys: Record<string, string>; inputPairParamKey?: string; inputPairSlotKeys?: string[] } {
  const paneSlots = slots.filter((slot) => slot.kind === 'pane')
  const inputParamKeys: Record<string, string> = {}
  const params: ActionParam[] = []
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

function getDefaultForType(param: ActionParam): unknown {
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
