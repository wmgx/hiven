import { useState, useEffect, useMemo, useRef } from 'react'
import { useAppStore, localized } from '../store'
import type { ActionDef, ActionParam } from '../store'
import { Search, Check, Copy, ExternalLink } from 'lucide-react'
import { t } from '../i18n'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { loadCDN, loadDeps } from '../utils/cdnLoader'
import { resolveIcon } from '../utils/resolveIcon'
import { isSafeOpenUrl, normalizeActionResult } from '../utils/actionResult'
import { openResultInMainWindow } from '../utils/globalShortcut'

// 步骤类型
type Step =
  | { type: 'search' }
  | { type: 'param'; paramIndex: number }
  | { type: 'result' }

interface CommandPaletteProps {
  variant?: 'app' | 'launcher'
}

export function CommandPalette({ variant = 'app' }: CommandPaletteProps) {
  const open = useAppStore((s) => s.commandPaletteOpen)
  const setOpen = useAppStore((s) => s.setCommandPaletteOpen)
  const actions = useAppStore((s) => s.actions)
  const disabledBuiltins = useAppStore((s) => s.settings.disabledBuiltins)
  const disabledCustoms = useAppStore((s) => s.settings.disabledCustoms)
  const editorText = useAppStore((s) => s.editorText)
  const setEditorText = useAppStore((s) => s.setEditorText)
  const commandPaletteInputOverride = useAppStore((s) => s.commandPaletteInputOverride)
  const setCommandPaletteInputOverride = useAppStore((s) => s.setCommandPaletteInputOverride)
  const setLastResult = useAppStore((s) => s.setLastResult)
  const setLastActionName = useAppStore((s) => s.setLastActionName)
  const recentActionNames = useAppStore((s) => s.recentActionNames)
  const pushRecentAction = useAppStore((s) => s.pushRecentAction)
  const locale = useAppStore((s) => s.locale)

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [step, setStep] = useState<Step>({ type: 'search' })
  const [selectedAction, setSelectedAction] = useState<ActionDef | null>(null)
  const [params, setParams] = useState<Record<string, any>>({})
  const [inputValue, setInputValue] = useState('')
  const [inputError, setInputError] = useState('')
  const [multiSelected, setMultiSelected] = useState<string[]>([])
  const [resultText, setResultText] = useState('')
  const [resultActionName, setResultActionName] = useState('')
  const [resultCopied, setResultCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const isKeyboardNav = useRef(false)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIndex(0)
      setStep({ type: 'search' })
      setSelectedAction(null)
      setParams({})
      setInputValue('')
      setInputError('')
      setMultiSelected([])
      setResultText('')
      setResultActionName('')
      setResultCopied(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  async function copyTextToClipboard(text: string) {
    if ((window as any).__TAURI_INTERNALS__) {
      await writeText(text)
      return
    }
    await navigator.clipboard?.writeText(text)
  }

  useEffect(() => {
    if (variant !== 'launcher') return
    if (open) {
      wasOpenRef.current = true
      return
    }
    if (!wasOpenRef.current || !(window as any).__TAURI_INTERNALS__) return
    wasOpenRef.current = false

    async function hideLauncher() {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().hide()
    }

    hideLauncher().catch((e) => console.error('[FluxText] Failed to hide launcher:', e))
    setCommandPaletteInputOverride(null)
  }, [open, setCommandPaletteInputOverride, variant])

  // 按最近使用排序，有搜索词则过滤
  const filtered = useMemo(() => {
    // 先去重（防止重复注册）
    const seen = new Set<string>()
    const unique = actions.filter((a) => {
      if (seen.has(a.name)) return false
      seen.add(a.name)
      return true
    })

    // 过滤掉已禁用的 action
    const enabled = unique.filter((a) => {
      if (a.builtin) return !disabledBuiltins.includes(a.name)
      return !disabledCustoms.includes(a.name)
    })

    let list = enabled
    if (query.trim()) {
      const q = query.toLowerCase()
      list = enabled.filter((a) =>
        a.name.toLowerCase().includes(q) ||
        a.title.toLowerCase().includes(q) ||
        Object.values(a.titleI18n || {}).some((v) => v && v.toLowerCase().includes(q)) ||
        (a.aliases || []).some((al) => al.toLowerCase().includes(q)) ||
        (a.tags || []).some((t) => t.toLowerCase().includes(q)) ||
        (a.description || '').toLowerCase().includes(q) ||
        Object.values(a.descriptionI18n || {}).some((v) => v && v.toLowerCase().includes(q))
      )
    }
    // 按最近使用排序
    return [...list].sort((a, b) => {
      const ai = recentActionNames.indexOf(a.name)
      const bi = recentActionNames.indexOf(b.name)
      // 用过的排前面，没用过的保持原序
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
  }, [query, actions, recentActionNames, disabledBuiltins, disabledCustoms])

  // 当前参数
  const currentParam: ActionParam | null =
    step.type === 'param' && selectedAction?.params
      ? selectedAction.params[step.paramIndex] ?? null
      : null

  // 当前参数的选项列表（单选/多选模式）
  const currentOptions = useMemo(() => {
    if (!currentParam) return []
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

  useEffect(() => {
    if (variant !== 'launcher' || !open || !(window as any).__TAURI_INTERNALS__) return

    const listRows = step.type === 'search'
      ? (filtered.length === 0 ? 1 : Math.min(filtered.length, 6))
      : (step.type === 'result' ? 0 : (isInputMode ? 0 : Math.min(currentOptions.length, 5)))
    const sourceHeight = step.type === 'search' && commandPaletteInputOverride ? 28 : 0
    const listHeight = step.type === 'search'
      ? (filtered.length === 0 ? 48 : listRows * 48 + 8)
      : (step.type === 'result' ? 178 : (isInputMode ? (inputError ? 30 : 8) : listRows * 40 + 8))
    const panelHeight = 44 + sourceHeight + listHeight + 31
    const windowHeight = Math.max(132, Math.min(388, panelHeight + 28))

    async function resizeLauncher() {
      const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
      await getCurrentWindow().setSize(new LogicalSize(680, windowHeight))
      await getCurrentWindow().center()
    }

    resizeLauncher().catch((e) => console.error('[FluxText] Failed to resize launcher:', e))
  }, [commandPaletteInputOverride, currentOptions.length, filtered.length, inputError, isInputMode, open, step.type, variant])

  async function runAction(action: ActionDef, finalParams: Record<string, any>) {
    pushRecentAction(action.name)

    // 获取 editor 实例，判断是否有选区
    const editor = useAppStore.getState().editorInstance
    let inputText = variant === 'launcher'
      ? (useAppStore.getState().commandPaletteInputOverride ?? '')
      : editorText
    let hasSelection = false
    let selection: any = null

    if (variant !== 'launcher' && editor) {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        inputText = editor.getModel()?.getValueInRange(sel) || editorText
        hasSelection = true
        selection = sel
      }
    }

    // 加载脚本声明的 @deps 依赖并注入 ctx
    let deps: Record<string, any> = {}
    try {
      deps = action.source ? await loadDeps(action.source) : {}
    } catch (e: any) {
      setLastResult(`Error: ${e.message}`)
      setLastActionName(action.name)
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

    function applyResult(resultText: string) {
      if (variant === 'launcher') {
        return
      }

      if (hasSelection && editor && selection) {
        // 只替换选区
        editor.executeEdits('action', [{
          range: selection,
          text: resultText,
        }])
        // 同步 store
        const newFullText = editor.getModel()?.getValue() || ''
        setEditorText(newFullText)
      } else {
        setEditorText(resultText)
      }
      setLastResult(resultText)
      setLastActionName(action.name)
    }

    async function handleActionResult(raw: Awaited<ReturnType<ActionDef['run']>>) {
      const normalized = normalizeActionResult(raw)
      let ok = true
      if (variant === 'launcher' && normalized.text !== undefined) {
        const shouldCopy = Boolean(useAppStore.getState().settings.autoCopyOutput || normalized.copyToClipboard)
        if (shouldCopy) {
          await copyTextToClipboard(normalized.text)
        }
        setResultText(normalized.text)
        setResultActionName(action.name)
        setResultCopied(shouldCopy)
        setStep({ type: 'result' })
      } else if (normalized.text !== undefined) {
        applyResult(normalized.text)
        const shouldCopy = useAppStore.getState().settings.autoCopyOutput || normalized.copyToClipboard
        if (shouldCopy) {
          await copyTextToClipboard(normalized.text)
        }
      }
      if (normalized.openUrl) {
        if (isSafeOpenUrl(normalized.openUrl)) {
          if ((window as any).__TAURI_INTERNALS__) {
            await openUrl(normalized.openUrl)
          } else {
            window.open(normalized.openUrl, '_blank', 'noopener,noreferrer')
          }
        } else {
          setLastResult(`Error: Unsafe URL scheme: ${normalized.openUrl}`)
          setLastActionName(action.name)
          ok = false
        }
      }
      if (normalized.notification && normalized.text === undefined) {
        setLastResult(normalized.notification)
        setLastActionName(action.name)
      }
      return ok
    }

    try {
      const result = await action.run(ctx)
      const ok = await handleActionResult(result)
      if (ok) {
        const state = useAppStore.getState()
        if (variant === 'launcher') {
          if (normalizeActionResult(result).text === undefined) {
            setOpen(false)
          }
          return
        } else if (state.launchMode === 'quick' && state.settings.hideAfterQuickAction && (window as any).__TAURI_INTERNALS__) {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          await getCurrentWindow().hide()
        }
        setOpen(false)
      }
    } catch (e: any) {
      setLastResult(`Error: ${e.message}`)
      setLastActionName(action.name)
    }
  }

  function selectAction(action: ActionDef) {
    setSelectedAction(action)
    // 初始化所有参数为默认值
    const p: Record<string, any> = {}
    for (const param of action.params || []) {
      p[param.key] = param.default ?? getDefaultForType(param)
    }
    setParams(p)

    if (!action.params || action.params.length === 0) {
      // 无参数，直接执行
      runAction(action, p)
    } else {
      // 进入第一个参数步骤
      goToParam(action, 0, p)
    }
  }

  function goToParam(action: ActionDef, index: number, currentParams: Record<string, any>) {
    const paramsList = action.params || []
    if (index >= paramsList.length) {
      // 所有参数配置完毕，执行
      runAction(action, currentParams)
      return
    }
    const param = paramsList[index]
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
      const opts = (param.options || []).map((o) => typeof o === 'string' ? o : o.value)
      const idx = opts.indexOf(currentParams[param.key])
      setSelectedIndex(idx >= 0 ? idx : 0)
    } else if (param.type === 'text' || param.type === 'textarea' || param.type === 'number') {
      setInputValue(String(currentParams[param.key] ?? ''))
    }

    setTimeout(() => {
      if (param.type === 'text' || param.type === 'textarea' || param.type === 'number') {
        inputRef.current?.focus()
      } else {
        panelRef.current?.focus()
      }
    }, 30)
  }

  function confirmCurrentParam() {
    if (!selectedAction || !currentParam) return
    const index = step.type === 'param' ? step.paramIndex : 0
    let newParams = { ...params }

    if (currentParam.type === 'boolean') {
      newParams[currentParam.key] = selectedIndex === 0
    } else if (currentParam.type === 'single-select') {
      const opts = (currentParam.options || []).map((o) => typeof o === 'string' ? o : o.value)
      newParams[currentParam.key] = opts[selectedIndex] ?? ''
    } else if (currentParam.type === 'multi-select') {
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
    goToParam(selectedAction, index + 1, newParams)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // 忽略 IME 组合输入中的按键（中文输入法回车上屏等）
    if (e.nativeEvent.isComposing || e.keyCode === 229) return

    // 搜索步骤
    if (step.type === 'search') {
      if (e.key === 'Escape') { setOpen(false); return }
      if (e.key === 'ArrowDown') { e.preventDefault(); isKeyboardNav.current = true; setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); isKeyboardNav.current = true; setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter') {
        e.preventDefault()
        const action = filtered[selectedIndex]
        if (action) selectAction(action)
      }
      return
    }

    // 参数步骤
    if (e.key === 'Escape') {
      // 返回上一步
      if (step.type === 'param' && step.paramIndex > 0) {
        goToParam(selectedAction!, step.paramIndex - 1, params)
      } else {
        setStep({ type: 'search' })
        setSelectedAction(null)
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
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, currentOptions.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
      if (e.key === ' ') {
        e.preventDefault()
        const val = currentOptions[selectedIndex]?.value
        if (val) {
          setMultiSelected((prev) =>
            prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
          )
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        confirmCurrentParam()
      }
      return
    }

    // 单选 (boolean / single-select)
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex((i) => Math.min(i + 1, currentOptions.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmCurrentParam()
    }
  }

  return (
    <div
      className={`fixed inset-0 flex items-start justify-center z-50 palette-overlay ${variant === 'launcher' ? 'launcher-palette pt-4' : 'pt-[70px]'} ${open ? 'open' : ''}`}
      style={{ pointerEvents: open ? 'auto' : 'none' }}
      onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`${variant === 'launcher' ? 'w-[calc(100vw-28px)]' : 'w-[min(630px,90vw)]'} overflow-hidden outline-none palette-panel`}
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
            filtered={filtered}
            selectedIndex={selectedIndex}
            onSelect={(action) => selectAction(action)}
            setSelectedIndex={setSelectedIndex}
            isKeyboardNav={isKeyboardNav}
            locale={locale}
            inputSource={variant === 'launcher' ? commandPaletteInputOverride : null}
          />
        )}

        {step.type === 'param' && currentParam && (
          <ParamStep
            inputRef={inputRef}
            action={selectedAction!}
            param={currentParam}
            paramIndex={step.paramIndex}
            totalParams={(selectedAction?.params || []).length}
            options={currentOptions}
            selectedIndex={selectedIndex}
            isInputMode={isInputMode}
            isMultiSelect={isMultiSelect}
            inputValue={inputValue}
            setInputValue={setInputValue}
            inputError={inputError}
            multiSelected={multiSelected}
            onToggleMulti={(val) => {
              setMultiSelected((prev) =>
                prev.includes(val) ? prev.filter((v) => v !== val) : [...prev, val]
              )
            }}
            onSelectItem={(i) => { setSelectedIndex(i); confirmCurrentParam() }}
            locale={locale}
          />
        )}

        {step.type === 'result' && (
          <LauncherResultStep
            actionName={resultActionName}
            resultText={resultText}
            copied={resultCopied}
            onCopy={async () => {
              await copyTextToClipboard(resultText)
              setResultCopied(true)
            }}
            onOpenInEditor={async () => {
              await openResultInMainWindow(resultText, resultActionName)
              setOpen(false)
            }}
            locale={locale}
          />
        )}
      </div>
    </div>
  )
}

function LauncherResultStep({
  actionName, resultText, copied, onCopy, onOpenInEditor, locale,
}: {
  actionName: string
  resultText: string
  copied: boolean
  onCopy: () => void | Promise<void>
  onOpenInEditor: () => void | Promise<void>
  locale: import('../i18n').Locale
}) {
  return (
    <>
      <div className="flex items-center px-3.5 gap-2 h-[44px]" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)' }}>{actionName}</span>
        <span className="ml-auto text-[11px]" style={{ color: copied ? 'var(--color-success-text)' : 'var(--color-text-tertiary)' }}>
          {copied ? t(locale, 'palette.copied') : t(locale, 'palette.result')}
        </span>
      </div>
      <div className="px-3.5 py-2.5">
        <pre
          className="max-h-[116px] overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 text-[12px] leading-relaxed"
          style={{
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {resultText || ' '}
        </pre>
      </div>
      <div className="flex items-center gap-2 px-3.5 py-2" style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        <button
          className="h-7 px-2 rounded flex items-center gap-1.5 cursor-pointer"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-tertiary)', fontSize: '0.8em' }}
          onClick={onCopy}
        >
          <Copy size={13} />
          {t(locale, 'palette.copy')}
        </button>
        <button
          className="h-7 px-2 rounded flex items-center gap-1.5 cursor-pointer"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)', border: '0.5px solid var(--color-border-tertiary)', fontSize: '0.8em' }}
          onClick={onOpenInEditor}
        >
          <ExternalLink size={13} />
          {t(locale, 'palette.openInEditor')}
        </button>
        <span className="ml-auto text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>esc {t(locale, 'palette.close')}</span>
      </div>
    </>
  )
}

// 搜索步骤
function SearchStep({
  inputRef, query, setQuery, filtered, selectedIndex, onSelect, setSelectedIndex, isKeyboardNav, locale, inputSource,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  query: string
  setQuery: (v: string) => void
  filtered: ActionDef[]
  selectedIndex: number
  onSelect: (action: ActionDef) => void
  setSelectedIndex: (i: number) => void
  isKeyboardNav: React.MutableRefObject<boolean>
  locale: import('../i18n').Locale
  inputSource: string | null
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
      {inputSource && (
        <div className="h-7 flex items-center gap-2 px-3.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-tertiary)' }}>
          <span className="text-[10px] uppercase tracking-wide">{t(locale, 'palette.inputSource')}</span>
          <span className="min-w-0 truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            {inputSource.replace(/\s+/g, ' ').trim()}
          </span>
        </div>
      )}
      <div className="max-h-[300px] overflow-y-auto py-1" onMouseMove={() => { isKeyboardNav.current = false }}>
        {filtered.map((action, i) => (
          <ActionItem key={`${action.name}-${i}`} action={action} selected={selectedIndex === i} onClick={() => onSelect(action)} onMouseEnter={() => { if (!isKeyboardNav.current) setSelectedIndex(i) }} />
        ))}
        {filtered.length === 0 && (
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
  inputRef, action, param, paramIndex, totalParams,
  options, selectedIndex, isInputMode, isMultiSelect,
  inputValue, setInputValue, inputError,
  multiSelected, onToggleMulti, onSelectItem, locale,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>
  action: ActionDef
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
  locale: import('../i18n').Locale
}) {
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
        <span className="ml-auto text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{action.name}</span>
      </div>

      {/* 输入错误/提示 */}
      {isInputMode && (inputError || param.type === 'number') && (
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
        </div>
      )}

      {/* 多选列表 */}
      {isMultiSelect && (
        <div className="max-h-[240px] overflow-y-auto py-1">
          {options.map((opt, i) => {
            const checked = multiSelected.includes(opt.value)
            return (
              <div
                key={opt.value}
                className="flex items-center px-3.5 py-2 cursor-pointer gap-2.5"
                style={{ background: selectedIndex === i ? 'var(--color-accent-light)' : 'transparent' }}
                onClick={() => onToggleMulti(opt.value)}
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
      </div>
    </>
  )
}

function ActionItem({ action, selected, onClick, onMouseEnter }: { action: ActionDef; selected: boolean; onClick: () => void; onMouseEnter: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [selected])

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
        {resolveIcon(action.icon, 14, action.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium" style={{ color: selected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
          {action.name}
        </div>
        <div className="text-[11px]" style={{ color: selected ? 'var(--color-accent)' : 'var(--color-text-tertiary)', marginTop: 1 }}>
          {action.titleI18n?.zh || action.title}
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

function getDefaultForType(param: ActionParam): any {
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
