#!/usr/bin/env node
import assert from 'node:assert/strict'
import { assembleFromSelection, isSelectableToken, tokenize } from '../src/plugins/text-explode/tokenize.ts'

const tokens = tokenize('alpha\n\nskip beta')
const selectable = tokens.flatMap((token, index) => (isSelectableToken(token.type) ? [index] : []))

assert.equal(assembleFromSelection(tokens, new Set(selectable)), 'alpha\n\nskip beta')
assert.equal(assembleFromSelection(tokens, new Set([selectable[0], selectable[2]])), 'alpha beta')

console.log('text-explode selection assembly test passed')

// Bad percent escapes must not throw; URL reassembly keeps the original fragments.
const whole = (text: string) => {
  const t = tokenize(text)
  return assembleFromSelection(t, new Set(t.flatMap((token, i) => (isSelectableToken(token.type) ? [i] : []))))
}
assert.doesNotThrow(() => tokenize('open https://a.com/100%'))
const lossless = 'see https://a.com/a%20b?q=x+y&n=1%2B2#top.'
assert.equal(whole(lossless), lossless)
assert.equal(whole('(https://a.com/x).'), '(https://a.com/x).')
assert.equal(tokenize('(https://a.com/x).').filter((t) => t.type.startsWith('url-')).map((t) => t.raw ?? t.text).join(''), 'https://a.com/x')
assert.deepEqual(tokenize('café Привет').filter((t) => t.type === 'word').map((t) => t.text), ['café', 'Привет'])
