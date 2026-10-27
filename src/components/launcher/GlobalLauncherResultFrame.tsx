import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { LauncherControllerState, ResultFrame } from '../../workspace/launcher/controller'
import type { LauncherResultChoice } from '../../workspace/launcher/types'
import { LauncherHintKey, LauncherHintText } from './LauncherFooterHints'
import { LauncherResultChoiceRow } from './LauncherResultChoiceRow'
import { LauncherCommandTag } from './LauncherCommandTag'
import { getHostOutputIntent } from '../../workspace/launcher/output'
import { shouldIgnoreImeKeyDown } from '../../utils/imeKeyboard'
import { LauncherCommandFooter, useForegroundAppName, type LauncherCommandMenuAction } from './LauncherCommandFooter'

function isSingleTextResult(choices: LauncherResultChoice[]): boolean {
  if (choices.length !== 1) return false
  const choice = choices[0]
  const text = (choice.preview ?? choice.title ?? '').trim()
  if (!text) return false
  // Confirm dialogs use tone danger/muted — keep list UI.
  if (choice.tone === 'danger' || choice.tone === 'muted') return false
  return getHostOutputIntent(choice) === 'copy' || getHostOutputIntent(choice) === 'return-to-launcher'
}

export function GlobalLauncherResultFrame({
  frame,
  busy = false,
  deliveryIntent,
  error,
  locale,
  selectedIndex,
  selectedChoiceIds,
  onBack,
  onHoverChoice,
  onToggleChoice,
  onSecondaryAction,
  onPastePreviewText,
  onCopyAll,
}: {
  frame: ResultFrame
  busy?: boolean
  deliveryIntent?: LauncherControllerState['deliveryIntent']
  error?: string | null
  locale: Locale
  selectedIndex: number
  selectedChoiceIds: Set<string>
  onBack: () => void
  onHoverChoice: (index: number) => void
  onToggleChoice: (choice: LauncherResultChoice, frame: ResultFrame) => void
  onSecondaryAction?: (choice: LauncherResultChoice, actionId: string) => void
  onPastePreviewText?: (choice: LauncherResultChoice) => void | Promise<void>
  onCopyAll?: () => void
}) {
  const app = useForegroundAppName()
  const choices = frame.output.choices
  const selection = frame.output.selection
  const clampedSelectedIndex = Math.min(selectedIndex, Math.max(0, choices.length - 1))
  const selectedCount = selectedChoiceIds.size
  const countLabel = selection?.type === 'multi'
    ? t(locale, 'palette.selectedCountMax', { count: selectedCount, max: selection.max })
    : null

  const isConfirmDialog = choices.length <= 3 && choices.some((c) => c.tone === 'danger' || c.tone === 'muted')
  const singleText = selection?.type !== 'multi' && (frame.retryOnly || isSingleTextResult(choices))
  const canCopyAll = Boolean(onCopyAll) && !frame.retryOnly && selection?.type !== 'multi' && choices.length > 1 &&
    choices.every((choice) => getHostOutputIntent(choice) === 'copy')
  const textChoice = singleText ? choices[0] : undefined
  const retryCopyAction = frame.retryOnly
    ? textChoice?.secondaryActions?.find((action) => getHostOutputIntent(action) === 'copy')
    : undefined
  const previewText = textChoice ? (textChoice.preview ?? textChoice.title ?? '').trim() : ''
  const primaryIsReturn = textChoice ? getHostOutputIntent(textChoice) === 'return-to-launcher' : false
  const returnAction = textChoice?.secondaryActions?.find((action) => getHostOutputIntent(action) === 'return-to-launcher' || action.id === 'return-to-launcher')
  const canPaste = !frame.retryOnly && !primaryIsReturn && Boolean(onPastePreviewText)

  if (singleText && textChoice) {
    const runPrimary = () => { if (!busy) onToggleChoice(textChoice, frame) }
    const paste = () => { if (!busy && canPaste) void onPastePreviewText?.(textChoice) }
    const menu: LauncherCommandMenuAction[] = frame.retryOnly ? [] : [
      ...(returnAction ? [{ id: 'continue', label: t(locale, 'outputActions.continue'), run: () => onSecondaryAction?.(textChoice, returnAction.id) }] : []),
      ...(previewText ? [{ id: 'open-editor', label: t(locale, 'outputActions.openEditor'), run: async () => {
        const { overwriteQuickEditorText } = await import('../../workspace/quickEditor/quickEditorRequests')
        await overwriteQuickEditorText(previewText, { source: 'tool-result' })
      } }] : []),
    ]
    return (
      <div
        className="launcher-result-text-frame"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (shouldIgnoreImeKeyDown(event, { current: false })) return
          if (event.key !== 'Enter') return
          event.preventDefault()
          event.stopPropagation()
          if (busy || event.altKey) return
          if (frame.retryOnly) {
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) runPrimary()
            return
          }
          // ↵ and ⌘↵ run the primary action; ⇧↵ pastes into the previous app.
          if (event.shiftKey) paste()
          else runPrimary()
        }}
      >
        <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
          <LauncherCommandTag
            title={frame.sourceTitle || textChoice.title}
            locale={locale}
            onRemove={onBack}
          />
        </div>
        <div
          className="launcher-preview-well"
          data-testid="launcher-result-preview-well"
          data-no-drag
          data-launcher-scrollable
          aria-live="polite"
          onMouseDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <pre
            tabIndex={0}
            aria-label={t(locale, 'palette.preview')}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
                event.preventDefault()
                event.stopPropagation()
                const range = document.createRange()
                const sel = window.getSelection()
                const node = event.currentTarget.querySelector('.launcher-preview-text')
                if (node && sel) {
                  range.selectNodeContents(node)
                  sel.removeAllRanges()
                  sel.addRange(range)
                }
              }
            }}
          >
            <span className="launcher-preview-text">{previewText}</span>
          </pre>
        </div>
        {busy && <span role="status" aria-live="polite">{t(locale, deliveryIntent === 'copy' ? 'palette.outputCopying' : 'palette.outputDelivering')}</span>}
        {error && (
          <div role="alert" className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
            {error}
          </div>
        )}
        {frame.retryOnly ? (
          <div className="global-launcher-footer l-foot launcher-output-actionbar">
            <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
            {retryCopyAction && (
              <button
                type="button"
                className="l-foot-action"
                disabled={busy}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onSecondaryAction?.(textChoice, retryCopyAction.id)}
              >
                {t(locale, 'palette.copy')}
              </button>
            )}
            <button
              type="button"
              className="l-foot-primary"
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.stopPropagation()
                if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) event.preventDefault()
              }}
              onClick={runPrimary}
            >
              <LauncherHintKey keys="↵" label={t(locale, 'palette.outputRetry')} />
            </button>
          </div>
        ) : (
          <LauncherCommandFooter
            locale={locale}
            busy={busy}
            primaryLabel={primaryIsReturn ? t(locale, 'outputActions.continue') : t(locale, 'outputActions.copy')}
            onPrimary={runPrimary}
            pasteApp={app}
            onPaste={canPaste ? paste : undefined}
            menu={menu}
            onBack={onBack}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <LauncherCommandTag
          title={frame.sourceTitle || t(locale, 'palette.confirm')}
          locale={locale}
          onRemove={onBack}
        />
      </div>
      <div className={`global-launcher-body l-results ${isConfirmDialog ? 'l-results-confirm' : ''}`}>
        {choices.map((choice, index) => {
          const checked = selectedChoiceIds.has(choice.id)
          const disabled = busy || (selection?.type === 'multi' && selectedCount >= selection.max && !checked)
          return (
            <LauncherResultChoiceRow
              key={choice.id}
              choice={choice}
              index={index}
              selected={index === clampedSelectedIndex}
              checked={checked}
              disabled={disabled}
              multi={selection?.type === 'multi'}
              locale={locale}
              onHover={() => onHoverChoice(index)}
              onSelect={() => onToggleChoice(choice, frame)}
            />
          )
        })}
      </div>
      {busy && <span role="status" aria-live="polite">{t(locale, deliveryIntent === 'copy' ? 'palette.outputCopying' : 'palette.outputDelivering')}</span>}
      {error && (
        <div role="alert" className="px-3.5 py-2 text-[12px]" style={{ color: 'var(--color-error)' }}>
          {error}
        </div>
      )}
      <div className="global-launcher-footer l-foot">
        {countLabel && <LauncherHintText label={countLabel} />}
        <LauncherHintKey keys="↑↓" label={t(locale, 'palette.navigate')} />
        {selection?.type === 'multi'
          ? <LauncherHintKey keys="␣" label={t(locale, 'palette.select')} />
          : <LauncherHintKey keys="↵" label={t(locale, 'palette.confirm')} />
        }
        {canCopyAll && (
          <button type="button" className="launcher-footer-back-btn" data-no-drag disabled={busy}
            onMouseDown={(event) => event.preventDefault()} onClick={onCopyAll}>
            <LauncherHintKey keys="⌘↵" label={t(locale, 'palette.copyAll')} />
          </button>
        )}
        <LauncherHintKey keys="esc" label={t(locale, 'palette.back')} />
      </div>
    </>
  )
}
