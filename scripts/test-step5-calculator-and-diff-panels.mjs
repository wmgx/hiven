#!/usr/bin/env node
/** Step 5 calculator result panel + Text Diff plugin contract. */
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
const diffPageViewSrc = readFileSync('src/plugins/textDiff/DiffPageView.tsx', 'utf8')
assert.match(textDiffSrc, /type PaneSnapshot\s*=\s*\{/, 'Text Diff should own a plugin-local PaneSnapshot type')
assert.match(textDiffSrc, /kind:\s*['"]editor-pane['"]/, 'Text Diff sources should support editor-pane kind')
assert.match(textDiffSrc, /kind:\s*['"]clipboard['"]/, 'Text Diff sources should support clipboard kind')
assert.match(textDiffSrc, /kind:\s*['"]empty['"]/, 'Text Diff sources should support empty kind')
assert.match(textDiffSrc, /buildSourceList/, 'Text Diff should build a source list for diff input selection')
assert.match(textDiffSrc, /surfaces:\s*\[['"]command-palette['"],\s*['"]global-launcher['"]\]/, 'Text Diff should expose both command-palette and global-launcher surfaces')
assert.match(diffPageViewSrc, /Original[\s\S]*Modified|original[\s\S]*modified/, 'Text Diff page should provide original and modified columns')
assert.match(diffPageViewSrc, /DualEditorView/, 'Text Diff page should render a dual editor view')
assert.doesNotMatch(textDiffSrc, /framework|core\.diff/, 'Text Diff source semantics should not move into framework/core diff APIs')

console.log('step5 calculator and diff panel checks passed')
