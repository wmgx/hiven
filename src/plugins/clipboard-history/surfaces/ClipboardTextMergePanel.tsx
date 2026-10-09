import { IconButton, SegmentedControl, SurfaceEmptyState, ToolbarButton } from '@hiven/plugin-ui'
import { CloseIcon } from '@hiven/plugin-ui/icons'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { ClipboardHistoryItem } from '../storage/clipboardHistoryTypes'
import {
  CLIPBOARD_TEXT_MERGE_MAX_ITEMS,
  CLIPBOARD_TEXT_MERGE_MIN_ITEMS,
  type ClipboardTextMergeError,
  type ClipboardTextMergePreview,
  type ClipboardTextMergeSeparator,
} from '../merge/clipboardTextMerge'

type ClipboardTextMergePanelProps = {
  ids: readonly string[]
  items: ReadonlyMap<string, ClipboardHistoryItem>
  separator: ClipboardTextMergeSeparator
  preview: ClipboardTextMergePreview | null
  error: ClipboardTextMergeError | null
  loading: boolean
  t: (key: string, vars?: Record<string, string | number>) => string
  onMove: (id: string, direction: -1 | 1) => void
  onRemove: (id: string) => void
  onSeparatorChange: (separator: ClipboardTextMergeSeparator) => void
  onRetry: () => void
}

export function ClipboardTextMergePanel({
  ids, items, separator, preview, error, loading, t,
  onMove, onRemove, onSeparatorChange, onRetry,
}: ClipboardTextMergePanelProps) {
  return (
    <section className="clipboard-history-merge-panel" aria-label={t('merge.preview')}>
      <div className="clipboard-history-merge-selection">
        <div className="clipboard-history-merge-section-heading">
          <h3>{t('merge.selectedTitle')}</h3>
          <span aria-live="polite">{t('merge.selectionCount', { count: ids.length, max: CLIPBOARD_TEXT_MERGE_MAX_ITEMS })}</span>
        </div>
        {ids.length === 0 ? (
          <p className="clipboard-history-merge-help">{t('merge.emptySelection')}</p>
        ) : (
          <ol className="clipboard-history-merge-order" aria-label={t('merge.selectedTitle')} data-launcher-scrollable>
            {ids.map((id, index) => {
              const item = items.get(id)
              const title = item?.favoriteTitle || (item?.kind === 'text' ? item.preview : '') || t('merge.emptyText')
              const failed = error?.id === id
              return (
                <li key={id} className={failed ? 'has-error' : undefined}>
                  <span className="clipboard-history-merge-position" aria-hidden="true">{index + 1}</span>
                  <span className="clipboard-history-merge-source" title={title}>{title}</span>
                  {failed && <span className="clipboard-history-merge-item-error">{t('merge.unavailable')}</span>}
                  <div className="clipboard-history-merge-order-actions">
                    <IconButton type="button" label={t('merge.moveUp', { position: index + 1 })} disabled={index === 0} onClick={() => onMove(id, -1)}>
                      <ArrowUp size={13} />
                    </IconButton>
                    <IconButton type="button" label={t('merge.moveDown', { position: index + 1 })} disabled={index === ids.length - 1} onClick={() => onMove(id, 1)}>
                      <ArrowDown size={13} />
                    </IconButton>
                    <IconButton type="button" label={t('merge.remove', { position: index + 1 })} onClick={() => onRemove(id)}>
                      <CloseIcon size={13} />
                    </IconButton>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </div>
      <div className="clipboard-history-merge-separator">
        <span>{t('merge.separator')}</span>
        <SegmentedControl
          value={separator}
          onChange={(value) => onSeparatorChange(value as ClipboardTextMergeSeparator)}
          aria-label={t('merge.separator')}
          options={[
            { value: 'newline', label: t('merge.newline') },
            { value: 'blankline', label: t('merge.blankline') },
          ]}
        />
      </div>
      <div className="clipboard-history-merge-preview" aria-busy={loading} data-launcher-scrollable>
        <div className="clipboard-history-merge-section-heading">
          <h3>{t('merge.preview')}</h3>
          {preview && <span>{t('merge.characters', { count: preview.text.length })}</span>}
        </div>
        {error ? (
          <div className="clipboard-history-merge-error" role="alert">
            <p>{t('merge.readFailed')}</p>
            <ToolbarButton type="button" onClick={onRetry}>{t('merge.retry')}</ToolbarButton>
          </div>
        ) : loading ? (
          <SurfaceEmptyState role="status">{t('merge.loading')}</SurfaceEmptyState>
        ) : preview ? (
          <pre className="clipboard-history-preview-text" tabIndex={0} data-launcher-scrollable>{preview.text}</pre>
        ) : (
          <SurfaceEmptyState>{t('merge.minimum', { min: CLIPBOARD_TEXT_MERGE_MIN_ITEMS })}</SurfaceEmptyState>
        )}
      </div>
    </section>
  )
}
