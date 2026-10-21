/**
 * Text Explode tokenizer — splits arbitrary text into selectable fragments.
 *
 * Word/punctuation split is Unicode-aware (\p{L}\p{N}); CJK runs go through
 * Intl.Segmenter (per-character fallback). URLs get their own structural
 * breakdown (origin / path segments / query key-value) so a pasted link can
 * be picked apart instead of staying one opaque blob.
 */

export type TokenType =
  | 'word'
  | 'cjk'
  | 'punct'
  | 'space'
  | 'break'
  | 'url-origin'
  | 'url-seg'
  | 'url-key'
  | 'url-val'
  | 'url-punct'
  | 'url'

export type ExplodeToken = {
  text: string
  /** Original fragment when `text` is a decoded display form (URL parts). */
  raw?: string
  type: TokenType
  /** Shared id for tokens that came from the same URL — lets the UI cluster them. */
  group?: string
}

const CJK_CLASS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}'
const URL_STOP_CHARS = '，。！？、；："\'“”‘’」』'
const URL_TRAILING_PUNCT = new Set(['.', ',', ';', ':', '!', '?', "'", '"'])
const BRACKET_PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }

/** Drops sentence punctuation / unbalanced closing brackets glued to the end of a URL. */
function trimUrlTail(url: string): string {
  let end = url.length
  while (end > 0) {
    const last = url[end - 1]!
    if (URL_TRAILING_PUNCT.has(last)) {
      end -= 1
      continue
    }
    const open = BRACKET_PAIRS[last]
    if (open) {
      const body = url.slice(0, end)
      const opens = body.split(open).length - 1
      const closes = body.split(last).length - 1
      if (closes > opens) {
        end -= 1
        continue
      }
    }
    break
  }
  return url.slice(0, end)
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Display text is decoded when possible; `raw` keeps the original fragment for reassembly. */
function urlPart(raw: string, type: TokenType, group: string): ExplodeToken {
  return { text: safeDecode(raw), raw, type, group }
}

function urlToTokens(urlText: string, groupId: string): ExplodeToken[] {
  const originMatch = /^(https?:\/\/[^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/s.exec(urlText)
  if (!originMatch) return [{ text: urlText, type: 'url', group: groupId }]
  const [, origin, path = '', query, hash] = originMatch

  const out: ExplodeToken[] = [{ text: origin!, type: 'url-origin', group: groupId }]

  path
    .split('/')
    .slice(1)
    .forEach((segment) => {
      out.push({ text: '/', type: 'url-punct', group: groupId })
      if (segment) out.push(urlPart(segment, 'url-seg', groupId))
    })

  if (query !== undefined) {
    out.push({ text: '?', type: 'url-punct', group: groupId })
    query.split('&').forEach((pair, index) => {
      if (index > 0) out.push({ text: '&', type: 'url-punct', group: groupId })
      if (!pair) return
      const eq = pair.indexOf('=')
      const key = eq === -1 ? pair : pair.slice(0, eq)
      if (key) out.push(urlPart(key, 'url-key', groupId))
      if (eq !== -1) {
        out.push({ text: '=', type: 'url-punct', group: groupId })
        const value = pair.slice(eq + 1)
        if (value) out.push(urlPart(value, 'url-val', groupId))
      }
    })
  }

  if (hash !== undefined) {
    out.push({ text: '#', type: 'url-punct', group: groupId })
    if (hash) out.push(urlPart(hash, 'url-seg', groupId))
  }

  return out
}

function segmentCjkRun(run: string): string[] {
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') return Array.from(run)
  const locale = /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(run) ? 'ja' : 'zh'
  try {
    return Array.from(new Intl.Segmenter(locale, { granularity: 'word' }).segment(run), (part) => part.segment)
  } catch {
    return Array.from(run)
  }
}

const WORD_CHAR = `(?:(?![${CJK_CLASS}])[\\p{L}\\p{N}\\p{M}_])`

export function tokenize(text: string): ExplodeToken[] {
  const pattern = new RegExp(
    `(https?://[^\\s${URL_STOP_CHARS}]+)` + // 1: url
      `|(${WORD_CHAR}+(?:[.@:/-]${WORD_CHAR}+)*)` + // 2: word
      `|([${CJK_CLASS}]+)` + // 3: cjk run
      '|(\\n)' + // 4: line break
      '|(\\s+)' + // 5: space run
      '|(\\S)', // 6: single punctuation char
    'gu',
  )

  const tokens: ExplodeToken[] = []
  let urlGroupCounter = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match[1]) {
      const trimmed = trimUrlTail(match[1])
      pattern.lastIndex = match.index + trimmed.length
      if (trimmed.length === 0) continue
      urlGroupCounter += 1
      tokens.push(...urlToTokens(trimmed, `url-${urlGroupCounter}`))
    } else if (match[2]) {
      tokens.push({ text: match[2], type: 'word' })
    } else if (match[3]) {
      for (const piece of segmentCjkRun(match[3])) tokens.push({ text: piece, type: 'cjk' })
    } else if (match[4]) {
      tokens.push({ text: match[4], type: 'break' })
    } else if (match[5]) {
      tokens.push({ text: match[5], type: 'space' })
    } else if (match[6]) {
      tokens.push({ text: match[6], type: 'punct' })
    }
  }

  return tokens
}

/**
 * Reassembles selected token indices (original document order) into text.
 * Directly-adjacent tokens concatenate with no gap; tokens separated only by
 * original whitespace keep that whitespace (including blank lines); anything
 * else (a skipped chip in between) gets one plain space so the result stays readable.
 */
export function assembleFromSelection(tokens: ExplodeToken[], selected: ReadonlySet<number>): string {
  const selectedIndexes = [...selected].sort((a, b) => a - b)
  let out = ''

  for (let i = 0; i < selectedIndexes.length; i++) {
    const idx = selectedIndexes[i]
    if (i > 0) {
      const prev = selectedIndexes[i - 1]
      const between = tokens.slice(prev + 1, idx)
      out += between.every((token) => token.type === 'space' || token.type === 'break')
        ? between.map((token) => token.raw ?? token.text).join('')
        : ' '
    }
    out += tokens[idx].raw ?? tokens[idx].text
  }

  return out
}

export function isSelectableToken(type: TokenType): boolean {
  return type !== 'space' && type !== 'break'
}
