import { useEffect, useRef } from 'react'
import { ChevronLeft } from 'lucide-react'
import { localized } from '../../store'
import { t, type Locale } from '../../i18n'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { CollectInputFrame } from '../../workspace/launcher/controller'
import { resolveParamValueLabel } from '../../components/launcher/LauncherParamStep'
import { HintKey, LauncherFooter } from './LauncherFooter'

export function CollectInputStep({ frame, error, busy, onInputChange, onSubmit, onBack, locale }: {
  frame: CollectInputFrame
  error: string | null
  busy: boolean
  onInputChange: (text: string) => void
  onSubmit: () => void
  onBack: () => void
  locale: Locale
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
      <LauncherFooter>
        <HintKey keys="↵" label={t(locale, 'palette.submit')} />
        <HintKey keys="esc" label={t(locale, 'palette.back')} />
      </LauncherFooter>
    </>
  )
}
