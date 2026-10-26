import { X } from 'lucide-react'
import { t, translate, type Locale } from '../../i18n'
import { useAppStore } from '../../store'
import type { LauncherObjectBlock } from '../../launcher/clipboard/objectBlock'

export function ObjectBlockToken({ block, onRemove, locale: localeProp, exiting = false }: {
  block: LauncherObjectBlock
  onRemove: () => void
  locale?: Locale
  exiting?: boolean
}) {
  const storeLocale = useAppStore((s) => s.locale)
  const locale = localeProp ?? storeLocale
  const image = block.payloadImage
  const size = image?.width && image.height ? `${image.width}×${image.height}`
    : block.payloadFiles ? translate(locale, 'objectBlock', 'detail.fileCount', { n: block.payloadFiles.paths.length })
      : translate(locale, 'objectBlock', 'detail.chars', { n: block.payloadText?.length ?? block.meta?.charCount ?? 0 })
  return (
    <span
      className={`object-block-token${exiting ? ' is-exiting' : ''}`}
      data-testid="object-block-token"
      data-source={block.source}
      data-kind={block.kind}
      data-exiting={exiting ? 'true' : undefined}
      aria-hidden={exiting ? true : undefined}
    >
      <span className="object-block-content">
        {block.secretMasked ? t(locale, 'palette.objectBlockMasked')
          : `${translate(locale, 'objectBlock', `kind.${block.kind}`)} · ${size}`}
      </span>
      <button type="button" className="object-block-remove"
        onMouseDown={event => event.preventDefault()}
        onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); onRemove() }}
        aria-label={t(locale, 'palette.objectBlockRemove')}>
        <X size={12} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </span>
  )
}
