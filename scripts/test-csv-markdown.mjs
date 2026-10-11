import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const module = { exports: {} }
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/csv/markdownCell.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText, { module, exports: module.exports })
const { escapeMarkdownCell: cell } = module.exports
assert.equal(cell('first\r\nsecond\nthird\rfourth'), 'first<br>second<br>third<br>fourth')
assert.equal(cell('a|b\\|c'), 'a&#124;b&#92;&#124;c')
assert.equal(cell('<img src=x onerror=alert(1)> & &#124;'), '&lt;img src=x onerror=alert(1)&gt; &amp; &amp;#124;')
assert.equal(cell('`code` **bold** _em_ ~~del~~ [link](https://example.test) ![image](x)'), '&#96;code&#96; &#42;&#42;bold&#42;&#42; &#95;em&#95; &#126;&#126;del&#126;&#126; &#91;link&#93;(https://example.test) &#33;&#91;image&#93;(x)')
assert.equal(cell('中文 "quoted" <br>'), '中文 "quoted" &lt;br&gt;')
assert.equal(cell(''), '')
console.log('CSV Markdown literal cell checks passed')
