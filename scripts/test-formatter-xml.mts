import assert from 'node:assert/strict'
import { formatText, processFormatter } from '../src/plugins/formatter/core.ts'
import { formatXml, XmlFormatterError } from '../src/plugins/formatter/xml.ts'

// Node has no DOMParser. These known-valid fixtures exercise the actual lexical
// formatter with a controlled validation boundary; they do not test XML grammar.
const validatedFixture = () => {}
const format = (source: string) => formatXml(source, 'format', validatedFixture)
const compact = (source: string) => formatXml(source, 'compact', validatedFixture)

assert.equal(format('<r><a>1</a></r>'), '<r>\n  <a>1</a>\n</r>')
assert.equal(format('<r><a><b>1</b></a><c/></r>'), '<r>\n  <a>\n    <b>1</b>\n  </a>\n  <c/>\n</r>')
assert.equal(format('<r note="a > b" single=\'one > two\'><a>1</a></r>'),
  '<r note="a > b" single=\'one > two\'>\n  <a>1</a>\n</r>')
assert.equal(format('<r note="xml:space=\'preserve\'"><a>1</a></r>'),
  '<r note="xml:space=\'preserve\'">\n  <a>1</a>\n</r>')

const preservedContent = [
  '<p>甲 <b>乙</b> 丙</p>',
  '<p><b>one</b> <i>two</i></p>',
  '<p>  leading\tspaces\r\nand trailing  </p>',
  '<r>\r\n  <a>1</a>\r\n</r>',
  '<r><a/>\n<b/></r>',
  '<r xml:space="preserve"><a><b/></a></r>',
  '<r xml:space="preser&#x76;e"><a><b/></a></r>',
  '<r xml:space="default"><a><b/></a></r>',
  '<r xml:space="preserve"><a xml:space="default"><b/></a></r>',
  '<r><![CDATA[ A  > B\r\n<!DOCTYPE r> ]]><a/></r>',
  '<r>A &amp; B &#32; &#x20; &lt; &quot; &apos;</r>',
  '<r> <!-- keep  comment\r\n content --> </r>',
]
for (const source of preservedContent) {
  assert.equal(format(source), source, `format must preserve content: ${source}`)
  assert.equal(compact(source), source, `compact must preserve content: ${source}`)
}

const lexicalContent = '<r><!-- <!DOCTYPE r> --><?probe <!DOCTYPE?><a quote="&quot; > &amp;"> A &#x20; &amp; &#32; </a></r>'
assert.equal(format(lexicalContent), '<r>\n  <!-- <!DOCTYPE r> -->\n  <?probe <!DOCTYPE?>\n  <a quote="&quot; > &amp;"> A &#x20; &amp; &#32; </a>\n</r>')
assert.equal(compact(lexicalContent), lexicalContent)
assert.equal(compact(' \n<r>\n  <a/>\n</r>\r\n'), '<r>\n  <a/>\n</r>')
assert.equal(format('\uFEFF<?xml version="1.0"?><r><a/></r>'), '\uFEFF<?xml version="1.0"?>\n<r>\n  <a/>\n</r>')

let parserCalls = 0
const countParserCalls = () => { parserCalls += 1 }
for (const source of ['<r><a>1</r>', '<r>', '<r/><s/>', 'text<r/>', '<r a="unterminated>', '<r><!-- unfinished</r>', '<r><![CDATA[unfinished</r>', '   ']) {
  assert.throws(() => formatXml(source, 'format', countParserCalls),
    (error) => error instanceof XmlFormatterError && error.code === 'invalidXml', source)
}
for (const source of [
  '<!DOCTYPE r SYSTEM "https://example.invalid/external.dtd"><r/>',
  '<!DOCTYPE r [<!ENTITY secret SYSTEM "file:///etc/passwd">]><r>&secret;</r>',
  '<!DOCTYPE r [<!ENTITY a "expanded">]><r>&a;</r>',
]) {
  for (const operation of ['format', 'compact'] as const) {
    assert.throws(() => formatXml(source, operation, countParserCalls),
      (error) => error instanceof XmlFormatterError && error.code === 'xmlDtdUnsupported')
  }
}
assert.equal(parserCalls, 0, 'malformed structure and DTDs must be rejected before reaching any parser')

// Exercise the production DOMParser adapter and result/error wiring with an
// explicit mock. Native browser validation is verified separately in the app.
const originalParser = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
let errorNamespace: string | undefined
let parsedSource = ''
class MockDOMParser {
  parseFromString(source: string, mimeType: string) {
    assert.equal(mimeType, 'application/xml')
    parsedSource = source
    return {
      documentElement: {},
      getElementsByTagNameNS: (namespace: string, name: string) => {
        assert.equal(name, 'parsererror')
        return namespace === errorNamespace ? [{}] : []
      },
    }
  }
}
try {
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: MockDOMParser })
  assert.equal(formatText('xml', 'format', '<r><a>1</a></r>'), '<r>\n  <a>1</a>\n</r>')
  assert.equal(parsedSource, '<r><a>1</a></r>', 'validate the unchanged source')
  assert.equal(formatText('xml', 'format', '<parsererror>valid data</parsererror>'), '<parsererror>valid data</parsererror>')
  for (errorNamespace of ['http://www.mozilla.org/newlayout/xml/parsererror.xml', 'http://www.w3.org/1999/xhtml']) {
    for (const operation of ['format', 'compact'] as const) {
      assert.deepEqual(processFormatter('xml', operation, '<r>&unknown;</r>'),
        { ok: false, message: 'invalidXml', code: 'invalidXml' })
    }
  }
  assert.deepEqual(processFormatter('xml', 'format', '<r><a>1</r>'),
    { ok: false, message: 'invalidXml', code: 'invalidXml' })
  assert.deepEqual(processFormatter('xml', 'format', '<!DOCTYPE r><r/>'),
    { ok: false, message: 'xmlDtdUnsupported', code: 'xmlDtdUnsupported' })
  Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: undefined })
  assert.deepEqual(processFormatter('xml', 'format', '<r/>'),
    { ok: false, message: 'xmlParserUnavailable', code: 'xmlParserUnavailable' })
} finally {
  if (originalParser) Object.defineProperty(globalThis, 'DOMParser', originalParser)
  else Reflect.deleteProperty(globalThis, 'DOMParser')
}

console.log('formatter XML lexical and controlled parser-boundary tests passed (native DOMParser requires app verification)')
