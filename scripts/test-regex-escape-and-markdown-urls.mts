import assert from 'node:assert/strict'
import { escapeRegexPattern } from '../src/plugins/line-tools/escapeRegexPattern.ts'
import { extractTextList } from '../src/plugins/line-tools/extractTextList.ts'

assert.equal(escapeRegexPattern('a.b'), 'a\\.b')
assert.equal(escapeRegexPattern(''), '')
assert.equal(escapeRegexPattern('\\n\n\r\t/'), '\\\\n\\n\\r\\t\\/')
const samples = ['^$.*+?()[]{}|\\/', 'a-b = [x]', '中文🙂 café', '\u2028\u2029\x00\f\v', '\\1 literal', 'line one\r\nline two', '\ud800 lone surrogate']
for (const sample of samples) {
  const pattern = escapeRegexPattern(sample)
  // Tests alone compile the generated literal to prove exact matching. Product
  // code is string transformation and never invokes RegExp on user material.
  assert.equal(new RegExp(`^(?:${pattern})$`, 'u').test(sample), true, JSON.stringify(sample))
  assert.equal(new RegExp(`^(?:${pattern})$`, 'u').test(`extra${sample}`), false)
}

const markdown = [
  'Before https://plain.example/a_(b).',
  '[https://label.example](https://target.example/a(b) "https://title.example")',
  '![https://alt.example](https://image.example/a.png "https://image-title.example")',
  '<https://auto.example/path?q=1&x=2>',
  '[again][id] and [again][id]',
  '[https://bad-label.example](javascript:alert(1) "https://bad-title.example")',
  '[id]: https://ref.example/path "https://ref-title.example"',
].join('\n\n')
assert.deepEqual(extractTextList(markdown, 'urls'), [
  'https://plain.example/a_(b)', 'https://target.example/a(b)', 'https://image.example/a.png',
  'https://auto.example/path?q=1&x=2', 'https://ref.example/path', 'https://ref.example/path',
])
assert.deepEqual(extractTextList('[a](<https://example.com/a?> "https://not-target.example")', 'urls'), ['https://example.com/a?'], 'explicit destinations retain punctuation')
assert.deepEqual(extractTextList('ftp://example.com file:///tmp/a data:text/html,hi javascript:alert(1) mailto:a@example.com', 'urls'), [])
assert.deepEqual(extractTextList('http://example.com/a http://example.com/a', 'urls'), ['http://example.com/a', 'http://example.com/a'])
assert.deepEqual(extractTextList('http://example.com/a http://example.com/a', 'urls', true), ['http://example.com/a'])
const long = 'https://example.com/' + 'a'.repeat(100_000)
assert.equal(extractTextList(`${long}\nhttps://end.example`, 'urls')[0], long, 'full destinations, not previews')
assert.deepEqual(extractTextList('No matching links', 'urls'), [])
console.log('regex escape and Markdown URL logic passed')
