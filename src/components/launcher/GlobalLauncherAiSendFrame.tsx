import { useEffect, useRef, type KeyboardEvent } from 'react'
import type { Locale } from '../../i18n'
import { t } from '../../i18n'
import type { AiSendFrame } from '../../workspace/launcher/controller'
import { resolveDisplayTitle } from '../../workspace/launcher/display'
import { AI_SEND_PREVIEW_CHARS, aiSendCharCount, aiUnavailableReasonKey } from '../../workspace/ai/sendGate'
import { LauncherCommandTag } from './LauncherCommandTag'
import { LauncherHintKey } from './LauncherFooterHints'

function targetName(frame: AiSendFrame): string {
  const selection = frame.selection
  if (!selection) return ''
  return [selection.providerName || selection.providerId, selection.agentName || selection.agentId].filter(Boolean).join(' · ')
}

/**
 * Host-owned AI send confirmation inside the launcher: what is sent and to whom.
 * ↵ sends (or opens AI settings when unavailable), ␣ toggles the grant, Esc cancels.
 */
export function GlobalLauncherAiSendFrame({
  frame,
  locale,
  onConfirm,
  onToggleRemember,
  onOpenSettings,
  onBack,
}: {
  frame: AiSendFrame
  locale: Locale
  onConfirm: () => void
  onToggleRemember: () => void
  onOpenSettings?: () => void
  onBack: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bodyRef.current?.focus() }, [])
  const unavailable = !frame.selection
  const preview = [frame.send.text, ...(frame.send.extras ?? [])].join('\n').slice(0, AI_SEND_PREVIEW_CHARS)

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      if (!unavailable) onConfirm()
      else if (onOpenSettings) onOpenSettings()
      else onBack()
      return
    }
    if ((event.key === ' ' || event.code === 'Space') && frame.canRemember) {
      event.preventDefault()
      event.stopPropagation()
      onToggleRemember()
    }
  }

  return (
    <>
      <div className="global-launcher-header l-search" style={{ borderBottom: '1px solid var(--border)' }}>
        <LauncherCommandTag title={resolveDisplayTitle(frame.item.display, locale)} icon={frame.item.display.icon} locale={locale} onRemove={onBack} />
      </div>
      <div
        ref={bodyRef}
        className="global-launcher-body launcher-ai-send"
        data-testid="launcher-ai-send"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {unavailable ? (
          <p className="launcher-ai-send-title" role="alert">
            {t(locale, 'aiSendGate.unavailable', { reason: t(locale, `aiSendGate.${aiUnavailableReasonKey(frame.unavailableReason ?? 'metadata_unavailable')}`) })}
          </p>
        ) : (
          <>
            <p className="launcher-ai-send-title">{t(locale, 'aiSendGate.sendTo')} <strong>{targetName(frame)}</strong></p>
            <pre className="ai-send-preview">{preview}</pre>
            <p className="ai-send-meta">{t(locale, 'aiSendGate.total', { count: aiSendCharCount(frame.send).toLocaleString() })}</p>
            {frame.secret && <p className="ai-send-secret" role="alert">{t(locale, 'aiSendGate.secret')}</p>}
            {frame.canRemember && (
              <label className="ai-send-remember">
                <input type="checkbox" checked={frame.remember} onChange={onToggleRemember} tabIndex={-1} />
                {t(locale, 'aiSendGate.remember')}
              </label>
            )}
          </>
        )}
      </div>
      <div className="global-launcher-footer l-foot">
        <LauncherHintKey keys="esc" label={t(locale, 'aiSendGate.cancel')} />
        {frame.canRemember && <LauncherHintKey keys="␣" label={t(locale, 'aiSendGate.rememberShort')} />}
        {unavailable
          ? onOpenSettings && <LauncherHintKey keys="↵" label={t(locale, 'aiSendGate.openSettings')} />
          : <LauncherHintKey keys="↵" label={t(locale, 'aiSendGate.send')} />}
      </div>
    </>
  )
}
