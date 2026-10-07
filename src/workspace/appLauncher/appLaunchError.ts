import { translate, type Locale } from '../../i18n'

const ERROR_KEYS: Record<string, string> = {
  APP_LAUNCH_UNAVAILABLE: 'unavailable',
  APP_LAUNCH_HELPER_MISSING: 'helperMissing',
  APP_LAUNCH_START_FAILED: 'startFailed',
  APP_LAUNCH_REJECTED: 'rejected',
  APP_LAUNCH_INTERRUPTED: 'interrupted',
  APP_LAUNCH_UNCONFIRMED: 'unconfirmed',
}

export function appLaunchErrorMessage(error: unknown, locale: Locale): string | undefined {
  const code = error instanceof Error ? error.message : String(error)
  const key = Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : undefined
  return key ? translate(locale, 'appLauncher', key) : undefined
}

/** Only the Linux launch protocol is translated; other platform errors retain their behavior. */
export async function rethrowAppLaunchError(error: unknown): Promise<never> {
  const code = error instanceof Error ? error.message : String(error)
  if (Object.hasOwn(ERROR_KEYS, code)) {
    // Read the current locale only on failure, without adding the store to the
    // app-index startup graph or freezing the language in a cached launcher row.
    const { useAppStore } = await import('../../store')
    throw new Error(appLaunchErrorMessage(error, useAppStore.getState().locale))
  }
  throw error
}
