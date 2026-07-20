/**
 * ObjectBlockToken — Visual token in the launcher input bar representing
 * the attached clipboard/editor-selection object.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §2.4 / §10
 *
 * UI:
 *   [ 剪贴板 · JSON · 12 秒前  × ]
 *   When selectedForDelete: brand-blue border + delete hint
 *   When secretMasked: masked label
 */

import { X } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import { useAppStore } from '../../store'
import type { LauncherObjectBlock } from '../../launcher/clipboard/objectBlock'

function truncatePreview(text: string, maxLen: number): string {
  const singleLine = text.replace(/[\r\n]+/g, ' ').trim()
  if (singleLine.length <= maxLen) return singleLine
  return singleLine.slice(0, maxLen) + '…'
}

export function ObjectBlockToken({
  block,
  onRemove,
  locale: localeProp,
}: {
  block: LauncherObjectBlock
  onRemove: () => void
  locale?: Locale
}) {
  const storeLocale = useAppStore((s) => s.locale)
  const locale = localeProp ?? storeLocale
  const selected = block.selectedForDelete
  return (
    <span
      className={`object-block-token${selected ? ' selected-for-delete' : ''}`}
      data-testid="object-block-token"
      data-source={block.source}
      data-kind={block.kind}
      data-selected={selected ? 'true' : undefined}
      data-state={selected ? 'selected-for-deletion' : block.state}
    >
      {!block.secretMasked && block.preview ? (
        <span className="object-block-content">{truncatePreview(block.preview, 30)}</span>
      ) : block.secretMasked ? (
        <span className="object-block-masked">{t(locale, 'palette.objectBlockMasked')}</span>
      ) : (
        <span className="object-block-content">{block.title}</span>
      )}
      {block.state === 'snapshot' && (
        <span className="object-block-badge">{t(locale, 'palette.objectBlockSnapshot')}</span>
      )}
      {block.validity === 'invalid' && (
        <span className="object-block-badge">{t(locale, 'palette.objectBlockInvalid')}</span>
      )}
      {selected && (
        <span className="object-block-delete-hint">{t(locale, 'palette.objectBlockDeleteHint')}</span>
      )}
      <button
        type="button"
        className="object-block-remove"
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label={t(locale, 'palette.objectBlockRemove')}
      >
        <X size={12} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </span>
  )
}
