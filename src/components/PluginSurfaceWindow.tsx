import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type PluginSurfaceOpenTarget } from '../store'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'
import { pluginSurfaceInstanceId, pluginSurfaceWindowLabel } from '../workspace/pluginSurfaceWindows'
import { hideCurrentPluginSurfaceWindow, hidePluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { useT, t as translate } from '../i18n'
import { ConfirmDialog } from '../plugin-ui'
import { invoke } from '@tauri-apps/api/core'
import { PluginSettingsDialog } from './PluginSettingsDialog'
import { ToastContainer } from './workspace/ToastContainer'
import { PluginSurfaceRenderer, type PluginSurfaceLeaveOwner, usePluginSurfaceRendersTitlebar, usePluginSurfaceTitle } from './pluginSurface/PluginSurfaceRenderer'
import './PluginSurfaceWindow.css'

type WindowEntry = { id: string; target: PluginSurfaceOpenTarget }

export function PluginSurfaceWindow() {
  const locale = useAppStore((s) => s.locale)
  const theme = useAppStore((s) => s.settings.theme)
  const t = useT('workspace')
  const baseTarget = useMemo(() => parseTargetFromUrl(), [])
  type Entry = WindowEntry
  type Request = { id: string; initialText: string; status: string }
  const [active, setActive] = useState<Entry | null>(null)
  const activeRef = useRef<Entry | null>(null)
  const [pending, setPending] = useState<Request | null>(null)
  const pendingRef = useRef<Request | null>(null)
  const [staged, setStaged] = useState<Entry | null>(null)
  const stagedRef = useRef<Entry | null>(null)
  const settlingRef = useRef(false)
  const aliveRef = useRef(false)
  const draftRevision = useRef(0)
  const draftInstance = useRef<number | null>(null)
  const draftReportRef = useRef<{ generation: string; revision: number; dirty: boolean } | null>(null)
  const flushDraftReport = useCallback(async () => {
    const report = draftReportRef.current
    if (!report || !isTauriRuntime()) return
    try {
      if (draftInstance.current === null) draftInstance.current = await invoke<number>('plugin_surface_draft_instance')
      await invoke('plugin_surface_draft_report', { ...report, instance: draftInstance.current })
      if (draftReportRef.current === report) draftReportRef.current = null
    } catch { /* The next receipt poll retries without dropping the draft report. */ }
  }, [])
  const reportDraft = useCallback((entry: WindowEntry, dirty: boolean, owner: PluginSurfaceLeaveOwner) => {
    // Cleanup, hidden owners, and staging are not statements that the active draft is empty.
    if (activeRef.current !== entry || !owner.isCurrent()) return
    draftReportRef.current = { generation: entry.id, revision: ++draftRevision.current, dirty }
    void flushDraftReport()
  }, [flushDraftReport])
  const [targetReady, setTargetReady] = useState(false)
  const target = active?.target ?? staged?.target ?? baseTarget
  const title = usePluginSurfaceTitle(target, locale)
  const usesPluginTitlebar = usePluginSurfaceRendersTitlebar(target)
  const clearPending = useCallback(() => {
    pendingRef.current = null
    stagedRef.current = null
    setPending(null)
    setStaged(null)
    if (!activeRef.current && baseTarget) {
      const entry = { id: 'initial', target: baseTarget }
      activeRef.current = entry
      setActive(entry)
    }
  }, [baseTarget])
  const rejectPending = useCallback(async () => {
    const request = pendingRef.current
    if (!request || settlingRef.current) return
    settlingRef.current = true
    try { await invoke('plugin_surface_handoff_finish', { id: request.id, accepted: false }) }
    finally {
      settlingRef.current = false
      if (aliveRef.current && pendingRef.current === request) clearPending()
    }
  }, [clearPending])
  const hide = useCallback(async () => {
    if (settlingRef.current) return
    await rejectPending().catch(() => undefined)
    await hideCurrentWindow(baseTarget)
  }, [baseTarget, rejectPending])
  const stageRequest = useCallback((request: Request) => {
    if (!baseTarget || pendingRef.current !== request || settlingRef.current) return
    const entry = { id: request.id, target: { ...baseTarget, initialText: request.initialText } }
    stagedRef.current = entry
    setStaged(entry)
  }, [baseTarget])
  const ready = useCallback(async (entry: Entry, ok: boolean) => {
    const request = pendingRef.current
    if (!request || stagedRef.current !== entry || entry.id !== request.id || settlingRef.current) return
    settlingRef.current = true
    try {
      const status = await invoke<string>('plugin_surface_handoff_finish', { id: request.id, accepted: ok }).catch(() => invoke<string>('plugin_surface_handoff_status', { label: pluginSurfaceWindowLabel(entry.target), id: request.id }))
      if (!aliveRef.current || pendingRef.current !== request || stagedRef.current !== entry) return
      if (status === 'accepted') {
        activeRef.current = entry
        setActive(entry)
      }
      clearPending()
    } catch {
      // Retain both trees while receipt delivery is uncertain; polling recovers it.
    } finally { settlingRef.current = false }
  }, [clearPending])

  useEffect(() => {
    aliveRef.current = true
    let busy = false
    let initialized = false
    const check = async () => {
      if (busy || settlingRef.current || !baseTarget) return
      busy = true
      try {
        await flushDraftReport()
        // Poll only the receipt while waiting; do not shuttle a large snapshot
        // through IPC on every tick while the user considers the old draft.
        const previous = pendingRef.current
        if (previous) {
          const status = await invoke<string>('plugin_surface_handoff_status', { label: pluginSurfaceWindowLabel(baseTarget), id: previous.id })
          if (!aliveRef.current || settlingRef.current || pendingRef.current !== previous) return
          if (status === 'pending') return
          const entry = stagedRef.current
          if (status === 'accepted' && entry?.id === previous.id) {
            activeRef.current = entry
            setActive(entry)
          }
          clearPending()
        }
        const request = isTauriRuntime() ? await invoke<Request | null>('plugin_surface_handoff_peek') : null
        if (!aliveRef.current || settlingRef.current) return
        if (request && !pendingRef.current) {
          pendingRef.current = request
          setPending(request)
          if (!activeRef.current) stageRequest(request)
        }
        if (!initialized) {
          initialized = true
          if (!request) {
            const entry = { id: 'initial', target: baseTarget }
            activeRef.current = entry
            setActive(entry)
          }
          setTargetReady(true)
        }
      } catch {
        // A failed read must never replace the existing draft.
        if (!initialized) setTargetReady(true)
      } finally { busy = false }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 150)
    return () => {
      aliveRef.current = false
      window.clearInterval(timer)
      const request = pendingRef.current
      if (request) void invoke('plugin_surface_handoff_finish', { id: request.id, accepted: false }).catch(() => undefined)
    }
  }, [baseTarget, clearPending, stageRequest, flushDraftReport])

  useEffect(() => {
    if (!target) return
    const instanceId = pluginSurfaceInstanceId(target)
    upsertSurfaceInstance({
      id: instanceId,
      kind: 'plugin-surface',
      windowLabel: pluginSurfaceWindowLabel(target),
      title: title || target.surfaceId,
      pluginId: target.pluginId,
      surfaceId: target.surfaceId,
      state: 'visible',
      canReceiveText: true,
      canProvideText: true,
      canAttachToEditor: true,
    })
    const onPageHide = () => markSurfaceInstanceState(instanceId, 'destroyed')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      markSurfaceInstanceState(instanceId, 'hidden')
    }
  }, [baseTarget, title])

  const isImeComposingRef = useRef(false)

  useEffect(() => {
    const onCompositionStart = () => { isImeComposingRef.current = true }
    const onCompositionEnd = () => { isImeComposingRef.current = false }
    document.addEventListener('compositionstart', onCompositionStart)
    document.addEventListener('compositionend', onCompositionEnd)
    return () => {
      document.removeEventListener('compositionstart', onCompositionStart)
      document.removeEventListener('compositionend', onCompositionEnd)
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      // A settings overlay owns Escape before the independent window hides.
      if (document.querySelector('[role="dialog"][data-open]')) return
      if (document.querySelector('[role="tooltip"][data-open]')) return
      if (isImeComposingRef.current || event.isComposing || (event as unknown as { keyCode: number }).keyCode === 229) return
      event.preventDefault()
      event.stopPropagation()
      void hide()
    }
    // Plugin editors and dialogs handle Escape first; this is only the window fallback.
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [hide])

  if (!targetReady) {
    return null
  }

  if (!target) {
    return <WindowMessage title={t('invalidTarget')} />
  }

  return (
    <div className="flux-spatial-shell plugin-surface-window-shell" data-theme={theme}>
      <div className="plugin-surface-window-frame">
        {!usesPluginTitlebar && (
          <div className="plugin-surface-window-titlebar" data-tauri-drag-region>
            <div className="plugin-surface-window-title" data-tauri-drag-region>{title || t('pluginSurface')}</div>
            <button className="plugin-surface-window-close" type="button" onClick={() => { void hide() }}>×</button>
          </div>
        )}
        <div className="plugin-surface-window-body">
          {[active, staged].filter((entry): entry is Entry => Boolean(entry)).map((entry) => (
            <div key={entry.id} style={{ height: '100%', display: staged && entry !== staged ? 'none' : undefined }}>
              <DraftReportingSurface
                entry={entry}
                locale={locale}
                suspended={Boolean(staged)}
                onHandoffReady={entry === staged ? (ok) => { void ready(entry, ok) } : undefined}
                onBack={() => { void hide() }}
                onClose={() => { void hide() }}
                reportDraft={reportDraft}
              />
            </div>
          ))}
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(pending && active && !staged)}
        title={translate(locale, 'palette.surfaceWindowReplaceTitle')}
        message={translate(locale, 'palette.surfaceWindowReplaceMessage')}
        confirmLabel={translate(locale, 'palette.surfaceDiscardConfirm')}
        cancelLabel={translate(locale, 'palette.surfaceDiscardCancel')}
        defaultFocus="cancel"
        onConfirm={() => { if (pending && pendingRef.current === pending) stageRequest(pending) }}
        onCancel={() => { void rejectPending().catch(() => undefined) }}
      />
      <PluginSettingsDialog />
      <ToastContainer />
    </div>
  )
}

