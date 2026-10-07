import type { DiscoveredApp } from '../launcher/types'

/** Search-only metadata keyed by the unchanged installed-app identity. */
export type AppSearchAliases = Record<string, string[]>

const MAX_ALIASES = 10
const MAX_ALIAS_LENGTH = 80
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

/** Preserve the launcher's existing policy for discovered human names. */
function isInternalAppSearchToken(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return true
  if (v.startsWith('macos:') || v.startsWith('windows:') || v.startsWith('linux:')) return true
  if (v.startsWith('host:app-launcher:')) return true
  if (v.startsWith('/') || v.includes('\\')) return true
  if (v.endsWith('.app') || v.includes('.app/')) return true
  return false
}

function isValidAlias(value: string): boolean {
  if (CONTROL_CHARACTERS.test(value) || isInternalAppSearchToken(value)) return false
  // These are human search names, never URLs, executable paths or internal ids.
  if (value.includes('/') || /^[a-z][a-z\d+.-]*:/i.test(value)) return false
  if (/\.(?:desktop|exe|lnk)$/i.test(value)) return false
  if (/^(?:com|org|net|io|dev|app|edu)\.[a-z\d_-]+(?:\.[a-z\d_-]+)+$/i.test(value)) return false
  return true
}

export type AppSearchAliasInputResult =
  | { ok: true; aliases: string[] }
  | { ok: false; reason: 'too-many' | 'too-long' | 'invalid' }

/** One alias per line; validation is intentionally unrelated to shell parsing. */
export function parseAppSearchAliasInput(text: string): AppSearchAliasInputResult {
  if (typeof text !== 'string') return { ok: false, reason: 'invalid' }
  const aliases: string[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\r\n|\n/)) {
    if (CONTROL_CHARACTERS.test(line)) return { ok: false, reason: 'invalid' }
    const value = line.trim()
    if (!value) continue
    if (Array.from(value).length > MAX_ALIAS_LENGTH) return { ok: false, reason: 'too-long' }
    if (!isValidAlias(value)) return { ok: false, reason: 'invalid' }
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    aliases.push(value)
    if (aliases.length > MAX_ALIASES) return { ok: false, reason: 'too-many' }
  }
  return { ok: true, aliases }
}

/** Persisted input is untrusted: keep valid rows, omit empty or unsafe keys. */
export function normalizeAppSearchAliases(raw: unknown): AppSearchAliases {
  const normalized: AppSearchAliases = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return normalized
  for (const [appId, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(raw))) {
    if (!appId.trim() || appId !== appId.trim() || UNSAFE_KEYS.has(appId) || CONTROL_CHARACTERS.test(appId)) continue
    const values: unknown = descriptor.value
    if (!Array.isArray(values)) continue
    const aliases: string[] = []
    const seen = new Set<string>()
    for (const value of values) {
      if (typeof value !== 'string' || CONTROL_CHARACTERS.test(value)) continue
      const alias = value.trim()
      if (!alias || Array.from(alias).length > MAX_ALIAS_LENGTH || !isValidAlias(alias)) continue
      const key = alias.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      aliases.push(alias)
      if (aliases.length === MAX_ALIASES) break
    }
    if (aliases.length) normalized[appId] = aliases
  }
  return normalized
}

/** Merge search names only; never mutate the app or its discovery/catalog data. */
export function getAppSearchAliases(app: DiscoveredApp, aliasesMap: AppSearchAliases): string[] {
  const userAliases = Object.hasOwn(aliasesMap, app.appId) ? aliasesMap[app.appId] : []
  const values = [app.name, ...Object.values(app.nameI18n ?? {}), ...(app.aliases ?? []), ...userAliases]
  const aliases: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || isInternalAppSearchToken(value)) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    aliases.push(value)
  }
  return aliases
}
