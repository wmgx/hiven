#!/usr/bin/env node
import assert from 'node:assert/strict'
import { assembleFromSelection, isSelectableToken, tokenize } from '../src/plugins/text-explode/tokenize.ts'

const tokens = tokenize('alpha\n\nskip beta')
const selectable = tokens.flatMap((token, index) => (isSelectableToken(token.type) ? [index] : []))

assert.equal(assembleFromSelection(tokens, new Set(selectable)), 'alpha\n\nskip beta')
assert.equal(assembleFromSelection(tokens, new Set([selectable[0], selectable[2]])), 'alpha beta')

console.log('text-explode selection assembly test passed')
