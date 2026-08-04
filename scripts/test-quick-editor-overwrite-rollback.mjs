#!/usr/bin/env node
/**
 * Quick Editor external-overwrite version history contracts.
 * Only external overwrite archives versions — user typing does not.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const types = read('src/workspace/quickEditor/quickEditorTypes.ts')
const store = read('src/workspace/quickEditor/quickEditorStore.ts')
const requests = read('src/workspace/quickEditor/quickEditorRequests.ts')
const host = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const executor = read('src/launcher/clipboard/actionExecutor.ts')
const recommendation = read('src/launcher/clipboard/actionRecommendation.ts')
const output = read('src/workspace/launcher/output.ts')
const pluginApi = read('src/workspace/launcher/pluginApi.ts')
const toolbar = read('src/components/quickEditor/QuickEditorToolbar.tsx')
const historyUi = read('src/components/quickEditor/QuickEditorVersionHistory.tsx')
const detached = read('src/views/QuickEditorDetachedView.tsx')
const locale = read('src/i18n/locales/quickEditor.ts')
const palette = read('src/i18n/locales/palette.ts')

assert.match(types, /QuickEditorExternalVersion/, 'types must model external version entries')
assert.match(types, /externalVersionHistory/, 'types must expose version history list')
assert.match(types, /overwriteActiveText/, 'types must expose overwriteActiveText')
assert.match(types, /restoreExternalVersion/, 'types must expose restoreExternalVersion')
assert.doesNotMatch(types, /overwriteSnapshot/, 'legacy single-slot overwriteSnapshot must be gone from types')

assert.match(store, /overwriteActiveText:\s*\(text/, 'store must implement overwriteActiveText')
assert.match(store, /restoreExternalVersion:\s*\(versionId/, 'store must implement restoreExternalVersion')
assert.match(store, /externalVersionHistory/, 'store must keep externalVersionHistory')
assert.match(store, /QUICK_EDITOR_EXTERNAL_VERSION_LIMIT/, 'store must cap history length')
assert.match(store, /pushExternalVersion/, 'store must only push history on overwrite path')
// setText / setPaneText must not touch history
assert.doesNotMatch(
  store,
  /setText:\s*\(text\)\s*=>\s*set\([\s\S]{0,120}externalVersionHistory/,
  'setText must not write external version history',
)
assert.doesNotMatch(
  store,
  /setPaneText:[\s\S]{0,400}externalVersionHistory/,
  'setPaneText must not write external version history',
)

assert.match(requests, /export async function overwriteQuickEditorText/, 'requests must expose overwrite API')
assert.match(requests, /export async function restoreQuickEditorExternalVersion/, 'requests must expose version restore API')
assert.match(requests, /QUICK_EDITOR_OVERWRITE_EVENT/, 'requests must define cross-window overwrite event')
assert.match(requests, /externalVersionHistory/, 'overwrite payload must carry full history')
assert.doesNotMatch(requests, /restoreQuickEditorOverwrite/, 'one-step undo restore API must be retired')

assert.match(host, /overwriteQuickEditorText/, 'GlobalLauncher object actions must overwrite Quick Editor')
assert.match(host, /pinnedObjectActionItems|object-action:/, 'Object Block must pin host open-to-quick-editor rows into the list')
assert.match(
  host,
  /defaultOutput === ['"]open-editor['"]/,
  'non-history text Object Blocks must pin open-editor destinations into the list',
)
assert.match(executor, /覆盖到快捷编辑器|Overwrite Quick Editor/, 'open-editor target label must describe overwrite')
assert.match(recommendation, /open-history-in-quick-editor/, 'history text actions must offer Quick Editor destination')
assert.match(recommendation, /open-in-quick-editor/, 'non-clipboard text blocks must offer Quick Editor destination')
assert.match(output, /id:\s*['"]open-quick-editor['"]/, 'textResult must expose open-quick-editor secondary action')
assert.match(pluginApi, /overwriteQuickEditorText\(text,[\s\S]*source:\s*['"]replace-active['"]/, 'default replaceActiveText must overwrite Quick Editor')

const panel = read('src/components/quickEditor/QuickEditorPanel.tsx')
const css = read('src/index.css')
assert.match(panel, /QuickEditorVersionHistory/, 'version history icon lives on editor status bar trailing')
assert.match(panel, /statusBarTrailing/, 'version history is wired into statusBarTrailing')
assert.doesNotMatch(toolbar, /QuickEditorVersionHistory/, 'toolbar must not carry the bulky version history button')
assert.match(historyUi, /externalVersionHistory/, 'version history UI must read external history')
assert.match(historyUi, /restoreQuickEditorExternalVersion/, 'version history UI must restore by id')
assert.match(historyUi, /qe-version-trigger/, 'version history trigger must be an icon control')
assert.match(historyUi, /createPortal/, 'version menu must portal to body to escape editor overflow / stacking')
assert.match(historyUi, /qe-version-drawer/, 'version menu must use the full-height drawer shell')
assert.match(historyUi, /qe-version-item/, 'versions render as dense rows')
assert.match(historyUi, /qe-version-item__meta/, 'each row has a meta line')
assert.match(historyUi, /qe-version-item__preview/, 'each row has a preview line')
assert.match(historyUi, /formatRelativeTime|分钟前|Just now/, 'version rows should show relative time')
assert.doesNotMatch(historyUi, /versionHistoryIndex/, 'dense rows drop vN index noise')
assert.doesNotMatch(historyUi, /quick-editor-version-badge/, 'version history must not show a numeric badge on the icon')
assert.match(
  historyUi,
  /className=\{`qe-version-trigger[\s\S]*?<History size=\{11\}/,
  'status-bar trigger must be icon-only (History glyph, no text label)',
)
assert.match(css, /\.qe-version-trigger/, 'status-bar version icon styles must exist')
assert.match(css, /\.qe-version-drawer/, 'drawer shell styles must exist')
assert.match(css, /--qe-v-border/, 'popover must define high-contrast border tokens')
assert.match(css, /\.qe-version-item__meta/, 'meta row styles must exist')
assert.match(css, /\.qe-version-item__preview/, 'preview line styles must exist')
assert.doesNotMatch(css, /\.qe-version-item__preview\s*\{[\s\S]{0,120}border:\s*1px solid/, 'preview is plain text, not a nested pill box')
assert.match(detached, /QUICK_EDITOR_OVERWRITE_EVENT/, 'detached window must listen for overwrite sync')
assert.match(locale, /versionHistory/, 'quickEditor i18n must include version history copy')
assert.match(palette, /openQuickEditor/, 'palette i18n must include open-quick-editor label')

console.log('quick-editor-overwrite-rollback: ok')
