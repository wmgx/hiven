import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { History, RotateCcw, X } from 'lucide-react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { restoreQuickEditorExternalVersion } from '../../workspace/quickEditor/quickEditorRequests'
import type { QuickEditorExternalVersion } from '../../workspace/quickEditor/quickEditorTypes'
import { useAppStore } from '../../store'
import { useT, pickLocale } from '../../i18n'

function formatRelativeTime(at: number, locale: 'en' | 'zh', now = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - at) / 1000))
  if (sec < 45) return pickLocale(locale, '刚刚', 'Just now')
  const min = Math.floor(sec / 60)
  if (min < 60) return pickLocale(locale, `${min} 分钟前`, `${min}m ago`)
  const hr = Math.floor(min / 60)
  if (hr < 24) return pickLocale(locale, `${hr} 小时前`, `${hr}h ago`)
  const day = Math.floor(hr / 24)
  if (day < 7) return pickLocale(locale, `${day} 天前`, `${day}d ago`)
  try {
    return new Intl.DateTimeFormat(pickLocale(locale, 'zh-CN', 'en-US'), {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(at))
  } catch {
    return new Date(at).toLocaleString()
  }
}

function sourceLabel(source: string | undefined, locale: 'en' | 'zh'): string {
  if (!source) return pickLocale(locale, '覆盖', 'Overwrite')
  const map: Record<string, { en: string; zh: string }> = {
    clipboard: { en: 'Clipboard', zh: '剪贴板' },
    'history-item': { en: 'History', zh: '历史' },
    'tool-result': { en: 'Result', zh: '结果' },
    'replace-active': { en: 'Replace', zh: '替换' },
    workflow: { en: 'Workflow', zh: '工作流' },
  }
  return map[source]?.[locale] ?? source
}

function displayPreview(text: string, emptyLabel: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  if (lines.length === 0) return emptyLabel
  const first = lines[0]
  return first.length > 80 ? `${first.slice(0, 80)}…` : first
}

/**
 * Status-bar history icon → full-height right-edge drawer (meta + preview rows).
 * External overwrite only; portaled above Monaco.
 */
export function QuickEditorVersionHistory() {
  const history = useQuickEditorStore((s) => s.externalVersionHistory)
  const locale = useAppStore((s) => s.locale)
  const theme = useAppStore((s) => s.settings.theme)
  const t = useT('quickEditor')
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const handleRestore = useCallback((version: QuickEditorExternalVersion) => {
    void restoreQuickEditorExternalVersion(version.id)
      .then((ok) => {
        if (ok) setOpen(false)
      })
      .catch((error) => {
        console.warn('[hiven] Failed to restore external version:', error)
      })
  }, [])

  if (history.length === 0) return null

  const drawer = open
    ? createPortal(
        <div className="qe-version-scrim" data-theme={theme} onClick={() => setOpen(false)}>
          <div
            role="listbox"
            className="qe-version-drawer"
            data-theme={theme}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="qe-version-drawer__head">
              <span className="qe-version-drawer__title">
                <History size={14} strokeWidth={2} aria-hidden />
                {t('versionHistory')}
              </span>
              <span className="qe-version-drawer__head-trailing">
                <span className="qe-version-drawer__count">{history.length}</span>
                <button
                  type="button"
                  className="qe-version-drawer__close"
                  title={t('versionHistoryClose')}
                  aria-label={t('versionHistoryClose')}
                  onClick={() => setOpen(false)}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </span>
            </header>

            <ul className="qe-version-drawer__list">
              {history.map((version) => {
                const preview = displayPreview(version.text, t('versionHistoryEmptyPreview'))
                return (
                  <li key={version.id}>
                    <button
                      type="button"
                      role="option"
                      className="qe-version-item"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleRestore(version)
                      }}
                    >
                      <div className="qe-version-item__meta">
                        <span className="qe-version-item__source">
                          {sourceLabel(version.source, locale)}
                        </span>
                        <span className="qe-version-item__dot" aria-hidden>·</span>
                        <span className="qe-version-item__time">
                          {formatRelativeTime(version.at, locale, now)}
                        </span>
                        <span className="qe-version-item__restore" aria-hidden>
                          <RotateCcw size={11} strokeWidth={2} />
                          {t('versionHistoryRestore')}
                        </span>
                      </div>
                      <div className="qe-version-item__preview" title={preview}>
                        {preview}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        type="button"
        className={`qe-version-trigger${open ? ' is-open' : ''}`}
        title={t('versionHistoryHint')}
        aria-label={t('versionHistory')}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        <History size={11} strokeWidth={2} />
      </button>
      {drawer}
    </>
  )
}
