import type { AiGlossary, LanguageCode } from '../settings/model'

export const GLOSSARY_LANGUAGES: readonly LanguageCode[] = ['zh', 'en', 'ja', 'ko', 'fr', 'de', 'es']
export const GLOSSARY_LIMITS = { entries: 20, termCharacters: 80, bytes: 8192 } as const

export type AiGlossaryIssue = {
  code: 'shape' | 'language' | 'entries' | 'empty' | 'characters' | 'control' | 'duplicate' | 'conflict' | 'bytes'
  row?: number
}
export type AiGlossaryValidation = { ok: true; value?: AiGlossary } | { ok: false; issue: AiGlossaryIssue }

function hasControlCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

/** Normalize only explicit saved input. Never truncate, learn, or infer entries. */
export function validateAiGlossary(input: unknown): AiGlossaryValidation {
  if (input === undefined) return { ok: true }
  if (!input || typeof input !== 'object') return { ok: false, issue: { code: 'shape' } }
  const candidate = input as { targetLang?: unknown; entries?: unknown }
  if (!Array.isArray(candidate.entries)) return { ok: false, issue: { code: 'shape' } }
  if (candidate.entries.length === 0) return { ok: true }
  if (!GLOSSARY_LANGUAGES.includes(candidate.targetLang as LanguageCode)) return { ok: false, issue: { code: 'language' } }
  if (candidate.entries.length > GLOSSARY_LIMITS.entries) return { ok: false, issue: { code: 'entries' } }
  const entries: AiGlossary['entries'] = []
  const sources = new Map<string, string>()
  for (const [index, entry] of candidate.entries.entries()) {
    const row = index + 1
    if (!entry || typeof entry !== 'object' || typeof entry.source !== 'string' || typeof entry.target !== 'string') {
      return { ok: false, issue: { code: 'shape', row } }
    }
    const source = entry.source.trim().normalize('NFC')
    const target = entry.target.trim().normalize('NFC')
    if (!source || !target) return { ok: false, issue: { code: 'empty', row } }
    if (Array.from(source).length > GLOSSARY_LIMITS.termCharacters || Array.from(target).length > GLOSSARY_LIMITS.termCharacters) {
      return { ok: false, issue: { code: 'characters', row } }
    }
    if (hasControlCharacter(source) || hasControlCharacter(target)) {
      return { ok: false, issue: { code: 'control', row } }
    }
    const previous = sources.get(source)
    if (previous !== undefined) return { ok: false, issue: { code: previous === target ? 'duplicate' : 'conflict', row } }
    sources.set(source, target)
    entries.push({ source, target })
  }
  const value: AiGlossary = { targetLang: candidate.targetLang as LanguageCode, entries }
  if (new TextEncoder().encode(JSON.stringify(value)).length > GLOSSARY_LIMITS.bytes) return { ok: false, issue: { code: 'bytes' } }
  return { ok: true, value }
}

export class AiGlossaryValidationError extends Error {
  readonly issue: AiGlossaryIssue

  constructor(issue: AiGlossaryIssue) {
    super('Saved AI translation terms are invalid')
    this.name = 'AiGlossaryValidationError'
    this.issue = issue
  }
}
