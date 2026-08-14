/**
 * Locale-branch helper. Replaces scattered inline zh-locale checks with one
 * auditable choke point, and correctly treats every Chinese locale
 * (zh, zh-CN, zh-TW) as Chinese.
 *
 * Use for runtime bilingual DATA selection (e.g. `{ zh, en }` fields) and
 * ephemeral host strings. For durable UI copy, prefer dictionary keys via
 * `t(locale, key)` / `useT`.
 */
import type { Locale } from './registry'

/** True for any Chinese locale (zh, zh-CN, zh-TW, …). */
export function isZh(locale: Locale | string | null | undefined): boolean {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
}

/** Pick the Chinese value for Chinese locales, otherwise the fallback value. */
export function pickLocale<T>(locale: Locale | string | null | undefined, zh: T, en: T): T {
  return isZh(locale) ? zh : en
}
