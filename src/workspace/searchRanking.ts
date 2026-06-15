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

function localizedText(text: string, i18nMap: Partial<Record<Locale, string>> | undefined, locale: Locale): string {
  return i18nMap?.[locale] ?? text
}

export function getAcronym(name: string): string {
  return name.split(/[-_\s.]+/).filter(Boolean).map((word) => word[0]).join('')
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

  return cached.full.includes(query) || cached.initials.startsWith(query)
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

export function searchableFieldsMatch(fields: SearchableFields, q: string, locale: Locale): boolean {
  const id = fields.id.toLowerCase()
  const title = localizedText(fields.title || fields.id, fields.titleI18n, locale).toLowerCase()

  if (id.includes(q) || title.includes(q)) return true
  if (Object.values(fields.titleI18n || {}).some((value) => value && value.toLowerCase().includes(q))) return true

  const description = fields.description || ''
  if (description.toLowerCase().includes(q)) return true
  if (Object.values(fields.descriptionI18n || {}).some((value) => value && value.toLowerCase().includes(q))) return true

  if ((fields.aliases ?? []).some((alias) => {
    const normalized = alias.toLowerCase()
    return normalized.includes(q) || pinyinMatch(alias, q) || mixedAcronymMatch(alias, q)
  })) return true
  if (getAcronym(id).startsWith(q)) return true
  if (getAcronym((fields.title || fields.id).toLowerCase()).startsWith(q)) return true

  const zhTitle = fields.titleI18n?.zh ?? ''
  const zhDescription = fields.descriptionI18n?.zh ?? ''
  if (pinyinMatch(zhTitle || title, q)) return true
  if (zhDescription && pinyinMatch(zhDescription, q)) return true

  if (mixedAcronymMatch(fields.title || fields.id, q)) return true
  if (zhTitle && mixedAcronymMatch(zhTitle, q)) return true

  return false
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

  const id = fields.id.toLowerCase()
  const title = localizedText(fields.title || fields.id, fields.titleI18n, locale).toLowerCase()

  let tier = 1
  if (id === q || title === q || (fields.aliases ?? []).some((alias) => alias.toLowerCase() === q)) {
    tier = 6
  } else if (id.startsWith(q) || (fields.aliases ?? []).some((alias) => alias.toLowerCase().startsWith(q))) {
    tier = 5
  } else if (title.startsWith(q)) {
    tier = 4
  } else {
    const idWords = id.split(/[-_\s.]+/).filter(Boolean)
    const titleWords = title.split(/[-_\s]+/).filter(Boolean)
    if (idWords.some((word) => word.startsWith(q)) || titleWords.some((word) => word.startsWith(q))) {
      tier = 3
    } else if (getAcronym(id).startsWith(q) || getAcronym((fields.title || fields.id).toLowerCase()).startsWith(q)) {
      tier = 2
    }
  }

  return tier * 1000 + baseScore
}
