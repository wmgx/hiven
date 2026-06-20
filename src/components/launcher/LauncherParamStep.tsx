import { useEffect, useRef } from 'react'
import { localized } from '../../store'
import { t, type Locale } from '../../i18n'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../../utils/imeKeyboard'
import type { ParamInputFrame } from '../../workspace/launcher/controller'
import type { LauncherParamSpec } from '../../workspace/launcher/types'
import { searchableFieldsMatch, type SearchableFields } from '../../workspace/searchRanking'
import { resolveDisplayTitle } from '../../workspace/launcher/display'

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
  onMultiToggle: (value: unknown) => void
  onBack: () => void
}

type ParamOption = {
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
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
    return {
      label: localized(option.label, option.labelI18n, locale),
      labelI18n: option.labelI18n,
      description: localized(option.description ?? '', option.descriptionI18n, locale),
      descriptionI18n: option.descriptionI18n,
      value: option.value,
    }
  })
}

/** Resolve a committed param value back to a short display label. */
export function resolveParamValueLabel(param: LauncherParamSpec, value: unknown, locale: Locale): string {
  if (value === undefined || value === null) return '-'
  if (param.type === 'boolean') return value ? t(locale, 'palette.boolYes') : t(locale, 'palette.boolNo')
  if (param.type === 'multi-select' && Array.isArray(value)) {
    const labels = value.map((item) => resolveSingleParamValueLabel(param, item, locale))
    return labels.length > 2 ? `${labels.slice(0, 2).join(', ')} +${labels.length - 2}` : labels.join(', ')
  }
  return resolveSingleParamValueLabel(param, value, locale)
}

function resolveSingleParamValueLabel(param: LauncherParamSpec, value: unknown, locale: Locale): string {
  const options = paramOptions(param, locale)
  const match = options.find((option) => String(option.value) === String(value))
  if (match) return match.label
  const str = String(value)
  return str.length > 12 ? `${str.slice(0, 11)}…` : str
}

function paramOptionSearchFields(option: ParamOption): SearchableFields {
  const value = String(option.value)
  return {
    id: value,
    title: option.label,
    description: option.description,
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
  headerClassName = 'global-launcher-header l-search',
  bodyClassName = 'global-launcher-body l-list opt',
  footerClassName = 'global-launcher-footer l-foot',
  onQueryChange,
  onSelectedIndexChange,
  onCommit,
  onMultiToggle,
  onBack,
}: LauncherParamStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isImeComposingRef = useRef(false)
  const params = frame.item.params ?? []
  const param = params[frame.paramIndex]
  const label = param ? localized(param.label, param.labelI18n, locale) : ''
  const isTextParam = param?.type === 'text' || param?.type === 'number'
  const isMultiParam = param?.type === 'multi-select'
  const options = param ? filterParamOptions(paramOptions(param, locale), frame.query, locale) : []
  const selectedIndex = Math.min(frame.selectedIndex, Math.max(0, options.length - 1))
  const currentMultiValue = param && isMultiParam && Array.isArray(frame.params[param.key])
    ? frame.params[param.key].map(String)
    : []
  const maxSelect = isMultiParam ? (param.maxSelect ?? options.length) : 1
  const selectedCount = currentMultiValue.length
  const reachedMax = isMultiParam && selectedCount >= maxSelect

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [frame.paramIndex])

  function commitTextParam() {
    if (!param || busy) return
    onCommit(frame.query)
  }

  function commitOption(value: unknown) {
    if (!param || busy) return
    if (isMultiParam) {
      onMultiToggle(value)
      return
    }
    onCommit(value)
  }

  function submitMultiParam() {
    if (!param || !isMultiParam || busy) return
    onCommit()
  }

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

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
  const countLabel = isMultiParam
    ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: maxSelect })
    : `${frame.paramIndex + 1}/${params.length}`

  return (
    <>
      <div className={headerClassName} style={{ borderBottom: '1px solid var(--border)' }}>
        <button className="back" type="button" onClick={onBack}>‹</button>
        <span className="title">
          {resolveDisplayTitle(frame.item.display, locale)}
          {breadcrumbChips.length > 0 && (
            <span className="t-sub">{breadcrumbChips.map((chip) => chip.value).join(' / ')}</span>
          )}
        </span>
        <span className="vbar" />
        <input
          ref={inputRef}
          className={isTextParam ? 'mono' : ''}
          placeholder={placeholder}
          value={frame.query}
          type={param.type === 'number' ? 'number' : 'text'}
          onChange={(event) => onQueryChange(event.target.value)}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && frame.query === '') {
              if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
              event.preventDefault()
              event.stopPropagation()
              onBack()
              return
            }
            if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              if (isTextParam) commitTextParam()
              else if (isMultiParam) submitMultiParam()
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
        <span className="meta">{countLabel}</span>
      </div>
      {!isTextParam && (
        <div className={bodyClassName}>
          {options.map((option, index) => {
            const optionKey = String(option.value)
            const isChecked = currentMultiValue.includes(optionKey)
            const isSelected = selectedIndex === index
            const disabled = isMultiParam && reachedMax && !isChecked
            return (
              <button
                key={optionKey}
                className={`l-option-row ${isSelected ? 'sel selected' : ''} ${disabled ? 'disabled' : ''}`}
                onClick={() => { if (!disabled) commitOption(option.value) }}
                onMouseEnter={() => onSelectedIndexChange(index)}
                disabled={disabled}
              >
                {isMultiParam && <span className={`check ${isChecked ? 'on' : ''}`}>{isChecked ? '✓' : ''}</span>}
                <span className="opt-main">
                  <span className="opt-title">{option.label}</span>
                  {option.description && <span className="opt-desc">{option.description}</span>}
                </span>
                {!isMultiParam && isSelected && <span className="r-kbd">↵</span>}
              </button>
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
      <div className={footerClassName} style={{ borderTop: '1px solid var(--border)' }}>
        {!isTextParam && <HintKey keys="↑↓" label={t(locale, 'palette.navigate')} />}
        <HintKey keys="↵" label={isMultiParam ? t(locale, 'palette.submit') : t(locale, 'palette.select')} />
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
