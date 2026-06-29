#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const editorHost = read('src/launcher/hosts/EditorCommandBarHost.tsx')
const launcherTypes = read('src/workspace/launcher/types.ts')
const hostActions = read('src/workspace/launcher/hostActions.ts')
const editorTextTransforms = read('src/workflow/editorTextTransforms.ts')
const hostAppLauncher = read('src/workspace/appLauncher/hostAppLauncher.ts')
const registry = read('src/workspace/launcher/registry.ts')

assert.match(editorHost, /useLauncherSession\(\{[\s\S]*hostId:\s*['"]editor-command-bar['"]/, 'Editor command bar must identify as editor-command-bar')
assert.match(editorHost, /staticItemFilter:\s*filterEditorCommandBarItems/, 'Editor command bar must apply an editor-local item filter')
assert.match(launcherTypes, /function filterEditorCommandBarItems[\s\S]*isEditorCommandBarItem/, 'Editor command bar filtering must live in the launcher domain layer')
assert.match(launcherTypes, /function isEditorCommandBarItem[\s\S]*plugin-settings:[\s\S]*return false/, 'Editor command bar must hide plugin settings entries')
assert.match(launcherTypes, /item\.kind !== ['"]host['"][\s\S]*return true/, 'Editor command bar must keep plugin text/action items')
assert.match(launcherTypes, /host:pane:/, 'Editor command bar must keep pane-local host controls')
assert.match(launcherTypes, /host:global:search-all-hiven/, 'Editor command bar must allow the explicit Search all Hiven bridge')
assert.doesNotMatch(editorHost, /hostId:\s*['"]command-palette['"]/, 'legacy command-palette id must not be used at runtime')

assert.match(launcherTypes, /'editor-command-bar':\s*\{[\s\S]*presentation:\s*['"]editor-overlay['"]/, 'launcher host config must model editor overlay presentation')
assert.doesNotMatch(launcherTypes.match(/'editor-command-bar':\s*\{[\s\S]*?capabilities:\s*\[([\s\S]*?)\]/)?.[1] ?? '', /app-search|system-power|settings|host-surfaces|plugin-surfaces/, 'editor command bar capabilities must exclude global navigation capabilities')
assert.match(registry, /requiredCapabilities[\s\S]*launcherHostHasCapability/, 'registry must enforce host capability filtering')
assert.match(hostActions, /systemKey:\s*['"]host:global:search-all-hiven['"][\s\S]*surfaces:\s*\[['"]editor-command-bar['"]\][\s\S]*showLauncherWindow\(\)/, 'Editor command bar must expose Search all Hiven as the only global bridge')
assert.match(hostActions, /function\s+rewriteActiveEditorTextPolitely\(\)[\s\S]*replaceEditorTextTarget/, 'Editor command bar must provide a local polite rewrite helper')
assert.match(hostActions, /function\s+compressActiveEditorTextToThreeSentences\(\)[\s\S]*replaceEditorTextTarget/, 'Editor command bar must provide a local three-sentence compression helper')
assert.match(hostActions, /function\s+formatActiveEditorTextAsBullets\(\)[\s\S]*replaceEditorTextTarget/, 'Editor command bar must provide a local bullet-list formatting helper')
assert.match(hostActions, /function\s+quoteActiveEditorTextAsCodeBlock\(\)[\s\S]*replaceEditorTextTarget/, 'Editor command bar must provide a local code-block quote helper')
assert.match(editorTextTransforms, /export\s+function\s+rewriteTextPolitely/, 'editor text rewrite logic must live in the workflow transform layer')
assert.match(editorTextTransforms, /export\s+function\s+formatTextAsBullets/, 'editor bullet formatting logic must live in the workflow transform layer')
assert.match(hostActions, /systemKey:\s*['"]host:editor:rewrite-politely['"][\s\S]*surfaces:\s*\[['"]editor-command-bar['"]\][\s\S]*rewriteActiveEditorTextPolitely\(\)/, 'Editor command bar must expose polite rewrite as an editor-local action')
assert.match(hostActions, /systemKey:\s*['"]host:editor:compress-three-sentences['"][\s\S]*surfaces:\s*\[['"]editor-command-bar['"]\][\s\S]*compressActiveEditorTextToThreeSentences\(\)/, 'Editor command bar must expose three-sentence compression as an editor-local action')
assert.match(hostActions, /systemKey:\s*['"]host:editor:format-bullets['"][\s\S]*title:\s*['"]Format as Bullet List['"][\s\S]*surfaces:\s*\[['"]editor-command-bar['"]\][\s\S]*formatActiveEditorTextAsBullets\(\)/, 'Editor command bar must expose bullet-list formatting as an editor-local action')
assert.match(hostActions, /systemKey:\s*['"]host:editor:quote-code-block['"][\s\S]*title:\s*['"]Quote as Code Block['"][\s\S]*surfaces:\s*\[['"]editor-command-bar['"]\][\s\S]*quoteActiveEditorTextAsCodeBlock\(\)/, 'Editor command bar must expose code-block quote as an editor-local action')
assert.match(editorHost, /item\.systemKey\.startsWith\(['"]host:editor:['"]\)/, 'EditorCommandBarHost filter must keep all editor-local host actions')

const paneHostItems = [...hostActions.matchAll(/systemKey:\s*['"](host:pane:[^'"]+)['"][\s\S]*?surfaces:\s*\[([^\]]+)\]/g)]
const editorLocalPaneItems = new Set([
  'host:pane:close',
  'host:pane:focus-next',
  'host:pane:focus-previous',
  'host:pane:toggle-sticky-scroll',
  'host:pane:set-language',
])
for (const [, systemKey, surfaces] of paneHostItems) {
  if (editorLocalPaneItems.has(systemKey)) {
    assert.doesNotMatch(surfaces, /global-launcher/, `${systemKey} must stay editor-local and must not mutate editor state from the global launcher`)
    assert.match(surfaces, /editor-command-bar|command-palette/, `${systemKey} must remain available from the editor command bar`)
  }
}
assert.match(hostActions, /systemKey:\s*['"]host:system:restart['"][\s\S]*surfaces:\s*\[['"]global-launcher['"]\]/, 'system power actions must be global-launcher only')
assert.match(hostAppLauncher, /surfaceId[\s\S]*global-launcher/, 'app launcher search must be scoped to the global launcher')

console.log('editor command bar scope checks passed')
