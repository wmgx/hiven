import { pinyin } from 'pinyin-pro'
import type { Locale } from '../i18n'

export type SearchableFields = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  aliases?: string[]
  usageKey?: string
}

/**
 * Queries shorter than this only match token prefixes / acronyms / pinyin initials.
 * Arbitrary mid-token substring (`base`/`session`/`clause` containing `se`) is disabled.
 */
const SUBSTRING_MIN_QUERY_LENGTH = 3

function localizedText(text: string, i18nMap: Partial<Record<Locale, string>> | undefined, locale: Locale): string {
  return i18nMap?.[locale] ?? text
}

export function getAcronym(name: string): string {
  return name.split(/[-_\s.]+/).filter(Boolean).map((word) => word[0]).join('')
}

function tokenizeSearchText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean)
}

function allowMidTokenSubstring(query: string): boolean {
  return query.length >= SUBSTRING_MIN_QUERY_LENGTH
}

/** Token/word prefix: "se" → settings; not base64. */
export function tokenPrefixMatch(text: string, query: string): boolean {
  if (!text || !query) return false
  const q = query.toLowerCase()
  const lower = text.toLowerCase()
  if (lower.startsWith(q)) return true
  return tokenizeSearchText(lower).some((token) => token.startsWith(q))
}

const pinyinCache = new Map<string, { full: string; initials: string }>()
const mixedAcronymCache = new Map<string, string>()

export function pinyinMatch(text: string, query: string): boolean {
  if (!text || !query) return false
  if (!/^[a-z]+$/.test(query)) return false

  let cached = pinyinCache.get(text)
  if (!cached) {
    const full = pinyin(text, { toneType: 'none', separator: '' }).toLowerCase()
    const initials = pinyin(text, { pattern: 'initial', toneType: 'none', separator: '' }).toLowerCase()
    cached = { full, initials }
    pinyinCache.set(text, cached)
  }

  // Initials are always prefix-based (sz for 设置).
  if (cached.initials.startsWith(query)) return true

  // Full pinyin: short queries only allow prefix (avoid base64 → "se").
  if (allowMidTokenSubstring(query)) {
    return cached.full.includes(query)
  }
  return cached.full.startsWith(query)
}

export function mixedAcronymMatch(text: string, query: string): boolean {
  if (!text || !query) return false
  if (!/^[a-z]+$/.test(query)) return false

  let cached = mixedAcronymCache.get(text)
  if (!cached) {
    const words = text.split(/[-_\s.]+/).filter(Boolean)
    cached = words.map((word) => {
      if (/[一-鿿]/.test(word[0])) {
        return pinyin(word, { pattern: 'initial', toneType: 'none', separator: '' }).toLowerCase()
      }
      return word[0].toLowerCase()
    }).join('')
    mixedAcronymCache.set(text, cached)
  }

  return cached.startsWith(query)
}

/** Match one human-readable string against the normalized query. */
function fieldTextMatches(text: string, query: string): boolean {
  if (!text) return false

  if (allowMidTokenSubstring(query)) {
    if (text.toLowerCase().includes(query)) return true
  } else if (tokenPrefixMatch(text, query)) {
    return true
  }

  if (pinyinMatch(text, query)) return true
  if (mixedAcronymMatch(text, query)) return true
  if (getAcronym(text.toLowerCase()).startsWith(query)) return true
  return false
}

/**
 * Whether a launcher/plugin row matches the query.
 *
 * Intentionally does NOT match:
 * - internal `id` / systemKey (path hashes, host:view:settings substrings)
 * - description / subtitle (hidden English copy like "session", "clause")
 * - every locale's title at once (only current locale title + intentional aliases)
 */
export function searchableFieldsMatch(fields: SearchableFields, q: string, locale: Locale): boolean {
  const query = q.trim().toLowerCase()
  if (!query) return true

  const title = localizedText(fields.title || '', fields.titleI18n, locale)
  if (fieldTextMatches(title, query)) return true

  for (const alias of fields.aliases ?? []) {
    if (fieldTextMatches(alias, query)) return true
  }

  // Pinyin for Chinese catalog name when UI locale shows a different title.
  const zhTitle = fields.titleI18n?.zh ?? ''
  if (zhTitle && zhTitle !== title) {
    if (pinyinMatch(zhTitle, query) || mixedAcronymMatch(zhTitle, query)) return true
  }

  return false
}

