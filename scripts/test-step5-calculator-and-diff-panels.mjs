#!/usr/bin/env node
/** Step 5 calculator result panel + Text Diff TextSource contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const calcSrc = readFileSync('src/plugins/calculator/index.ts', 'utf8')
assert.match(calcSrc, /RESULT_PANEL_ID\s*=\s*['"]calculator\.result-panel['"]/, 'Calculator should define an editor result panel id')
assert.match(calcSrc, /function CalculationResultPanel/, 'Calculator should render an editor calculation result panel')
assert.match(calcSrc, /panel\.openV2[\s\S]*pane-bottom/, 'Calculator editor formula run should open a pane-bottom result panel')
assert.doesNotMatch(calcSrc, /id:\s*['"]calculator\.run['"][\s\S]{0,260}return ctx\.output\.replaceActiveText\(calculateFormulaLines/, 'Calculator run should not directly replace editor text as the primary path')
assert.match(calcSrc, /effects\.replaceActiveText\(resultText\)/, 'Calculation result panel should still offer explicit replace')
assert.match(calcSrc, /pane\.create[\s\S]*resultText/, 'Calculation result panel should offer new pane output')

const textDiffSrc = readFileSync('src/plugins/textDiff/index.tsx', 'utf8')
const textDiffSurfaceSrc = readFileSync('src/plugins/textDiff/TextDiffSurface.tsx', 'utf8')
assert.match(textDiffSrc, /type TextSource\s*=\s*{[\s\S]*kind:\s*['"]editor-pane['"] \| ['"]clipboard['"] \| ['"]empty['"] \| ['"]snapshot['"]/, 'Text Diff should own a plugin-local TextSource abstraction')
assert.match(textDiffSrc, /contentProvider:\s*['"]live['"] \| ['"]snapshot['"]/, 'TextSource should distinguish live and snapshot providers')
assert.match(textDiffSrc, /sourceMeta/, 'Text Diff renderer inputs should carry source metadata')
assert.match(textDiffSrc, /snapshotAt/, 'Text Diff sources should record snapshot timestamp metadata')
assert.match(textDiffSrc, /title:\s*['"]Text Diff['"][\s\S]*entry:\s*{\s*launcher:\s*true/, 'Text Diff should expose a global launcher surface')
assert.match(textDiffSurfaceSrc, /Original[\s\S]*Modified[\s\S]*Preview/, 'Text Diff surface should provide original, modified, and preview columns')
assert.doesNotMatch(textDiffSrc, /framework|core\.diff/, 'Text Diff source semantics should not move into framework/core diff APIs')

const rendererSrc = readFileSync('src/plugins/textDiff/TextDiffRenderer.tsx', 'utf8')
assert.match(rendererSrc, /sourceMeta/, 'Text Diff renderer should read source metadata')
assert.match(rendererSrc, /text-diff-snapshot-badge/, 'Text Diff renderer should expose snapshot badge UI')

console.log('step5 calculator and diff panel checks passed')
