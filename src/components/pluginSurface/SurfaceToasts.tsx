import './SurfaceToasts.css'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useT } from '../../i18n'
import type { PluginNotifyApi } from '../../workspace/pluginTypes'

type Notice = Parameters<PluginNotifyApi['toast']>[0]
type Item = Notice & { id: number; resolve: () => void; running?: Promise<void> }

export function useSurfaceToasts() {
  const [items, setItems] = useState<Item[]>([])
  const live = useRef<Item[]>([])
  const serial = useRef(0)
  const dismiss = useCallback((item: Item) => {
    if (!live.current.includes(item)) return
    live.current = live.current.filter(entry => entry !== item)
    setItems(live.current)
    // An in-flight undo must settle before its caller can finalize deletion.
    if (item.running) void item.running.then(item.resolve, item.resolve)
    else item.resolve()
  }, [])
  const clear = useCallback(() => { for (const item of [...live.current]) dismiss(item) }, [dismiss])
  useLayoutEffect(() => clear, [clear])
  const toast = useCallback((notice: Notice) => new Promise<void>(resolve => {
    if (live.current.length === 2) dismiss(live.current[0])
    live.current = [...live.current, { ...notice, id: ++serial.current, resolve }]
    setItems(live.current)
  }), [dismiss])
  const layer = <div className="surface-toasts" data-no-drag>
    {items.map(item => <SurfaceToast key={item.id} item={item} dismiss={dismiss} />)}
  </div>
  return { toast, clear, layer }
}

function SurfaceToast({ item, dismiss }: { item: Item; dismiss: (item: Item) => void }) {
  const t = useT('palette')
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const remaining = useRef(item.durationMs ?? (item.action ? 5000 : 2500))
  useLayoutEffect(() => {
    if (hovered || focused || busy || failed || item.level === 'error') return
    const started = Date.now()
    const timer = setTimeout(() => dismiss(item), Math.max(0, remaining.current))
    return () => { clearTimeout(timer); remaining.current -= Date.now() - started }
  }, [hovered, focused, busy, failed, item, dismiss])
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
  return <div className="surface-toast" data-level={failed ? 'error' : item.level}
    role={failed || item.level === 'error' ? 'alert' : 'status'}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <span>{failed ? t('surfaceToastActionFailed') : item.message}</span>
    {item.action && <button type="button" disabled={busy} onClick={run}>{item.action.label}</button>}
    <button type="button" aria-label={t('close')} disabled={busy} onClick={() => dismiss(item)}><X size={14} /></button>
  </div>
}
