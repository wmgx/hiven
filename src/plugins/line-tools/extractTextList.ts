export type TextListKind = 'urls' | 'emails'

const URL_TOKEN = /https?:\/\/[^\s<>"'`\\\u0000-\u001f\u007f-\u009f，。；：！？、（）【】《》“”‘’]+/gi
const EMAIL_TOKEN = /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~@-]+/g
const TRAILING_PUNCTUATION = new Set('.,;:!?')
const BRACKETS: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

/** Remove prose punctuation and excess closing brackets, retaining paired URL brackets. */
function trimUrlToken(token: string): string {
  const counts: Record<string, number> = {}
  for (const character of token) counts[character] = (counts[character] ?? 0) + 1
  let end = token.length
  while (end > 0) {
    const last = token[end - 1]
    const opening = BRACKETS[last]
    if (!TRAILING_PUNCTUATION.has(last) && !(opening && counts[last] > (counts[opening] ?? 0))) break
    counts[last]--
    end--
  }
  return token.slice(0, end)
}

function extractUrls(text: string): string[] {
  const matches: string[] = []
  // A single unambiguous token scan, followed by linear trimming and URL parsing.
  // Never normalize via URL.href: path/query spelling and original case matter.
  for (const match of text.matchAll(URL_TOKEN)) {
    if (match.index > 0 && /[A-Za-z0-9_+.-]/.test(text[match.index - 1])) continue
    // Common prose lists and Markdown URL labels can contain adjacent links.
    // Split only explicit separator + scheme boundaries, not a redirect query.
    for (const part of match[0].split(/[,;](?=https?:\/\/)|\]\((?=https?:\/\/)/gi)) {
      const token = trimUrlToken(part)
      try {
        const url = new URL(token)
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname) matches.push(token)
      } catch { /* Not a syntactically usable HTTP(S) URL. No network validation. */ }
    }
  }
  return matches
}

function quotedLocalRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== '"') continue
    const start = index++
    while (index < text.length && text[index] !== '"' && text[index] !== '\r' && text[index] !== '\n') {
      index += text[index] === '\\' ? 2 : 1
    }
    if (text[index] === '"' && text[index + 1] === '@') ranges.push([start, index + 1])
  }
  return ranges
}

function extractEmails(text: string): string[] {
  const matches: string[] = []
  const quoted = quotedLocalRanges(text)
  let quotedIndex = 0
  for (const match of text.matchAll(EMAIL_TOKEN)) {
    const raw = match[0]
    if (!raw.includes('@')) continue
    while (quotedIndex < quoted.length && quoted[quotedIndex][1] < match.index) quotedIndex++
    if (quotedIndex < quoted.length && quoted[quotedIndex][0] <= match.index) continue
    // Do not salvage an ASCII suffix/prefix from an unsupported Unicode address.
    const before = text.slice(Math.max(0, match.index - 2), match.index)
    const after = text.slice(match.index + raw.length, match.index + raw.length + 2)
    if (/[\p{L}\p{N}\p{M}]$/u.test(before) || /^[\p{L}\p{N}\p{M}]/u.test(after)) continue
    let end = raw.length
    while (end > 0 && raw[end - 1] === '.') end--
    const token = raw.slice(0, end)
    if (token.length > 254) continue
    const at = token.indexOf('@')
    if (at <= 0 || at !== token.lastIndexOf('@') || at > 64) continue
    const local = token.slice(0, at)
    const domain = token.slice(at + 1)
    if (!/^[A-Za-z0-9_+-]+(?:\.[A-Za-z0-9_+-]+)*$/.test(local)) continue
    const labels = domain.split('.')
    if (domain.length > 253 || labels.length < 2 || !/^[A-Za-z]{2,63}$/.test(labels.at(-1)!)) continue
    if (!labels.every((label) => label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) continue
    matches.push(token)
  }
  return matches
}

/**
 * Common text extraction, not reachability/existence validation or full RFC email parsing.
 * URLs require an explicit HTTP(S) scheme. Emails use an ASCII dot-separated local
 * part (letters, digits, +, _, -), DNS labels and a 2–63 letter final domain label.
 * Token scans have no nested ambiguous repetitions; oversized email tokens are
 * rejected before validation. Preserve spelling and encounter order throughout.
 */
export function extractTextList(text: string, kind: TextListKind, dedup = true): string[] {
  const matches = kind === 'urls' ? extractUrls(text) : extractEmails(text)
  if (!dedup) return matches
  const seen = new Set<string>()
  return matches.filter((match) => {
    const at = match.lastIndexOf('@')
    const key = kind === 'emails' ? match.slice(0, at + 1) + match.slice(at + 1).toLowerCase() : match
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
