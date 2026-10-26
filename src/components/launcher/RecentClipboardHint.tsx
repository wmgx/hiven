import { Clipboard, X } from 'lucide-react'
import { t, translate, type Locale } from '../../i18n'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import type { RecentClipboardHint as HintType } from '../../launcher/clipboard/objectBlock'
import { createClipboardObjectBlock } from '../../launcher/clipboard/objectBlock'
import { getAttachedTextFilePath } from '../../launcher/clipboard/fileTextMaterial'

export function RecentClipboardHint({ hint, selected, locale, onActivate, onDismiss, onSelect }: {
  hint: HintType
  selected?: boolean
  locale: Locale
  onActivate: () => void
  onDismiss: () => void
  onSelect: () => void
}) {
  const file = getAttachedTextFilePath(createClipboardObjectBlock(hint.snapshot))
  const preview = hint.masked ? t(locale, 'palette.objectBlockMasked')
    : hint.answer ? resolveDisplayTitle(hint.answer.display, locale)
      : (hint.snapshot.files?.join(', ') ?? hint.snapshot.text).slice(0, 30).replace(/[\r\n]/g, ' ')
  return (
    <div className={`recent-clipboard-hint${selected ? ' is-selected' : ''}`}
      data-testid="recent-clipboard-hint" data-selected={selected ? 'true' : undefined}
      role="option" aria-selected={Boolean(selected)} onMouseMove={onSelect}>
      {hint.snapshot.image && !hint.masked
        ? <img className="hint-icon" src={hint.snapshot.image.dataUrl} alt={translate(locale, 'objectBlock', 'kind.image')} />
        : <Clipboard className="hint-icon" size={18} aria-hidden />}
      <button type="button" className="hint-body" onMouseDown={event => event.preventDefault()}
        onClick={onActivate} onKeyDown={event => event.stopPropagation()}>
        <span className="hint-subtitle">{t(locale, 'palette.recentClipboardHintSubtitle', {
          kind: translate(locale, 'objectBlock', `kind.${hint.kind}`),
        })}</span>
        <span className="hint-title">{preview}</span>
      </button>
      <span className="hint-enter">{hint.answer ? t(locale, 'palette.clipboardHintAnswerKeys')
        : t(locale, file ? 'palette.clipboardHintReadFile' : 'palette.clipboardHintUse')}</span>
      <button type="button" className="object-block-remove" aria-label={t(locale, 'palette.clipboardHintDismiss')}
        onMouseDown={event => event.preventDefault()} onKeyDown={event => event.stopPropagation()}
        onClick={onDismiss}><X size={14} aria-hidden /></button>
    </div>
  )
}
