import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { t, type Locale } from '../../i18n'
import type { PluginSurfaceOpenTarget } from '../../store'
import { ConfirmDialog } from '../../plugin-ui'
import { useLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { PluginSurfaceRenderer, type PluginSurfaceLeaveOwner } from '../pluginSurface/PluginSurfaceRenderer'
import { SurfaceBreadcrumbHeader } from '../SurfaceBreadcrumbHeader'
import type { LauncherSurfaceUnsavedChangesReport } from './useLauncherSurfaceBackgroundIdle'

const BREADCRUMB_HEIGHT = 40
type LeaveAction = 'back' | 'close'
type PendingLeave = { action: LeaveAction; target: PluginSurfaceOpenTarget; owner: PluginSurfaceLeaveOwner }

export function GlobalLauncherPluginSurfaceFrame({
  target,
  locale,
  shellHeight,
  autoHeight,
  fillsWindow = false,
  breadcrumbTitle,
  onBack,
  onClose,
  onUnsavedChangesReport,
}: {
  target: PluginSurfaceOpenTarget
  locale: Locale
  shellHeight: number
  autoHeight?: boolean
  fillsWindow?: boolean
  breadcrumbTitle?: string
  onBack: () => void
  onClose: () => void
  onUnsavedChangesReport?: (report: LauncherSurfaceUnsavedChangesReport) => void
}) {
  const bodyHeight = breadcrumbTitle ? shellHeight - BREADCRUMB_HEIGHT : shellHeight
  const activeTargetRef = useRef(target)
  activeTargetRef.current = target
  const mountedRef = useRef(false)
  const changesRef = useRef<{ owner: PluginSurfaceLeaveOwner; dirty: boolean } | null>(null)
  const reportRef = useRef(onUnsavedChangesReport)
  reportRef.current = onUnsavedChangesReport
  const pendingRef = useRef<PendingLeave | null>(null)
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null)

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])
  useLayoutEffect(() => () => {
    const changes = changesRef.current
    if (changes) reportRef.current?.({ kind: 'release', target, owner: changes.owner })
    changesRef.current = null
    pendingRef.current = null
    setPendingLeave(null)
  }, [target])

  const onUnsavedChangesChange = useCallback((dirty: boolean, owner: PluginSurfaceLeaveOwner) => {
    if (!mountedRef.current || activeTargetRef.current !== target) return
    if (!owner.isCurrent()) {
      if (changesRef.current?.owner !== owner) return
      changesRef.current = null
      reportRef.current?.({ kind: 'release', target, owner })
    } else {
      changesRef.current = { owner, dirty }
      reportRef.current?.({ kind: 'change', target, owner, dirty })
    }
    if (pendingRef.current && (!dirty || pendingRef.current.owner !== owner || !owner.isCurrent())) {
      pendingRef.current = null
      setPendingLeave(null)
    }
  }, [target])

  const requestLeave = useCallback((action: LeaveAction) => {
    if (!mountedRef.current || activeTargetRef.current !== target) return
    const changes = changesRef.current
    if (changes?.dirty && changes.owner.isCurrent()) {
      if (pendingRef.current) return
      const pending = { action, target, owner: changes.owner }
      pendingRef.current = pending
      setPendingLeave(pending)
      return
    }
    if (action === 'back') onBack()
    else onClose()
  }, [target, onBack, onClose])

  const cancelLeave = useCallback(() => {
    // A retained dismissal from an old dialog cannot dismiss its replacement.
    if (pendingRef.current !== pendingLeave) return
    pendingRef.current = null
    setPendingLeave(null)
  }, [pendingLeave])
  const discardChanges = () => {
    if (!pendingLeave || pendingRef.current !== pendingLeave || !mountedRef.current
      || pendingLeave.target !== activeTargetRef.current
      || changesRef.current?.owner !== pendingLeave.owner || !pendingLeave.owner.isCurrent()) return
    pendingRef.current = null
    changesRef.current = null
    setPendingLeave(null)
    // Confirmed exits use raw host navigation, never a plugin callback.
    if (pendingLeave.action === 'back') onBack()
    else onClose()
  }

  const escapeHandler = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    if (pendingRef.current) {
      event.preventDefault()
      event.stopPropagation()
      pendingRef.current = null
      setPendingLeave(null)
      return true
    }
    // Let the editor close its find widget before navigating out of the surface.
    if (event.target instanceof Element && event.target.closest('.monaco-editor')?.querySelector('.find-widget.visible')) return true
    event.preventDefault()
    event.stopPropagation()
    requestLeave('back')
    return true
  }, [requestLeave])
  useLauncherEscapeInterceptor(escapeHandler)

  return (
    <div
      className="global-launcher-surface-shell flex flex-col min-h-0 outline-none"
      tabIndex={-1}
      style={fillsWindow
        ? { height: '100%', flex: '1 1 0', minWidth: 0 }
        : autoHeight ? { maxHeight: shellHeight } : { height: shellHeight }}
    >
      {breadcrumbTitle && (
        <SurfaceBreadcrumbHeader
          title={breadcrumbTitle}
          onBack={() => requestLeave('back')}
          onClose={() => requestLeave('close')}
        />
      )}
      <div
        className="global-launcher-body global-launcher-body--surface"
        data-no-drag
        data-launcher-scrollable
        style={
          fillsWindow
            ? { maxHeight: 'none', flex: '1 1 0', minWidth: 0, overflow: 'hidden', touchAction: 'auto' }
            : autoHeight
            ? { maxHeight: bodyHeight, overflow: 'hidden', touchAction: 'auto' }
            : { maxHeight: bodyHeight, height: bodyHeight, overflow: 'hidden', touchAction: 'auto' }
        }
      >
        <PluginSurfaceRenderer
          target={target}
          locale={locale}
          presentation="global-launcher"
          contextSurfaceId="global-launcher"
          onBack={onBack}
          onClose={onClose}
          onUnsavedChangesChange={onUnsavedChangesChange}
          onRequestLeave={requestLeave}
        />
      </div>
      <ConfirmDialog
        open={Boolean(pendingLeave && pendingLeave.target === target && pendingLeave.owner.isCurrent())}
        title={t(locale, 'palette.surfaceDiscardTitle')}
        message={t(locale, 'palette.surfaceDiscardMessage')}
        confirmLabel={t(locale, 'palette.surfaceDiscardConfirm')}
        cancelLabel={t(locale, 'palette.surfaceDiscardCancel')}
        defaultFocus="cancel"
        onConfirm={discardChanges}
        onCancel={cancelLeave}
      />
    </div>
  )
}
