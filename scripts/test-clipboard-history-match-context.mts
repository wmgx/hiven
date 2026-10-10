/** Run the production display helper without reading actual clipboard history. */
import assert from 'node:assert/strict'
import {
  CLIPBOARD_HISTORY_MATCH_LIMITS as limits,
  getClipboardHistoryMatchContext as context,
  getClipboardHistoryMatchSnippet as snippet,
} from '../src/plugins/clipboard-history/surfaces/clipboardHistoryMatchContext.ts'
import { matchesClipboardHistorySearch } from '../src/plugins/clipboard-history/storage/clipboardHistorySearch.ts'

const textItem = (text: string) => ({
  id: 'synthetic-match', kind: 'text' as const, hash: 'synthetic',
  firstCopiedAt: 1, lastCopiedAt: 1, copyCount: 1, byteSize: text.length,
  preview: text.slice(0, 200), text,
})

function verifySource(text: string, query: string) {
  const result = context(text, query)
  assert.equal(result.segments.map((part) => part.text).join(''), text, 'display decoration preserves every original character')
  let offset = 0
  const boundaries = new Set([0, text.length])
  for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) {
    boundaries.add(part.index)
  }
  for (const part of result.segments) {
    assert.equal(part.start, offset, 'segments stay ordered and contiguous')
    assert.equal(part.text, text.slice(part.start, part.end), 'offsets address the original source')
    assert.ok(boundaries.has(part.start) && boundaries.has(part.end), 'segment edges are whole graphemes')
    offset = part.end
  }
  assert.ok(result.segments.filter((part) => part.match).length <= limits.maxMatches)
  assert.ok(result.segments.length <= limits.maxMatches * 2 + 1)
  return result
}

// Real regression: the index/head looks identical; the only hit is line 22.
const lines = Array.from({ length: 32 }, (_, index) =>
  `Line ${index + 1}: ${index === 21 ? 'hivenneedle6410' : 'synthetic ordinary clipboard reading text'}`)
const longText = lines.join('\r\n')
const firstHit = longText.indexOf('hivenneedle6410')
assert.ok(firstHit > 200)
const longResult = verifySource(longText, '  HIVENNEEDLE6410  ')
assert.equal(longResult.firstMatchOffset, firstHit)
assert.deepEqual(longResult.segments.filter((part) => part.match).map((part) => part.text), ['hivenneedle6410'])
const excerpt = snippet(longText, 'hivenneedle6410')!
assert.ok(excerpt.includes('hivenneedle6410'))
assert.ok(excerpt.indexOf('hivenneedle6410') <= limits.snippetLeadingContext + 1)
assert.ok(excerpt.startsWith('…') && excerpt.endsWith('…'))
assert.ok(excerpt.length <= limits.snippetLength + 2)

// Preserve the exact storage search semantics: no regex, accent folding, NFKC,
// locale-specific casing, tokenization or whitespace normalization.
const cases: Array<[string, string, boolean]> = [
  ['Literal a.*[x]?\\ and more', 'a.*[x]?\\', true],
  ['ordinary text', '.*', false],
  ['Hello world', ' HELLO ', true],
  ['one\r\ntwo', 'one\r\ntwo', true],
  ['one\r\ntwo', 'one two', false],
  ['café', 'cafe', false],
  ['cafe\u0301', 'café', false],
  ['ＡＢＣ', 'abc', false],
  ['Straße', 'STRASSE', false],
  ['ΟΣ', 'ος', true],
  ['ΟΣ', 'οσ', false],
  ['𐐀 test', '𐐨', true],
  ['İstanbul I İ', 'i', true],
  ['İstanbul I İ', '\u0307', true],
  ['emoji 👩🏽‍💻 flag 🇨🇳', '💻', true],
  ['emoji 👩🏽‍💻 flag 🇨🇳', '🇨', true],
  ['composed e\u0301 more', 'e', true],
]
for (const [text, query, expected] of cases) {
  assert.equal(matchesClipboardHistorySearch(textItem(text), query), expected)
  const result = verifySource(text, query)
  assert.equal(result.firstMatchOffset !== null, expected, `display agrees with literal storage search: ${JSON.stringify(query)}`)
}
assert.deepEqual(context('İ x I İ', 'i').segments.filter((part) => part.match).map(({ start, end }) => [start, end]), [[0, 1], [4, 5], [6, 7]])
assert.equal(context('İ hidden marker', 'marker').firstMatchOffset, 'İ hidden '.length, 'lower-case expansion before a hit does not shift its source offset')
assert.equal(context('e\u0301', '\u0301').firstMatchOffset, 0, 'an inner combining-mark hit anchors the whole visible grapheme')
assert.equal(context('👩🏽‍💻', '💻').segments[0].text, '👩🏽‍💻')

