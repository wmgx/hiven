import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('src/plugins/web-open/index.tsx', 'utf8')
const learning = readFileSync('src/workspace/learning/learningController.ts', 'utf8')
const app = readFileSync('src/App.tsx', 'utf8')

assert.match(source, /filter\(\(entry\) => !isAutoLearnedEntry\(entry\)\)/)
assert.match(source, /Boolean\(entry\.learnedFrom\).*AUTO_CREATED_TAG/s)
assert.doesNotMatch(source, /registerSink\(['"]web-open['"]/) 
assert.match(learning, /candidate\.transform\.kind !== 'url-template'/)
assert.match(app, /purgeStaleUrlTemplateLearning\(\)/)

console.log('web-open auto rule cleanup checks passed')
