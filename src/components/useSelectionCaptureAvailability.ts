import { useEffect, useState } from 'react'
import { readSelectionCaptureAvailability, type SelectionCaptureAvailability } from '../workspace/launcher/foregroundSelectionCapture'

/** Platform-only preflight while the explicit selection input action is shown. */
export function useSelectionCaptureAvailability(enabled: boolean): SelectionCaptureAvailability {
  const [snapshot, setSnapshot] = useState<{ enabled: boolean; availability: SelectionCaptureAvailability }>({ enabled, availability: 'unknown' })
  if (snapshot.enabled !== enabled) setSnapshot({ enabled, availability: 'unknown' })

  useEffect(() => {
    if (!enabled) return
    let disposed = false
    void readSelectionCaptureAvailability().then((availability) => {
      if (!disposed) setSnapshot({ enabled, availability })
    })
    return () => { disposed = true }
  }, [enabled])

  return enabled && snapshot.enabled === enabled ? snapshot.availability : 'unknown'
}
