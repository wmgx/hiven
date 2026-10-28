import { useContext, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { SurfaceHeaderActionsContext } from './SurfaceHeaderActions'
import { dismissToast, useToastStore } from '../workspace/toast'

/** Legacy showMessage callers share the shell's in-place status/error treatment. */
export function WindowFeedback({ mode }: { mode?: 'error' | 'status' } = {}) {
  const items = useToastStore(state => state.toasts)
  const notice = items.filter(item => !item.notify).at(-1)
  const slots = useContext(SurfaceHeaderActionsContext)
  useEffect(() => {
    if (!notice) return
    const clear = (event: Event) => {
      if (event.type === 'pointerdown' && event.target instanceof Element && event.target.closest('.window-feedback button')) return
      dismissToast(notice.id)
    }
    document.addEventListener('input', clear, true)
    document.addEventListener('pointerdown', clear, true)
    document.addEventListener('keydown', clear, true)
    return () => {
      document.removeEventListener('input', clear, true)
      document.removeEventListener('pointerdown', clear, true)
      document.removeEventListener('keydown', clear, true)
    }
  }, [notice])
  if (!notice) return null
  const error = notice.level === 'error'
  if (mode && mode !== (error ? 'error' : 'status')) return null
  const content = <div className={`window-feedback ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>
    {notice.message}{notice.progress && ` · ${notice.progress.completed}/${notice.progress.total}`}
    {notice.action && <button type="button" onClick={notice.action.onClick}>{notice.action.label}</button>}
  </div>
  const slot = error ? slots.error : slots.status
  return slot ? createPortal(content, slot) : content
}
