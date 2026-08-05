import { useEffect, useRef } from 'react'
import type { Locale } from '../../i18n'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { resolveIcon } from '../../utils/resolveIcon'

export function LauncherResultChoiceRow({
  choice,
  index,
  selected,
  checked = false,
  disabled = false,
  multi = false,
  locale = 'en',
  onHover,
  onSelect,
}: {
  choice: LauncherResultChoice
  index: number
  selected: boolean
  checked?: boolean
  disabled?: boolean
  multi?: boolean
  locale?: Locale
  onHover?: () => void
  onSelect: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const title = resolveChoiceTitle(choice, locale)
  const subtitle = resolveChoiceSubtitle(choice, locale)
  const bodyText = choice.preview ?? title
  const longResult = isLongResultText(bodyText)
  const tone = choice.tone ?? 'default'
  const className = [
    'global-launcher-result-row',
    'l-result',
    longResult ? 'l-result-block' : '',
    selected ? 'sel is-selected' : '',
    disabled ? 'disabled' : '',
    tone === 'danger' ? 'l-result-danger' : '',
    tone === 'muted' ? 'l-result-muted' : '',
  ].filter(Boolean).join(' ')

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      className={className}
      onMouseEnter={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      disabled={disabled}
    >
      {multi ? (
        <span className={`check ${checked ? 'on' : ''}`} aria-hidden>{checked ? '✓' : ''}</span>
      ) : choice.icon ? (
        <span className="r-ico r-favicon" aria-hidden>
          {resolveIcon(choice.icon, 18, title)}
        </span>
      ) : (
        <span className={`ri ri-tone-${tone}`} aria-hidden>
          {tone === 'danger' ? '!' : tone === 'muted' ? '×' : index + 1}
        </span>
      )}

      {longResult ? (
        <span className="block-main">{bodyText}</span>
      ) : (
        <div className="r-main">
          <span className="r-title">{title}</span>
          {subtitle ? (
            <span className="r-desc" title={subtitle}>{subtitle}</span>
          ) : null}
        </div>
      )}

      {selected && !multi ? <span className="r-kbd">↵</span> : null}
    </button>
  )
}

function resolveChoiceTitle(choice: LauncherResultChoice, locale: Locale): string {
  return choice.titleI18n?.[locale] ?? choice.titleI18n?.en ?? choice.title
}

function resolveChoiceSubtitle(choice: LauncherResultChoice, locale: Locale): string | undefined {
  return choice.subtitleI18n?.[locale] ?? choice.subtitleI18n?.en ?? choice.subtitle
}

function isLongResultText(text: string): boolean {
  return text.includes('\n') || text.length > 88
}
