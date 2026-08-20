import { useEffect } from 'react'

/**
 * Generic escape takeover protocol for launcher-hosted pages.
 *
 * A page (host surface / plugin surface) may register a single interceptor.
 * The host escape chain consults it after the IME check; returning `true`
 * means the page owns this Escape press and the default chain must not run.
 * Whether to `preventDefault`/`stopPropagation` is the interceptor's call.
 */
export type LauncherEscapeInterceptor = (event: KeyboardEvent) => boolean

let activeInterceptor: LauncherEscapeInterceptor | null = null

export function runLauncherEscapeInterceptor(event: KeyboardEvent): boolean {
  return activeInterceptor ? activeInterceptor(event) : false
}

/** Register while mounted. Pass `null` to skip registration (e.g. wrong host). */
export function useLauncherEscapeInterceptor(handler: LauncherEscapeInterceptor | null) {
  useEffect(() => {
    if (!handler) return
    activeInterceptor = handler
    return () => {
      if (activeInterceptor === handler) activeInterceptor = null
    }
  }, [handler])
}
