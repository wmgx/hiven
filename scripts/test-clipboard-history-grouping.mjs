import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', 'utf8')
const helpers = source.slice(source.indexOf('function groupItemsByDay('), source.indexOf('function formatBytes('))
let formatters = 0
const context = vm.createContext({ Date, Intl: {
  DateTimeFormat: function (...args) {
    formatters++
    return new Intl.DateTimeFormat(...args)
  },
} })
vm.runInContext(ts.transpileModule(helpers, {}).outputText, context)
const timestamp = new Date(2020, 0, 15, 12).getTime()
const items = Array.from({ length: 500 }, (_, id) => ({ id, lastCopiedAt: timestamp }))
const started = performance.now()
const groups = context.groupItemsByDay(items, 'zh', (key) => key)
assert.equal(groups.length, 1)
assert.equal(groups[0].label, new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(timestamp))
assert.deepEqual([...groups[0].items], items)
assert.equal(formatters, 1, 'grouping must reuse its date formatter across history entries')
console.log(`clipboard grouping passed: 500 items in ${(performance.now() - started).toFixed(1)}ms`)