// Null/undefined are the explicit boundary for hidden or unavailable display
// text; the helper takes no history item or raw payload to recover around it.
for (const text of [null, undefined, '']) {
  assert.deepEqual(context(text, 'synthetic-secret'), { segments: [], firstMatchOffset: null })
  assert.equal(snippet(text, 'synthetic-secret'), null)
}
for (const query of ['', ' \r\n ', 'absent']) {
  assert.equal(snippet(longText, query), null, 'no snippet preserves the existing title')
  const result = verifySource(longText, query)
  assert.equal(result.firstMatchOffset, null)
  assert.deepEqual(result.segments, [{ text: longText, start: 0, end: longText.length, match: false }])
}

// Markup is returned solely as original strings for React text rendering.
const hostile = '<img src=x onerror="alert(1)"><script>synthetic</script>&lt;script&gt;'
const hostileResult = verifySource(hostile, '<script>')
assert.equal(hostileResult.segments.find((part) => part.match)?.text, '<script>')
assert.equal(snippet(hostile, '<img'), hostile)
assert.ok(snippet(hostile, '<script>')?.includes('<script>synthetic</script>'))

// Search work and mark count are bounded without shortening the readable body.
const manyHits = 'hit '.repeat(1000)
const bounded = verifySource(manyHits, 'hit')
assert.equal(bounded.segments.filter((part) => part.match).length, limits.maxMatches)
assert.ok(bounded.segments.at(-1)?.text.endsWith('hit '))
assert.equal(bounded.segments.at(-1)?.match, false)
const overBudget = 'hit ' + 'x'.repeat(limits.maxTextLength)
const oversizedResult = context(overBudget, 'hit')
assert.deepEqual(oversizedResult, {
  segments: [{ text: overBudget, start: 0, end: overBudget.length, match: false }],
  firstMatchOffset: null,
})
assert.equal(snippet(overBudget, 'hit'), null, 'oversized inputs fall back without an invented match location')
assert.equal(context('hit', ' '.repeat(limits.maxQueryLength) + 'hit').firstMatchOffset, null)
const largeMatch = 'x'.repeat(limits.snippetLength + 1)
assert.equal(context(largeMatch, largeMatch).firstMatchOffset, 0)
assert.equal(snippet(largeMatch, largeMatch), null, 'an oversized match cannot force an unbounded excerpt')

// Excerpt boundaries keep combining sequences, surrogate pairs and ZWJ emoji
// whole even when the byte-like budget lands inside one of them.
for (const glyph of ['e\u0301', '😀', '👩🏽‍💻', '🇨🇳']) {
  const text = `${glyph.repeat(100)}needle${glyph.repeat(100)}`
  const actual = snippet(text, 'needle')!
  assert.ok(actual.includes('needle'))
  assert.ok(actual.length <= limits.snippetLength + 2)
  const slice = actual.replace(/^…|…$/g, '')
  const [before, after] = slice.split('needle')
  assert.equal(before, glyph.repeat(before.length / glyph.length), 'left boundary keeps a complete grapheme')
  assert.equal(after, glyph.repeat(after.length / glyph.length), 'right boundary keeps a complete grapheme')
}
const enormousGrapheme = 'e' + '\u0301'.repeat(limits.snippetLength * 2)
assert.equal(snippet(enormousGrapheme, 'e'), null)
assert.equal(verifySource(enormousGrapheme, '\u0301').segments.length, 1)

// Display derivation cannot mutate the original item or delivery string.
const item = Object.freeze({ ...textItem(longText), favoriteTitle: 'My saved title' })
const before = JSON.stringify(item)
context(item.text, 'hivenneedle6410')
snippet(item.text, 'hivenneedle6410')
assert.equal(JSON.stringify(item), before)
assert.equal(item.favoriteTitle, 'My saved title')

// Older webviews preserve the original display when safe segmentation is absent.
const originalSegmenter = Intl.Segmenter
try {
  Object.defineProperty(Intl, 'Segmenter', { value: undefined, configurable: true, writable: true })
  const fallback = await import('../src/plugins/clipboard-history/surfaces/clipboardHistoryMatchContext.ts?without-segmenter')
  assert.deepEqual(fallback.getClipboardHistoryMatchContext('e\u0301 👩🏽‍💻', '💻'), {
    segments: [{ text: 'e\u0301 👩🏽‍💻', start: 0, end: 'e\u0301 👩🏽‍💻'.length, match: false }],
    firstMatchOffset: null,
  })
  assert.equal(fallback.getClipboardHistoryMatchSnippet('e\u0301 👩🏽‍💻', '💻'), null)
} finally {
  Object.defineProperty(Intl, 'Segmenter', { value: originalSegmenter, configurable: true, writable: true })
}

console.log('Clipboard History match context passed: deep hits, literal semantics, Unicode, display privacy boundary, exact text and bounded work')

const readableRow = snippet('上一行不应占据摘要空间\n第22行：hivenneedle6410 目标内容', 'hivenneedle6410')!
assert.ok(readableRow.startsWith('…第22行：hivenneedle6410'), 'the match line takes priority over unrelated preceding lines')
