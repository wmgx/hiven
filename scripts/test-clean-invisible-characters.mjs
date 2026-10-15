#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createJiti } from 'jiti'

const { cleanInvisibleCharacters } = await createJiti(import.meta.url).import('../src/plugins/line-tools/cleanInvisibleCharacters.ts')

const source = 'Acme\u00a0Inc\nAcme Inc\norder\u200b-142\norder-142\nco\u00adoperate\ncooperate\n10\u202fkg'
assert.deepEqual(cleanInvisibleCharacters(source), {
  text: 'Acme Inc\nAcme Inc\norder-142\norder-142\ncooperate\ncooperate\n10 kg',
  normalizedSpaces: 2,
  removedCharacters: 2,
})

const preserved = '👨‍👩‍👧‍👦❤️\r\nمی‌روم\te\u0301\u200eLTR\u200f\u2066safe\u2069\ufeff'
assert.deepEqual(cleanInvisibleCharacters(preserved), {
  text: preserved,
  normalizedSpaces: 0,
  removedCharacters: 0,
})

assert.deepEqual(cleanInvisibleCharacters('\u00a0\u202f\u200b\u00ad'), {
  text: '  ',
  normalizedSpaces: 2,
  removedCharacters: 2,
})
assert.deepEqual(cleanInvisibleCharacters(''), { text: '', normalizedSpaces: 0, removedCharacters: 0 })

console.log('Invisible character cleanup passed: exact targets, counts, and Unicode/control preservation')
