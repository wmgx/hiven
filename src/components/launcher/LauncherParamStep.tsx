import { useEffect, useRef } from 'react'
import { Check, ChevronLeft, Search } from 'lucide-react'
import { localized } from '../../store'
import { t, type Locale } from '../../i18n'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { ParamInputFrame } from '../../workspace/launcher/controller'
import type { LauncherParamSpec } from '../../workspace/launcher/types'

type LauncherParamStepProps = {
  frame: ParamInputFrame
  error: string | null
  busy: boolean
  locale: Locale
  headerClassName?: string
  bodyClassName?: string
  footerClassName?: string
  onQueryChange: (value: string) => void
  onSelectedIndexChange: (index: number) => void
  onCommit: (value?: unknown) => void
  onBack: () => void
}

type ParamOption = {
  label: string
  value: unknown
  selected: boolean
}

function paramOptions(param: LauncherParamSpec, locale: Locale): ParamOption[] {
  if (param.type === 'boolean') {
    return [
      { label: locale === 'zh' ? '是' : 'Yes', value: true, selected: false },
      { label: locale === 'zh' ? '否' : 'No', value: false, selected: false },
    ]
  }
  return (param.options ?? []).map((option) => {
    if (typeof option === 'string') return { label: option, value: option, selected: false }
    return { label: localized(option.label, option.labelI18n, locale), value: option.value, selected: false }
  })
}

function filterParamOptions(options: ParamOption[], query: string) {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((option) => option.label.toLowerCase().includes(q) || String(option.value).toLowerCase().includes(q))
}

export function LauncherParamStep({
  frame,
  error,
  busy,
  locale,
  headerClassName = 'flex items-center px-3.5 gap-2 h-[44px]',
  bodyClassName = 'command-palette-results py-1',
  footerClassName = 'flex gap-3 px-3.5 py-1.5',
  onQueryChange,
  onSelectedIndexChange,
  onCommit,
  onBack,
}: LauncherParamStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const title = resolveDisplayTitle(frame.item.display, locale)
  const params = frame.item.params ?? []
  const param = params[frame.paramIndex]
  const label = param ? localized(param.label, param.labelI18n, locale) : ''
  const currentValue = param ? frame.params[param.key] : undefined
  const isTextParam = param?.type === 'text' || param?.type === 'number'
  const options = param ? filterParamOptions(paramOptions(param, locale).map((option) => ({
    ...option,
    selected: Array.isArray(currentValue) ? currentValue.includes(option.value) : currentValue === option.value,
  })), frame.query) : []
  const selectedIndex = Math.min(frame.selectedIndex, Math.max(0, options.length - 1))

  useEffect(() => {
    inputRef.current?.focus()
  }, [frame.paramIndex])

  function commitTextParam() {
    if (!param || busy) return
    onCommit(frame.query)
  }

  function commitOption(value: unknown) {
    if (!param || busy) return
    onCommit(value)
  }

  if (!param) return null

  return (
    <>
      <div className={headerClassName} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <button className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>{title}</span>
        <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{label}</span>
        <span className="ml-auto text-[11px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{frame.paramIndex + 1}/{params.length}</span>
      </div>
      <div className={headerClassName} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <Search size={16} style={{ color: 'var(--color-text-tertiary)' }} />
        <input
          ref={inputRef}
          className="flex-1 border-none outline-none text-sm bg-transparent"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={isTextParam ? (param.type === 'number' ? t(locale, 'palette.inputNumber') : t(locale, 'palette.inputText')) : t(locale, 'palette.filterOptions')}
          value={frame.query}
          type={param.type === 'number' ? 'number' : 'text'}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              if (isTextParam) commitTextParam()
              else if (options[selectedIndex]) commitOption(options[selectedIndex].value)
            }
            if (event.key === 'ArrowDown' && !isTextParam) {
              event.preventDefault()
              event.stopPropagation()
              onSelectedIndexChange(Math.min(selectedIndex + 1, Math.max(0, options.length - 1)))
            }
            if (event.key === 'ArrowUp' && !isTextParam) {
              event.preventDefault()
              event.stopPropagation()
              onSelectedIndexChange(Math.max(selectedIndex - 1, 0))
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onBack()
            }
          }}
          disabled={busy}
        />
      </div>
      {!isTextParam && (
        <div className={bodyClassName}>
          {options.map((option, index) => {
            const isSelected = selectedIndex === index
            return (
              <div
                key={String(option.value)}
                className={`cmd-item ${isSelected ? 'selected' : ''}`}
                style={{ background: isSelected ? 'var(--color-accent-light)' : 'transparent' }}
                onClick={() => commitOption(option.value)}
                onMouseEnter={() => onSelectedIndexChange(index)}
              >
                <div className="w-[26px] h-[26px] rounded-md flex items-center justify-center text-xs font-semibold shrink-0" style={{ background: isSelected ? 'var(--color-accent)' : 'var(--color-background-tertiary)', color: isSelected ? 'white' : 'var(--color-text-secondary)' }}>
                  {option.selected ? <Check size={14} /> : null}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate" style={{ color: isSelected ? 'var(--color-accent-hover)' : 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {option.label}
                  </div>
                </div>
                {isSelected && (
                  <kbd className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}>↵</kbd>
                )}
              </div>
            )
          })}
          {options.length === 0 && (
            <div className="px-3.5 py-4 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>{t(locale, 'palette.noOptions')}</div>
          )}
        </div>
      )}
      {error && (
        <div className="px-3.5 py-1.5 text-[11px]" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}
      <div className={footerClassName} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
        {!isTextParam && <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />}
        <HintKey keys="↵" label={t(locale, 'palette.select')} />
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
