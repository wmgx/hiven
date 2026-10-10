import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { PluginSurfaceOpenTarget } from '../../store'
import type { PluginSurfaceLeaveOwner } from '../pluginSurface/PluginSurfaceRenderer'

type SurfaceChanges = { target: PluginSurfaceOpenTarget; owner: PluginSurfaceLeaveOwner; dirty: boolean }
export type LauncherSurfaceUnsavedChangesReport =
  | ({ kind: 'change' } & SurfaceChanges)
  | { kind: 'release'; target: PluginSurfaceOpenTarget; owner: PluginSurfaceLeaveOwner }

/** A mirror of the visible frame's owned dirty report, used only for idle close. */
export function useLauncherSurfaceBackgroundIdle(visibleTarget: PluginSurfaceOpenTarget | null) {
  const visibleTargetRef = useRef(visibleTarget)
  visibleTargetRef.current = visibleTarget
  const mountedRef = useRef(true)
  const changesRef = useRef<SurfaceChanges | null>(null)
  const [changes, setChanges] = useState<SurfaceChanges | null>(null)
  const restartVersionRef = useRef(0)
  const committedRestartVersionRef = useRef(0)
  const [restartVersion, setRestartVersion] = useState(0)
  const update = useCallback((next: SurfaceChanges | null) => {
    const current = changesRef.current
    if (current === next || (current && next && current.target === next.target
      && current.owner === next.owner && current.dirty === next.dirty)) return
    // The timer can fire before React commits the state update.
    changesRef.current = next
    if (current?.dirty && !next?.dirty) {
      restartVersionRef.current += 1
      setRestartVersion(restartVersionRef.current)
    }
    setChanges(next)
  }, [])
  const onUnsavedChangesReport = useCallback((report: LauncherSurfaceUnsavedChangesReport) => {
    if (!mountedRef.current) return
    if (report.kind === 'release' || !report.owner.isCurrent()) {
      const current = changesRef.current
      if (current?.target === report.target && current.owner === report.owner) update(null)
      return
    }
    if (report.target !== visibleTargetRef.current) return
    update({ target: report.target, owner: report.owner, dirty: report.dirty })
  }, [update])
  useLayoutEffect(() => {
    const current = changesRef.current
    if (current && (current.target !== visibleTarget || !current.owner.isCurrent())) update(null)
  })
  useLayoutEffect(() => {
    committedRestartVersionRef.current = restartVersion
  }, [restartVersion])
  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      changesRef.current = null
    }
  }, [])
  const isPaused = useCallback(() => {
    const current = changesRef.current
    // A dirty -> clean batch must discard the old deadline even when React
    // never commits an intermediate paused=true render.
    return mountedRef.current && (restartVersionRef.current !== committedRestartVersionRef.current
      || Boolean(current?.dirty && current.target === visibleTargetRef.current && current.owner.isCurrent()))
  }, [])
  return {
    paused: Boolean(changes?.dirty && changes.target === visibleTarget && changes.owner.isCurrent()),
    restartVersion,
    isPaused,
    onUnsavedChangesReport,
  }
}
