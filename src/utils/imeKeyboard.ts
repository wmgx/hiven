type CompositionRef = {
  current: boolean
}

type ImeKeyEvent = {
  key?: string
  keyCode?: number
  /** React 17+ synthetic keyboard event */
  isComposing?: boolean
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
}

type Scheduler = (callback: () => void) => void

const defaultSchedule: Scheduler = (callback) => {
  window.setTimeout(callback, 0)
}

/**
 * After compositionend, some IMEs still deliver a plain Enter keydown for 上屏.
 * Ignore Enter/Process for a short window so it is never treated as confirm/select.
 */
const IME_COMMIT_ENTER_GUARD_MS = 120

/** Shared clock for post-compositionend Enter suppression (all surfaces). */
let lastCompositionEndedAt = 0

export function startImeComposition(composingRef: CompositionRef) {
  composingRef.current = true
}

export function finishImeComposition(
  composingRef: CompositionRef,
  schedule: Scheduler = defaultSchedule,
) {
  lastCompositionEndedAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  // Clear composing flag asynchronously so a same-turn Enter keydown still sees true.
  schedule(() => {
    composingRef.current = false
  })
}

/**
 * Global IME keydown guard.
 * Must be used for every launcher / palette Enter handler.
 *
 * Covers:
 * - tracked composition flag
 * - native / React isComposing
 * - keyCode 229 (IME processing key)
 * - Enter shortly after compositionend (上屏 Enter that looks like a plain confirm)
 *
 * Escape is NEVER ignored: a stuck composition flag (compositionend missed after
 * remount/focus thrash) must not trap the user in collect-input / launcher.
 * Hosts should still clear composingRef when handling Escape.
 */
export function shouldIgnoreImeKeyDown(event: ImeKeyEvent, composingRef: CompositionRef): boolean {
  // Global dismiss / step-back must work even if IME state is wrong.
  if (event.key === 'Escape') return false

  if (composingRef.current) return true
  if (event.isComposing === true) return true
  if (event.nativeEvent?.isComposing === true) return true
  const keyCode = event.keyCode ?? event.nativeEvent?.keyCode
  if (keyCode === 229) return true

  const key = event.key
  if (key === 'Enter' || key === 'Process') {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    if (now - lastCompositionEndedAt < IME_COMMIT_ENTER_GUARD_MS) {
      return true
    }
  }
  return false
}

/** Test helper: reset post-composition guard clock. */
export function resetImeCompositionGuardForTests(): void {
  lastCompositionEndedAt = 0
}
