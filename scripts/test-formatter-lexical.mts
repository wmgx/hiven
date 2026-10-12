import assert from 'node:assert/strict'
import { formatText } from '../src/plugins/formatter/core.ts'

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
assert.equal(css('a { color: red;  padding: 0; }'), 'a{color: red;padding: 0;}')
for (const compact of [true, false]) {
  const source = 'a { content: "a;  b:{c}/*literal*/"; background: url(data:image/svg+xml;a;b); width: calc(100% - 2px); }'
  const output = css(source, compact)
  for (const value of ['"a;  b:{c}/*literal*/"', 'url(data:image/svg+xml;a;b)', 'calc(100% - 2px)']) assert.ok(output.includes(value), output)
  assert.ok(css('a/**/b { color: red; }', compact).includes('a/**/b'), 'comment must not merge selector tokens')
  assert.ok(css('a  b { color: red; }', compact).includes('a  b'), 'descendant selector whitespace remains')
  for (const uncertain of [
    'a { --x:  a  b ; color: var(--x); }',
    'a { --色: { inner:  spaced  }; color: red; }',
    'a { content: "escaped\\\";still string"; }',
    'a { content: "unfinished   ',
    'a { /* unfinished   ',
    'a { width: calc(1px; }',
  ]) assert.equal(css(uncertain, compact), uncertain)
}
console.log('Formatter lexical preservation passed')
