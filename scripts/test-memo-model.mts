import assert from 'node:assert/strict'
import { addData, addSibling, editData, members, search, validateDraft, visibleKind, EMPTY_DB } from '../src/plugins/memo/model.ts'

const field = (name: string, value: string) => ({ id: `${name}-${value}`, name, value })

// Main path: a second record forms a kind; tags stay per record; search returns whole records.
const first = addData(EMPTY_DB, { fields: [field('账号', 'merchant_demo'), field('ID', '00731')], tags: ['管理员'], note: null })
assert.equal(visibleKind(first.db, first.db.records[0]), undefined)
const second = addSibling(first.db, first.id, { fields: [field('账号', 'merchant_b'), field('ID', '00988')], tags: [], note: null })
const kind = second.db.kinds[0]
assert.equal(members(second.db, kind).length, 2)
assert.deepEqual(second.db.records.map(record => record.tags), [['管理员'], []])
const hit = search(second.db, '00988')
assert.equal(hit.length, 1)
assert.equal(hit[0].type === 'record' && hit[0].record.id, second.id)
const renamed = editData(second.db, first.id, { fields: [{ ...field('用户ID', '00731'), original: 'ID' }, field('账号', 'merchant_demo')], tags: ['管理员'], note: null })
assert.equal(renamed.renamed, 2)
assert.deepEqual(renamed.db.records.map(record => record.type === 'data' && record.fields.find(item => item.value.startsWith('00'))?.name), ['用户ID', '用户ID'])

// Failure path: an invalid draft is rejected and a missing source leaves no kind behind.
assert.equal(validateDraft({ fields: [field('', 'orphan')], tags: [], note: null }), 'missingName')
assert.throws(() => addSibling(first.db, 'missing', { fields: [], tags: [], note: null }))
assert.equal(first.db.kinds.length, 0)
console.log('memo model checks passed')
