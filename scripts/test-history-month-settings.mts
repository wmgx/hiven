import assert from 'node:assert/strict'
import { DEFAULT_CLIPBOARD_HISTORY_SETTINGS, migrateClipboardHistorySettings, resolveClipboardHistoryRetentionMonths } from '../src/plugins/clipboard-history/settings/model.ts'

assert.equal(DEFAULT_CLIPBOARD_HISTORY_SETTINGS.retentionMonths, 3)
assert.equal('maxItems' in DEFAULT_CLIPBOARD_HISTORY_SETTINGS, false)
assert.equal('retentionDays' in DEFAULT_CLIPBOARD_HISTORY_SETTINGS, false)
assert.equal('maxTotalCacheBytes' in DEFAULT_CLIPBOARD_HISTORY_SETTINGS, false)
for (const value of [1, 3, 12]) assert.equal(resolveClipboardHistoryRetentionMonths(value), value)
for (const value of [0, 13, -1, 1.5, NaN, Infinity, null, undefined, '12']) assert.equal(resolveClipboardHistoryRetentionMonths(value), 3)
const old = { enabled: true, maxItems: 25, retentionDays: 1, maxTotalCacheBytes: 1024, recordImages: false, frequentPasteThreshold: 5 }
const before = structuredClone(old)
const next = migrateClipboardHistorySettings(old)
assert.deepEqual(old, before, 'migration does not mutate the old settings object')
assert.equal(next.enabled, true)
assert.equal(next.recordImages, false)
assert.equal(next.frequentPasteThreshold, 5)
assert.equal(next.retentionMonths, 3, 'legacy day/count limits never silently become cleanup policy')
assert.equal(next.maxItems, 25, 'legacy values remain recognizable, not active limits')
assert.deepEqual(migrateClipboardHistorySettings(null), DEFAULT_CLIPBOARD_HISTORY_SETTINGS)
assert.equal(migrateClipboardHistorySettings({ retentionMonths: 12 }).retentionMonths, 12)
console.log('clipboard month settings migration passed without storage access')
