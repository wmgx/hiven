import assert from 'node:assert/strict'
import { formatText } from '../src/plugins/text-tools/format/core.ts'

const sql = (text: string) => formatText('sql', 'compact', text)
assert.equal(sql("SELECT 'a--b' AS value;"), "SELECT 'a--b' AS value;")
assert.equal(sql("SELECT    'a  b'   AS   value;"), "SELECT 'a  b' AS value;")
for (const text of [
  "SELECT 'it''s -- literal', \"a--b\", `a--b`, [a--b];",
  "SELECT E'it\\'s -- literal';",
  'SELECT $$a -- b\n  c$$, $tag$a  b$tag$;',
  "SELECT 'a'\n'b'; -- preserve literal concatenation",
  'SELECT a/*separator*/FROM t; -- keep newline\nSELECT b;',
  'SELECT /* outer /* inner */ comment */ 1;',
  'SELECT /*!50000 SQL_NO_CACHE */ 1;',
  'SELECT # dialect comment\n1;',
  "SELECT q'[a'b -- c]';",
  "SELECT   'unfinished  ",
]) assert.equal(sql(text), text)

const css = (text: string, compact = true) => formatText('css', compact ? 'compact' : 'format', text)
assert.equal(css('a { color: red;  padding: 0; }'), 'a{color:red;padding:0;}')
for (const compact of [true, false]) {
  const source = 'a { content: "a;  b:{c}/*literal*/"; background: url(data:image/svg+xml;a;b); width: calc(100% - 2px); }'
  const output = css(source, compact)
  for (const value of ['"a;  b:{c}/*literal*/"', 'url(data:image/svg+xml;a;b)', 'calc(100% - 2px)']) assert.ok(output.includes(value), output)
  assert.ok(css('a/**/b { color: red; }', compact).includes('a/**/b'), 'comment must not merge selector tokens')
  assert.ok(css('a  b { color: red; }', compact).includes('a  b'), 'descendant selector whitespace remains')
  // Unclosed strings, comments and brackets are reported instead of silently returned.
  for (const broken of ['a { content: "unfinished   ', 'a { /* unfinished   ', 'a { width: calc(1px; }', 'a { color: red;']) {
    assert.throws(() => css(broken, compact), (error: any) => error?.code === 'invalidCss', broken)
  }
}
// Custom property values are protected, not the whole stylesheet.
assert.equal(css(':root { --c:  red ; } a { color : var(--c) ; margin : 0 }'), ':root{--c:red;}a{color:var(--c);margin:0}')
assert.equal(css('a { --x:  a  b ; color: red }', false), 'a {\n  --x: a  b;\n  color: red\n}')
assert.ok(css('a { --色: { inner:  spaced  }; color: red; }').includes('--色:{ inner:  spaced  };'))
assert.equal(css('.sm\\:flex { color : red ; }'), '.sm\\:flex{color:red;}')
assert.equal(css('a { content: "escaped\\";still string"; }'), 'a{content:"escaped\\";still string";}')
assert.equal(css('a :hover { color : red }'), 'a :hover{color:red}', 'descendant pseudo selectors keep their space')
// SQL falls back across dialects: PostgreSQL syntax is not an error.
assert.doesNotThrow(() => formatText('sql', 'format', "select a::int, b->>'x' from t where id = $1"))
assert.doesNotThrow(() => formatText('sql', 'format', 'select 1 # mysql comment\n'))
console.log('Formatter lexical preservation passed')
