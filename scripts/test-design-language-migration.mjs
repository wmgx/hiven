#!/usr/bin/env node
/** Design language static contract for object actions. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const rec = readFileSync('src/launcher/clipboard/actionRecommendation.ts', 'utf8')
const accepts = readFileSync('src/launcher/clipboard/acceptsRecommendation.ts', 'utf8')
const executor = readFileSync('src/launcher/clipboard/actionExecutor.ts', 'utf8')
assert.match(rec, /recommendActionsForBlock|recommendActionsWithPlugins/, 'recommendation entry')
assert.match(rec, /paste-to-foreground|output|defaultOutput/i, 'output targets modeled')
assert.match(accepts, /accepts|match/i, 'accepts filter')
assert.match(executor, /execute|output|clipboard/i, 'executor present')
assert.match(rec, /provider|titleZh|titleEn|JSON|object/i, 'product-facing labels')
console.log('design language migration (static) checks passed')
