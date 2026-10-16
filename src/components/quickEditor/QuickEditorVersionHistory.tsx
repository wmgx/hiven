import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Eye, History, RotateCcw, X } from 'lucide-react'
import { useQuickEditorStore } from '../../workspace/quickEditor/quickEditorStore'
import { restoreQuickEditorExternalVersion } from '../../workspace/quickEditor/quickEditorRequests'
import type {
  QuickEditorExternalVersion,
  QuickEditorVersionRestoreRequest,
  QuickEditorVersionRestoreResult,
} from '../../workspace/quickEditor/quickEditorTypes'
import { useAppStore } from '../../store'
import { useT, pickLocale } from '../../i18n'
import { Button } from '../../plugin-ui'
import { quickEditorImperative } from './quickEditorImperative'

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
    'history-restore': { en: 'Restore', zh: '恢复' },
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
  const pendingRestore = useQuickEditorStore((s) => s.pendingVersionRestore)
  const locale = useAppStore((s) => s.locale)
  const theme = useAppStore((s) => s.settings.theme)
  const t = useT('quickEditor')
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [restoreError, setRestoreError] = useState<Exclude<QuickEditorVersionRestoreResult, 'restored'> | null>(null)
  const [restoring, setRestoring] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const selectedVersionIdRef = useRef<string | null>(null)
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const ownedRequestRef = useRef<QuickEditorVersionRestoreRequest | null>(null)
  const ownedRequest = pendingRestore && ownedRequestRef.current === pendingRestore ? pendingRestore : null

  useEffect(() => {
    if (!open) return
    setNow(Date.now())
  }, [open])

  const focusSelectedRow = useCallback(() => {
    requestAnimationFrame(() => {
      const row = selectedVersionIdRef.current ? rowRefs.current.get(selectedVersionIdRef.current) : undefined
      const target = row?.isConnected ? row : triggerRef.current
      target?.focus()
    })
  }, [])

  const focusListStart = useCallback(() => {
    const firstRow = history[0] ? rowRefs.current.get(history[0].id) : undefined
    const target = firstRow?.isConnected ? firstRow : closeRef.current
    target?.focus()
  }, [history])

  const cancelPreview = useCallback(() => {
    const request = ownedRequestRef.current
    if (request) useQuickEditorStore.getState().cancelExternalVersionRestore(request)
    setRestoreError(null)
    setRestoring(false)
  }, [])

  const closeDrawer = useCallback(() => {
    cancelPreview()
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [cancelPreview])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (ownedRequestRef.current && useQuickEditorStore.getState().pendingVersionRestore === ownedRequestRef.current) {
        cancelPreview()
        focusSelectedRow()
      } else {
        closeDrawer()
      }
      return true
    }
    quickEditorImperative.registerVersionHistoryEscape(handleEscape)
    return () => quickEditorImperative.unregisterVersionHistoryEscape(handleEscape)
  }, [cancelPreview, closeDrawer, focusSelectedRow, open])

  useEffect(() => {
    if (!open || !ownedRequest) return
    const frame = requestAnimationFrame(() => cancelRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open, ownedRequest])

  useEffect(() => {
    if (!open || ownedRequest) return
    const frame = requestAnimationFrame(focusListStart)
    return () => cancelAnimationFrame(frame)
  }, [focusListStart, open, ownedRequest])

  useEffect(() => {
    const owned = ownedRequestRef.current
    if (open && owned && !pendingRestore) focusSelectedRow()
  }, [focusSelectedRow, open, pendingRestore])

  useEffect(() => () => {
    const request = ownedRequestRef.current
    if (request) useQuickEditorStore.getState().cancelExternalVersionRestore(request)
  }, [])

  const handlePreview = useCallback((version: QuickEditorExternalVersion) => {
    const request = useQuickEditorStore.getState().requestExternalVersionRestore(version.id)
    if (!request) return
    ownedRequestRef.current = request
    selectedVersionIdRef.current = version.id
    setRestoreError(null)
  }, [])

  const handleRestore = useCallback(() => {
    const request = ownedRequestRef.current
    if (!request || restoring) return
    setRestoring(true)
    void restoreQuickEditorExternalVersion(request)
      .then((result) => {
        if (result !== 'restored') {
          setRestoreError(result)
          return
        }
        ownedRequestRef.current = null
        setRestoreError(null)
        setOpen(false)
        requestAnimationFrame(() => quickEditorImperative.triggerFocus(request.version.paneId))
      })
      .catch((error) => {
        console.warn('[hiven] Failed to restore external version:', error)
        setRestoreError('storage-error')
      })
      .finally(() => setRestoring(false))
  }, [restoring])

  if (history.length === 0 && !ownedRequest) return null

  const drawer = open
    ? createPortal(
        <div className="qe-version-scrim" data-theme={theme} onClick={closeDrawer}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="qe-version-drawer-title"
            className="qe-version-drawer"
            data-theme={theme}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return
              const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), [tabindex="0"]',
              )]
              if (focusable.length === 0) return
              const current = focusable.indexOf(document.activeElement as HTMLElement)
              if (current < 0) {
                event.preventDefault()
                focusable[event.shiftKey ? focusable.length - 1 : 0].focus()
              } else if (event.shiftKey && current === 0) {
                event.preventDefault()
                focusable[focusable.length - 1].focus()
              } else if (!event.shiftKey && current === focusable.length - 1) {
                event.preventDefault()
                focusable[0].focus()
              }
            }}
          >
            <header className="qe-version-drawer__head">
              <span className="qe-version-drawer__title" id="qe-version-drawer-title">
                <History size={14} strokeWidth={2} aria-hidden />
                {ownedRequest ? t('versionHistoryPreviewTitle') : t('versionHistory')}
              </span>
              <span className="qe-version-drawer__head-trailing">
                {!ownedRequest && <span className="qe-version-drawer__count">{history.length}</span>}
                <button
                  ref={closeRef}
                  type="button"
                  className="qe-version-drawer__close"
                  title={t('versionHistoryClose')}
                  aria-label={t('versionHistoryClose')}
                  onClick={closeDrawer}
                >
                  <X size={13} strokeWidth={2} />
                </button>
              </span>
            </header>

            {ownedRequest ? (
              <div className="qe-version-preview" data-testid="quick-editor-version-preview">
                <div className="qe-version-preview__meta">
                  <span>{sourceLabel(ownedRequest.version.source, locale)}</span>
                  <span aria-hidden>·</span>
                  <span>{formatRelativeTime(ownedRequest.version.at, locale, now)}</span>
                </div>
                <pre className="qe-version-preview__text" tabIndex={0}>{ownedRequest.version.text || t('versionHistoryEmptyPreview')}</pre>
                {restoreError && (
                  <div className="qe-version-preview__error" role="alert">
                    {t(restoreError === 'stale' ? 'versionHistoryStale' : 'versionHistoryStorageError')}
                  </div>
                )}
                <div className="qe-version-preview__actions">
                  <Button
                    ref={cancelRef}
                    type="button"
                    variant="secondary"
                    disabled={restoring}
                    onClick={() => {
                      cancelPreview()
                      focusSelectedRow()
                    }}
                  >
                    {t('versionHistoryCancel')}
                  </Button>
                  <Button type="button" variant="primary" disabled={restoring} onClick={handleRestore}>
                    <RotateCcw size={12} strokeWidth={2} aria-hidden />
                    {t('versionHistoryRestore')}
                  </Button>
                </div>
              </div>
            ) : <ul className="qe-version-drawer__list" role="listbox" aria-labelledby="qe-version-drawer-title">
              {history.map((version) => {
                const preview = displayPreview(version.text, t('versionHistoryEmptyPreview'))
                return (
                  <li key={version.id}>
                    <button
                      ref={(node) => {
                        if (node) rowRefs.current.set(version.id, node)
                        else rowRefs.current.delete(version.id)
                      }}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="qe-version-item"
                      onClick={(event) => {
                        event.stopPropagation()
                        handlePreview(version)
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
                          <Eye size={11} strokeWidth={2} />
                          {t('versionHistoryPreview')}
                        </span>
                      </div>
                      <div className="qe-version-item__preview" title={preview}>
                        {preview}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>}
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`qe-version-trigger${open ? ' is-open' : ''}`}
        title={t('versionHistoryHint')}
        aria-label={t('versionHistory')}
        aria-expanded={open}
        aria-haspopup="dialog"
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