function DraftReportingSurface({ entry, reportDraft, ...props }: {
  entry: WindowEntry
  reportDraft: (entry: WindowEntry, dirty: boolean, owner: PluginSurfaceLeaveOwner) => void
  locale: 'zh' | 'en'
  suspended: boolean
  onHandoffReady?: (ready: boolean) => void
  onBack: () => void
  onClose: () => void
}) {
  // Stable callback prevents ordinary parent rerenders from masquerading as owner cleanup.
  const onUnsavedChangesChange = useCallback((dirty: boolean, owner: PluginSurfaceLeaveOwner) => {
    reportDraft(entry, dirty, owner)
  }, [entry, reportDraft])
  return <PluginSurfaceRenderer {...props} target={entry.target} presentation="plugin-surface-window"
    contextSurfaceId="plugin-surface-window" onUnsavedChangesChange={onUnsavedChangesChange} />
}

function parseTargetFromUrl(): PluginSurfaceOpenTarget | null {
  const params = new URLSearchParams(window.location.search)
  const source = params.get('source')
  const pluginId = params.get('pluginId')
  const surfaceId = params.get('surfaceId')
  if (!isPluginSettingsSource(source) || !pluginId || !surfaceId) return null
  return { source, pluginId, surfaceId }
}

function isPluginSettingsSource(value: string | null): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function hideCurrentWindow(target?: PluginSurfaceOpenTarget | null): Promise<void> {
  if (isTauriRuntime()) {
    if (target) {
      await hidePluginSurfaceWindow(target).catch(() => undefined)
      return
    }
    await hideCurrentPluginSurfaceWindow().catch(() => undefined)
    return
  }
  window.close()
}

function WindowMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="flux-spatial-shell plugin-surface-window-shell">
      <div className="plugin-surface-window-frame">
        <div className="plugin-surface-window-titlebar" data-tauri-drag-region>
          <div className="plugin-surface-window-title" data-tauri-drag-region>{title}</div>
          <button className="plugin-surface-window-close" type="button" onClick={() => { void hideCurrentWindow() }}>×</button>
        </div>
        <div className="plugin-surface-window-message">
          <div>{title}</div>
          {message && <small>{message}</small>}
        </div>
      </div>
    </div>
  )
}
