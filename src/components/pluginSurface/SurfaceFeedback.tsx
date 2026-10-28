import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SurfaceError, SurfaceStatus } from '../../ui/SurfaceHeaderActions'
import { useT } from '../../i18n'
import type { PluginNotifyApi } from '../../workspace/pluginTypes'

type Notice = Parameters<PluginNotifyApi['toast']>[0]
type Item = Notice & { id: number; resolve: () => void; running?: Promise<void> }

/** Keep undo alive until it settles; expiry never finalizes an in-flight restore. */
export function useSurfaceFeedback() {
  const [items, setItems] = useState<Item[]>([])
  const live = useRef<Item[]>([])
  const serial = useRef(0)
  const dismiss = useCallback((item: Item) => {
    if (!live.current.includes(item)) return
    live.current = live.current.filter(entry => entry !== item)
    setItems(live.current)
    if (item.running) void item.running.then(item.resolve, item.resolve)
    else item.resolve()
  }, [])
  const clear = useCallback(() => { for (const item of [...live.current]) dismiss(item) }, [dismiss])
  useLayoutEffect(() => clear, [clear])
  const notify = useCallback((notice: Notice) => new Promise<void>(resolve => {
    for (const item of [...live.current]) if (!item.action) dismiss(item)
    if (live.current.length === 2) dismiss(live.current[0])
    live.current = [...live.current, { ...notice, id: ++serial.current, resolve }]
    setItems(live.current)
  }), [dismiss])
  useEffect(() => {
    const clearErrors = () => { for (const item of [...live.current]) if (item.level === 'error') dismiss(item) }
    document.addEventListener('input', clearErrors, true)
    document.addEventListener('pointerdown', clearErrors, true)
    document.addEventListener('keydown', clearErrors, true)
    return () => {
      document.removeEventListener('input', clearErrors, true)
      document.removeEventListener('pointerdown', clearErrors, true)
      document.removeEventListener('keydown', clearErrors, true)
    }
  }, [dismiss])
  const layer = <>{items.map(item => <SurfaceNotice key={item.id} item={item} dismiss={dismiss} />)}</>
  return { notify, clear, layer }
}

function SurfaceNotice({ item, dismiss }: { item: Item; dismiss(item: Item): void }) {
  const t = useT('palette')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (item.level === 'error' || failed || busy) return
    const timer = setTimeout(() => dismiss(item), item.action ? 5000 : 1500)
    return () => clearTimeout(timer)
  }, [item, dismiss, failed, busy])
  const run = () => {
    if (!item.action || item.running) return
    setBusy(true)
    item.running = Promise.resolve().then(item.action.run)
    void item.running.then(() => dismiss(item), () => {
      item.running = undefined
      setBusy(false)
      setFailed(true)
    })
  }
  const error = failed || item.level === 'error'
  const Slot = error ? SurfaceError : SurfaceStatus
  return <Slot><span className="surface-feedback-inline" data-level={error ? 'error' : item.level} role={error ? 'alert' : 'status'}>
    <span>{failed ? t('surfaceToastActionFailed') : item.message}</span>
    {item.action && <button type="button" disabled={busy} onClick={run}>{item.action.label}</button>}
  </span></Slot>
}
