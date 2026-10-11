import assert from 'node:assert/strict'
import { addUrlParameter, editUrlParameter, parseUrlQuery, removeUrlParameter, serializeUrlQuery, URL_QUERY_MAX_CHARS } from '../src/plugins/json-tools/urlQueryCore.ts'
const source = 'https://Example.test:443/a%2fb?q=hello+world&tag=one&tag=two&empty=&flag&=blank&&encoded=%2f%2F#frag%2f?keep=1'
const parsed = parseUrlQuery(source)
assert.equal(serializeUrlQuery(parsed), source)
assert.equal(parsed.parameters.length, 8)
assert.equal(parsed.parameters[0].value, 'hello world')
assert.equal(parsed.parameters[4].hasEquals, false)
assert.equal(parsed.parameters[3].hasEquals, true)
const edited = editUrlParameter(source, 0, 'value', 'new value & 中文')
assert.equal(edited, source.replace('q=hello+world', 'q=new%20value%20%26%20%E4%B8%AD%E6%96%87'))
assert.equal(editUrlParameter(source, 0, 'value', 'hello world'), source, 'no-op preserves + encoding')
assert.equal(editUrlParameter(source, 1, 'key', 'TAG'), source.replace('tag=one', 'TAG=one'))
assert.equal(editUrlParameter(source, 4, 'key', 'flag2'), source.replace('&flag&', '&flag2&'))
assert.equal(editUrlParameter(source, 4, 'value', 'yes'), source.replace('&flag&', '&flag=yes&'))
assert.equal(removeUrlParameter(source, 1), source.replace('&tag=one', ''))
assert.equal(addUrlParameter('https://x.test/path#anchor'), 'https://x.test/path?=#anchor')
for (const url of ['https://x.test/', 'https://x.test/?', 'https://x.test/?#', 'https://x.test/?&&#x', 'https://x.test/?a=b=c&plus=%2B#top', 'https://x.test/#?not=query', 'https://x.test/?bad=%ZZ&utf8=%FF']) {
  assert.equal(serializeUrlQuery(parseUrlQuery(url)), url)
}
assert.equal(parseUrlQuery('https://x.test/?a=b=c').parameters[0].value, 'b=c')
assert.equal(parseUrlQuery('https://x.test/?bad=%ZZ').parameters[0].validEncoding, false)
assert.equal(editUrlParameter('https://x.test/?bad=%ZZ&ok=%2f#h', 1, 'value', '/'), 'https://x.test/?bad=%ZZ&ok=%2f#h')
assert.equal(editUrlParameter('https://x.test/?bad=%ZZ', 0, 'value', 'literal %'), 'https://x.test/?bad=literal%20%25')
for (const bad of ['/relative?q=1', 'javascript:alert(1)', 'ftp://x.test/?q=1', 'https://', 'https://x.test/a b', 'https://x.test/\n?q=1']) {
  assert.throws(() => parseUrlQuery(bad), { code: 'urlRequired' })
}
assert.throws(() => parseUrlQuery('https://x.test/?' + 'a'.repeat(URL_QUERY_MAX_CHARS)), { code: 'urlTooLarge' })
assert.throws(() => parseUrlQuery('https://x.test/?' + Array(1001).fill('a=1').join('&')), { code: 'urlTooManyParameters' })
assert.throws(() => editUrlParameter('https://x.test/?a=1', 0, 'value', '\ud800'), { code: 'urlInvalidText' })
assert.throws(() => editUrlParameter('https://x.test/?a=1', 0, 'value', '中'.repeat(30_000)), { code: 'urlTooLarge' })
console.log('URL query editor checks passed')
