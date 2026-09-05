/**
 * Text Explode tokenizer — splits arbitrary text into selectable fragments.
 *
 * Word/punctuation split is regex-based (no CJK dictionary segmentation yet;
 * CJK runs fall back to per-character tokens). URLs get their own structural
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
  type: TokenType
  /** Shared id for tokens that came from the same URL — lets the UI cluster them. */
  group?: string
}

const CJK_RANGE = '一-鿿'
const URL_STOP_CHARS = '，。！？、；："\'“”‘’」』'

function urlToTokens(urlText: string, groupId: string): ExplodeToken[] {
  let url: URL
  try {
    url = new URL(urlText)
  } catch {
    return [{ text: urlText, type: 'url', group: groupId }]
  }

  const out: ExplodeToken[] = [{ text: url.protocol + '//' + url.host, type: 'url-origin', group: groupId }]

  url.pathname
    .split('/')
    .filter(Boolean)
    .forEach((segment) => {
      out.push({ text: '/', type: 'url-punct', group: groupId })
      out.push({ text: decodeURIComponent(segment), type: 'url-seg', group: groupId })
    })

  if (url.search) {
    out.push({ text: '?', type: 'url-punct', group: groupId })
    const params = [...url.searchParams.entries()]
    params.forEach(([key, value], index) => {
      if (index > 0) out.push({ text: '&', type: 'url-punct', group: groupId })
      out.push({ text: key, type: 'url-key', group: groupId })
      if (value !== '') {
        out.push({ text: '=', type: 'url-punct', group: groupId })
        out.push({ text: value, type: 'url-val', group: groupId })
      }
    })
  }

  if (url.hash) {
    out.push({ text: '#', type: 'url-punct', group: groupId })
    out.push({ text: url.hash.slice(1), type: 'url-seg', group: groupId })
  }

  return out
}

export function tokenize(text: string): ExplodeToken[] {
  const pattern = new RegExp(
    `(https?://[^\\s${URL_STOP_CHARS}]+)` + // 1: url
      '|([A-Za-z0-9_]+(?:[.@:/-][A-Za-z0-9_]+)*)' + // 2: word
      `|([${CJK_RANGE}]+)` + // 3: cjk run
      '|(\\n)' + // 4: line break
      '|(\\s+)' + // 5: space run
      `|([^\\sA-Za-z0-9_${CJK_RANGE}])`, // 6: single punctuation char
    'g',
  )

  const tokens: ExplodeToken[] = []
  let urlGroupCounter = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    if (match[1]) {
      urlGroupCounter += 1
      tokens.push(...urlToTokens(match[1], `url-${urlGroupCounter}`))
    } else if (match[2]) {
      tokens.push({ text: match[2], type: 'word' })
    } else if (match[3]) {
      for (const char of match[3]) tokens.push({ text: char, type: 'cjk' })
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
 * a single original whitespace run keep that whitespace; anything else
 * (a skipped chip in between) gets one plain space so the result stays readable.
 */
export function assembleFromSelection(tokens: ExplodeToken[], selected: ReadonlySet<number>): string {
  const selectedIndexes = [...selected].sort((a, b) => a - b)
  let out = ''

  for (let i = 0; i < selectedIndexes.length; i++) {
    const idx = selectedIndexes[i]
    if (i > 0) {
      const prev = selectedIndexes[i - 1]
      if (idx === prev + 1) {
        // originally adjacent — no separator
      } else if (idx === prev + 2 && tokens[prev + 1]?.type === 'space') {
        out += tokens[prev + 1].text
      } else {
        out += ' '
      }
    }
    out += tokens[idx].text
  }

  return out
}

export function isSelectableToken(type: TokenType): boolean {
  return type !== 'space' && type !== 'break'
}