// ─── Match Ranges (pure data for rendering) ─────────────────────────────────

export type MatchRange = { start: number; end: number }

export type MatchType = 'substring' | 'pinyin' | 'acronym' | 'none'

export type MatchResult = {
  ranges: MatchRange[]
  type: MatchType
}

/**
 * Compute match ranges for a title string against the query.
 * Returns the first matching substring range, or pinyin/acronym indicator.
 * Ranges are indices into the `title` string as displayed.
 */
export function computeTitleMatchRanges(title: string, q: string, locale: Locale): MatchResult {
  void locale
  if (!q) return { ranges: [], type: 'none' }

  const lowerTitle = title.toLowerCase()
  const lowerQ = q.trim().toLowerCase()
  if (!lowerQ) return { ranges: [], type: 'none' }

  // Short queries: only highlight token-prefix hits (not mid-token "se" in Base64).
  if (!allowMidTokenSubstring(lowerQ)) {
    if (lowerTitle.startsWith(lowerQ)) {
      return { ranges: [{ start: 0, end: lowerQ.length }], type: 'substring' }
    }
    const tokenRe = /[a-z0-9\u4e00-\u9fff]+/gi
    let match: RegExpExecArray | null
    while ((match = tokenRe.exec(title)) !== null) {
      if (match[0].toLowerCase().startsWith(lowerQ)) {
        return {
          ranges: [{ start: match.index, end: match.index + lowerQ.length }],
          type: 'substring',
        }
      }
    }
  } else {
    const idx = lowerTitle.indexOf(lowerQ)
    if (idx !== -1) {
      return { ranges: [{ start: idx, end: idx + lowerQ.length }], type: 'substring' }
    }
  }

  // Pinyin / acronym indicators (no character ranges)
  if (/^[a-z]+$/.test(lowerQ)) {
    if (pinyinMatch(title, lowerQ)) {
      return { ranges: [], type: 'pinyin' }
    }
    const acronym = getAcronym(lowerTitle)
    if (acronym.startsWith(lowerQ) || mixedAcronymMatch(title, lowerQ)) {
      return { ranges: [], type: acronym.startsWith(lowerQ) ? 'acronym' : 'pinyin' }
    }
  }

  return { ranges: [], type: 'none' }
}

export function scoreSearchableFields(
  fields: SearchableFields,
  q: string,
  locale: Locale,
  recentNames: string[],
  usageCounts: Record<string, number>,
): number {
  const usageKey = fields.usageKey ?? fields.id
  const recentIdx = recentNames.indexOf(usageKey)
  const recencyScore = recentIdx >= 0 ? 50 - recentIdx : 0
  const freqScore = Math.log1p(usageCounts[usageKey] ?? 0) * 5
  const baseScore = recencyScore + freqScore

  if (!q) return baseScore

  const query = q.trim().toLowerCase()
  const title = localizedText(fields.title || '', fields.titleI18n, locale).toLowerCase()
  const aliases = (fields.aliases ?? []).map((alias) => alias.toLowerCase())

  let tier = 1
  if (title === query || aliases.some((alias) => alias === query)) {
    tier = 6
  } else if (aliases.some((alias) => alias.startsWith(query))) {
    tier = 5
  } else if (title.startsWith(query)) {
    tier = 4
  } else {
    const titleWords = tokenizeSearchText(title)
    if (titleWords.some((word) => word.startsWith(query)) || aliases.some((alias) => tokenPrefixMatch(alias, query))) {
      tier = 3
    } else if (getAcronym(title).startsWith(query) || mixedAcronymMatch(title, query) || pinyinMatch(title, query)) {
      tier = 2
    }
  }

  return tier * 1000 + baseScore
}
