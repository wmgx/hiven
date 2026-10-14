import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createJiti } from 'jiti'
const { markdownPlainText: convert, MARKDOWN_INPUT_LIMIT } = await createJiti(import.meta.url).import('../src/plugins/line-tools/markdownPlainText.ts')
const fixture = JSON.parse(readFileSync(new URL('./fixtures/markdown-plain-text.json', import.meta.url), 'utf8'))
assert.equal(convert(fixture.input, '图片'), fixture.expected)
// Code bodies use source spelling, not marked's escaped/normalized codespan text.
assert.equal(convert('`&amp;lt; &amp; < > " \'`'), '&amp;lt; &amp; < > " \'')
assert.equal(convert('`` a\n b ``'), ' a\n b ')
assert.equal(convert('&amp; &#65; &unknown;'), '&amp; &#65; &unknown;')
assert.equal(convert('```html\n[x]: ./not-a-definition\n<img src="no">\n```'), '[html]\n[x]: ./not-a-definition\n<img src="no">')
assert.equal(convert('> [ref][a]\n>\n> [a]: ./inside'), '> ref (./inside)\n> \n> [a]: ./inside')
assert.equal(convert('text\n[a]: ./not-definition\n\n[ref][a]'), 'text\n[a]: ./not-definition\n\n[ref][a]')
assert.equal(convert('- [x]: ./nested\n\n[ref][x]'), '- [x]: ./nested\n\nref (./nested)')
assert.equal(convert('![alt](./a "title") ![](./b)', '图片'), '图片: alt (./a "title") 图片: (./b)')
assert.equal(convert('3. three\n4. four'), '3. three\n4. four')
const extraTable = '| a | b |\n| --- | --- |\n| 1 | 2 | KEEP |'
assert.equal(convert(extraTable), extraTable)
assert.equal(convert('| a | b |\n| --- | --- |\n| x\\|y | |'), 'a\tb\nx|y\t')
const html = '<div>\n<img src="https://example.invalid/probe"><script>globalThis.probe=1</script>\n<iframe src="https://example.invalid/frame"></iframe>\n</div>'
assert.equal(convert(html), html)
assert.equal(globalThis.probe, undefined)
assert.equal(convert('unknown[^note]\n\n[^note]: footnote'), 'unknown[^note]\n\n[^note]: footnote')
assert.throws(() => convert('x'.repeat(MARKDOWN_INPUT_LIMIT + 1)), /limit/)
assert.throws(() => convert('中'.repeat(MARKDOWN_INPUT_LIMIT / 2)), /limit/)
assert.throws(() => convert('> '.repeat(70) + 'deep'), /limit/)
// Small source with many references expands beyond the output budget: fail, no truncation.
assert.throws(() => convert(('[a][long] ').repeat(2000) + '\n\n[long]: https://example.invalid/' + 'x'.repeat(400)), /limit/)
console.log('Markdown semantics, exact README output, source code/entities, reference preservation, HTML literals and bounded failures passed.')
