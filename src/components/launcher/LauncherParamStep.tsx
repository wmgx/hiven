import { useEffect, useRef } from 'react'
import { ChevronLeft, Search } from 'lucide-react'
import { localized } from '../../store'
import { t, type Locale } from '../../i18n'
import type { ParamInputFrame } from '../../workspace/launcher/controller'
import type { LauncherParamSpec } from '../../workspace/launcher/types'
import { searchableFieldsMatch, type SearchableFields } from '../../workspace/searchRanking'

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
  labelI18n?: Partial<Record<Locale, string>>
  value: unknown
}

function paramOptions(param: LauncherParamSpec, locale: Locale): ParamOption[] {
  if (param.type === 'boolean') {
    return [
      { label: t(locale, 'palette.boolYes'), value: true },
      { label: t(locale, 'palette.boolNo'), value: false },
    ]
  }
  return (param.options ?? []).map((option) => {
    if (typeof option === 'string') return { label: option, value: option }
    return { label: localized(option.label, option.labelI18n, locale), labelI18n: option.labelI18n, value: option.value }
  })
}

/** Resolve a committed param value back to a short display label. */
export function resolveParamValueLabel(param: LauncherParamSpec, value: unknown, locale: Locale): string {
  if (value === undefined || value === null) return '—'
  if (param.type === 'boolean') return value ? t(locale, 'palette.boolYes') : t(locale, 'palette.boolNo')
  const options = paramOptions(param, locale)
  const match = options.find((o) => o.value === value)
  if (match) return match.label
  const str = String(value)
  return str.length > 12 ? `${str.slice(0, 11)}…` : str
}

function paramOptionSearchFields(option: ParamOption): SearchableFields {
  const value = String(option.value)
  return {
    id: value,
    title: option.label,
    titleI18n: option.labelI18n,
    aliases: value === option.label ? undefined : [value],
  }
}

function filterParamOptions(options: ParamOption[], query: string, locale: Locale) {
  const q = query.trim().toLowerCase()
  if (!q) return options
  return options.filter((option) => searchableFieldsMatch(paramOptionSearchFields(option), q, locale))
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
  const params = frame.item.params ?? []
  const param = params[frame.paramIndex]
  const label = param ? localized(param.label, param.labelI18n, locale) : ''
  const isTextParam = param?.type === 'text' || param?.type === 'number'
  const options = param ? filterParamOptions(paramOptions(param, locale), frame.query, locale) : []
  const selectedIndex = Math.min(frame.selectedIndex, Math.max(0, options.length - 1))

  useEffect(() => {
    // Focus input when entering a new param step or when param index advances
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [frame.paramIndex])

  function commitTextParam() {
    if (!param || busy) return
    onCommit(frame.query)
  }

  function commitOption(value: unknown) {
    if (!param || busy) return
    onCommit(value)
  }

  // Build breadcrumb chips for previously committed params
  const breadcrumbChips: { label: string; value: string }[] = []
  for (let i = 0; i < frame.paramIndex; i++) {
    const p = params[i]
    if (!p) break
    const val = frame.params[p.key]
    breadcrumbChips.push({ label: localized(p.label, p.labelI18n, locale), value: resolveParamValueLabel(p, val, locale) })
  }

  if (!param) return null
  const placeholder = isTextParam
    ? `${label} · ${param.type === 'number' ? t(locale, 'palette.inputNumber') : t(locale, 'palette.inputText')}`
    : `${label} · ${t(locale, 'palette.filterOptions')}`

  return (
    <>
      <div className={headerClassName} style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <button className="w-6 h-6 rounded-md border-none bg-transparent cursor-pointer flex items-center justify-center shrink-0" style={{ color: 'var(--color-text-secondary)' }} onClick={onBack}>
          <ChevronLeft size={16} />
        </button>
        {breadcrumbChips.map((chip, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded shrink-0 max-w-[100px] truncate"
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
        {!isTextParam && <Search size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />}
        <input
          ref={inputRef}
          className="flex-1 min-w-0 border-none outline-none text-sm bg-transparent"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={placeholder}
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
            if (event.key === 'Backspace' && frame.query === '') {
              event.preventDefault()
              event.stopPropagation()
              onBack()
            }
          }}
          disabled={busy}
        />
        <span className="text-[11px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{frame.paramIndex + 1}/{params.length}</span>
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
