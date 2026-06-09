/**
 * React bindings for the unified i18n system.
 *
 * Provides:
 *   - I18nNamespaceContext: Context for auto-injecting namespace (used by plugin hosts)
 *   - I18nNamespaceProvider: Provider component
 *   - useT(namespace?): The single public Hook for all translation needs
 */

import { createContext, useContext, useMemo } from 'react'
import { useAppStore } from '../store'
import { translate, type Locale } from './registry'

// ─── Context ──────────────────────────────────────────────────────────────────

const I18nNamespaceContext = createContext<string | null>(null)

export const I18nNamespaceProvider = I18nNamespaceContext.Provider

// ─── Hook ─────────────────────────────────────────────────────────────────────

export type TranslateFunction = (key: string, vars?: Record<string, string | number>) => string

/**
 * Unified translate hook.
 *
 * Usage:
 *   - System components: `const t = useT('settings')` — explicit namespace
 *   - Plugin components: `const t = useT()` — reads namespace from Context
 *
 * Automatically subscribes to locale changes in the store.
 */
export function useT(namespace?: string): TranslateFunction {
  const locale: Locale = useAppStore((s) => s.locale)
  const contextNamespace = useContext(I18nNamespaceContext)
  const resolvedNamespace = namespace ?? contextNamespace

  if (!resolvedNamespace) {
    throw new Error(
      'useT(): no namespace provided and no I18nNamespaceProvider found in the tree. ' +
      'System components must pass a namespace argument; plugin components must be wrapped in I18nNamespaceProvider.',
    )
  }

  return useMemo(
    () => (key: string, vars?: Record<string, string | number>) =>
      translate(locale, resolvedNamespace, key, vars),
    [locale, resolvedNamespace],
  )
}
