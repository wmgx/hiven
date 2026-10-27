#!/usr/bin/env node

/**
 * Clipboard History — Frequent / Favorite i18n contract
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (path) => readFileSync(join(root, path), 'utf8')

const en = JSON.parse(read('src/plugins/clipboard-history/locales/en.json'))
const zh = JSON.parse(read('src/plugins/clipboard-history/locales/zh.json'))

const requiredKeys = [
  'filter.favorite',
  'state.emptyFrequent',
  'state.emptyFavorite',
  'favorite.info',
  'favorite.titlePlaceholder',
  'favorite.untitled',
  'action.favorite',
  'action.unfavorite',
  'action.confirmFavorite',
  'action.saveFavoriteInfo',
  'action.editFavoriteInfo',
  'action.cancel',
  'meta.timesPasted',
  'meta.favorite',
  'error.favoriteFailed',
]

for (const key of requiredKeys) {
  assert.equal(typeof en[key], 'string', `en locale missing ${key}`)
  assert.equal(typeof zh[key], 'string', `zh locale missing ${key}`)
}

console.log('clipboard history frequent/favorite checks passed')
