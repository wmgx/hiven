#!/usr/bin/env node

/**
 * Clipboard History — Frequent / Favorite surface + i18n contract
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const read = (path) => readFileSync(join(root, path), 'utf8')

const surface = read('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
const en = JSON.parse(read('src/plugins/clipboard-history/locales/en.json'))
const zh = JSON.parse(read('src/plugins/clipboard-history/locales/zh.json'))
const repo = read('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts')

assert.match(surface, /FilterKind = 'all' \| 'text' \| 'image' \| 'files' \| 'frequent' \| 'favorite'/)
assert.match(
  surface,
  /value:\s*['"]all['"][\s\S]{0,120}value:\s*['"]favorite['"][\s\S]{0,120}value:\s*['"]frequent['"]/,
  'first three tabs must be all, favorite, frequent',
)
assert.match(surface, /frequentPasteThreshold/)
assert.match(surface, /recordPaste/)
assert.match(surface, /setFavorite/)
assert.match(surface, /updateFavoriteTitle/)
assert.match(surface, /openFavoriteTitleDialog|titleDialog/)
assert.match(surface, /state\.emptyFrequent/)
assert.match(surface, /state\.emptyFavorite/)
assert.match(surface, /action\.editFavoriteTitle/)

assert.match(repo, /async function recordPaste/)
assert.match(repo, /async function setFavorite/)
assert.match(repo, /isFavoriteEntry|entry\.isFavorite === true/)

const requiredKeys = [
  'filter.favorite',
  'state.emptyFrequent',
  'state.emptyFavorite',
  'favorite.titleDialog',
  'favorite.titlePlaceholder',
  'favorite.untitled',
  'settings.frequentPasteThreshold',
  'action.favorite',
  'action.unfavorite',
  'action.confirmFavorite',
  'action.saveFavoriteTitle',
  'action.editFavoriteTitle',
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
