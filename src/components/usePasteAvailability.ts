import { useEffect, useState } from 'react'
import { readPasteAvailability, type PasteAvailability } from '../workspace/pasteAvailability'
import { onCurrentLauncherWindowFocusChanged } from '../workspace/windowManager/launcherWindow'

/** Observe only while a paste destination is shown. Execution checks again. */
export function usePasteAvailability(enabled: boolean): PasteAvailability {
  const [snapshot, setSnapshot] = useState<{ enabled: boolean; availability: PasteAvailability }>({ enabled, availability: 'unknown' })
  if (snapshot.enabled !== enabled) {
    // Reopening observation must never render an earlier permission snapshot.
    setSnapshot({ enabled, availability: 'unknown' })
  }

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    let request = 0
    let unlisten: (() => void) | undefined
    const read = () => {
      const currentRequest = ++request
      void readPasteAvailability().then((next) => {
        if (!disposed && currentRequest === request) setSnapshot({ enabled, availability: next })
      }, () => {
        if (!disposed && currentRequest === request) setSnapshot({ enabled, availability: 'unknown' })
      })
    }
    const refresh = () => {
      setSnapshot({ enabled, availability: 'unknown' })
      read()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    read()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibilityChange)
    // Native panels can reopen without a DOM focus/visibility event.
    void onCurrentLauncherWindowFocusChanged((focused) => {
      if (focused && !disposed) refresh()
    }).then((stop) => {
      if (disposed) stop()
      else unlisten = stop
    }, () => { /* DOM focus remains available when native events are absent. */ })

    return () => {
      disposed = true
      ++request
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      unlisten?.()
    }
  }, [enabled])

  return enabled && snapshot.enabled === enabled ? snapshot.availability : 'unknown'
}
