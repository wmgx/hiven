#!/usr/bin/env node
/** Step 5 calculator + Text Diff plugin contract. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const calcSrc = readFileSync('src/plugins/calculator/index.ts', 'utf8')
assert.match(calcSrc, /RESULT_PANEL_ID\s*=\s*['"]calculator\.result-panel['"]/, 'Calculator result panel id')
assert.match(calcSrc, /function CalculationResultPanel/, 'Calculator result panel')
assert.match(calcSrc, /panel\.openV2[\s\S]*pane-bottom/, 'pane-bottom result panel')
assert.doesNotMatch(calcSrc, /id:\s*['"]calculator\.run['"][\s\S]{0,260}return ctx\.output\.replaceActiveText\(calculateFormulaLines/, 'run not primary replace')
assert.match(calcSrc, /effects\.replaceActiveText\(resultText\)/, 'explicit replace')
assert.match(calcSrc, /pane\.create[\s\S]*resultText/, 'new pane output')
assert.match(calcSrc, /aria-label['"]?:\s*t\(['"]panel\.result\.close['"]\)/, 'calculator panel close action should be named')
assert.match(calcSrc, /panel\.result\.copied[\s\S]*panel\.result\.copyFailed/, 'calculator panel copy should report success and failure')
assert.match(calcSrc, /role:\s*copyStatus === ['"]failed['"] \? ['"]alert['"] : ['"]status['"]/, 'calculator copy feedback should be announced')

const textDiffSrc = readFileSync('src/plugins/textDiff/index.tsx', 'utf8')
const textDiffSurfaceSrc = readFileSync('src/plugins/textDiff/TextDiffSurface.tsx', 'utf8')
assert.match(textDiffSrc, /type PaneSnapshot\s*=\s*\{/, 'plugin-local PaneSnapshot')
assert.match(textDiffSrc, /kind:\s*['"]editor-pane['"]/, 'editor-pane source')
assert.match(textDiffSrc, /kind:\s*['"]clipboard['"]/, 'clipboard source')
assert.match(textDiffSrc, /kind:\s*['"]empty['"]/, 'empty source')
assert.match(textDiffSrc, /buildSourceList/, 'buildSourceList')
assert.match(textDiffSrc, /surfaces:\s*\[[\s\S]*global-launcher[\s\S]*quick-editor-command/, 'launcher surfaces')
assert.match(textDiffSrc, /origin:\s*['"]quick-editor['"]|choice\.quickEditorPane/, 'quick-editor pane labels')
assert.match(textDiffSrc, /text:\s*pane\?\.text|pane\?\.text \?\?/, 'captures pane text')
assert.match(textDiffSurfaceSrc, /Original[\s\S]*Modified|original[\s\S]*modified/i, 'dual columns')
assert.match(textDiffSurfaceSrc, /DualEditorView/, 'DualEditorView')
assert.doesNotMatch(textDiffSrc, /core\.diff/, 'no core.diff')
console.log('step5 calculator and diff panel checks passed')
