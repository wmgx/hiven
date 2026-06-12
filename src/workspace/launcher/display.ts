/**
 * Launcher Display Helpers
 *
 * Pure i18n resolution for launcher item display fields. Kept separate from the
 * store's `localized` so launcher code has no store dependency.
 */

import type { Locale } from '../../i18n'
import type { LauncherItemDisplay } from './types'

export function localizedDisplay(
  text: string,
  i18nMap: Partial<Record<Locale, string>> | undefined,
  locale: Locale,
): string {
  if (i18nMap && i18nMap[locale]) return i18nMap[locale]!
  return text
}

export function resolveDisplayTitle(display: LauncherItemDisplay, locale: Locale): string {
  return localizedDisplay(display.title, display.titleI18n, locale)
}

export function resolveDisplaySubtitle(
  display: LauncherItemDisplay,
  locale: Locale,
): string | undefined {
  if (display.subtitle == null && display.subtitleI18n == null) return undefined
  return localizedDisplay(display.subtitle ?? '', display.subtitleI18n, locale)
}
