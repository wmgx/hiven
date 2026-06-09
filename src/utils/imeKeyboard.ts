type CompositionRef = {
  current: boolean
}

type ImeKeyEvent = {
  keyCode?: number
  nativeEvent?: {
    isComposing?: boolean
  }
}

type Scheduler = (callback: () => void) => void

const defaultSchedule: Scheduler = (callback) => {
  window.setTimeout(callback, 0)
}

export function startImeComposition(composingRef: CompositionRef) {
  composingRef.current = true
}

export function finishImeComposition(
  composingRef: CompositionRef,
  schedule: Scheduler = defaultSchedule,
) {
  schedule(() => { composingRef.current = false })
}

export function shouldIgnoreImeKeyDown(event: ImeKeyEvent, composingRef: CompositionRef) {
  return composingRef.current || event.nativeEvent?.isComposing === true || event.keyCode === 229
}
