#!/usr/bin/env node

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(path) {
  return readFileSync(path, 'utf8')
}

function findMatching(text, openIndex, openChar, closeChar) {
  let depth = 0
  let quote = null
  let escaped = false
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }
    if (ch === openChar) depth++
    if (ch === closeChar) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function extractToolsArray(source) {
  const marker = 'tools:'
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return null
  const openIndex = source.indexOf('[', markerIndex)
  if (openIndex < 0) return null
  const closeIndex = findMatching(source, openIndex, '[', ']')
  if (closeIndex < 0) return null
  return source.slice(openIndex + 1, closeIndex)
}

function splitTopLevelObjects(arraySource) {
  const items = []
  let i = 0
  while (i < arraySource.length) {
    const open = arraySource.indexOf('{', i)
    if (open < 0) break
    const close = findMatching(arraySource, open, '{', '}')
    if (close < 0) break
    items.push(arraySource.slice(open, close + 1))
    i = close + 1
  }
  return items
}

function assertLauncherToolsHaveSubtitles() {
  const pluginsRoot = 'src/plugins'
  for (const dir of readdirSync(pluginsRoot)) {
    const indexPath = join(pluginsRoot, dir, 'index.ts')
    const tsxPath = join(pluginsRoot, dir, 'index.tsx')
    const filePath = existsSync(indexPath) ? indexPath : existsSync(tsxPath) ? tsxPath : null
    if (!filePath) continue
    const toolsSource = extractToolsArray(read(filePath))
    if (!toolsSource) continue
    for (const item of splitTopLevelObjects(toolsSource)) {
      if (!/surfaces\s*:\s*\{[\s\S]*launcher\s*:\s*true/.test(item)) continue
      assert.match(item, /subtitle\s*:/, `${filePath} launcher tool is missing subtitle`)
    }
  }
}

function assertBuiltinVersionsMatchManifests() {
  const index = JSON.parse(read('src/builtin-plugins/index.json'))
  assert.equal(index.version, 19, 'builtin plugin index version should be bumped for launcher migration')
  for (const pkg of index.packages) {
    const manifest = JSON.parse(read(`src/plugins/${pkg.dir}/manifest.json`))
    assert.equal(pkg.version, manifest.version, `${pkg.pluginId} builtin index version should match manifest version`)
  }
}

function assertTextDiffCanBeFoundAndFailureIsVisible() {
  const textDiff = read('src/plugins/textDiff/index.ts')
  assert.match(
    textDiff,
    /id:\s*['"]text-diff\.compare['"][\s\S]*aliases:\s*\[[\s\S]*['"]diff['"]/,
    'text-diff launcher item should be searchable by the English diff query in Chinese locale',
  )
  assert.match(
    textDiff,
    /if \(snapshot\.paneIds\.length === 2\)[\s\S]*runTextDiff\(ctx, snapshot, snapshot\.paneIds\[0\], snapshot\.paneIds\[1\]\)/,
    'text-diff launcher item should directly compare when exactly two panes are open',
  )
  assert.match(
    textDiff,
    /selection:\s*\{[\s\S]*type:\s*['"]multi['"][\s\S]*min:\s*2[\s\S]*max:\s*2/,
    'text-diff source picker should use the launcher multi-select result structure',
  )
  assert.match(
    textDiff,
    /submit:\s*\(choices\)[\s\S]*runTextDiffForSources\(ctx, selected\[0\], selected\[1\]\)/,
    'text-diff source picker should compare the two selected sources on submit',
  )
  assert.match(
    textDiff,
    /if \(snapshot\.paneIds\.length === 1\) return \[\.\.\.paneSources, \{ kind: ['"]clipboard['"] \}, \{ kind: ['"]empty['"] \}\]/,
    'text-diff source picker should only offer clipboard and empty pane when exactly one pane is open',
  )
  assert.match(
    textDiff,
    /ctx\.api\.getClipboardText\(\)/,
    'text-diff source picker should read clipboard through the plugin launcher API',
  )
  assert.match(
    textDiff,
    /ctx\.api\.createPane\([\s\S]*direction:\s*['"]right['"]/,
    'text-diff launcher item should create an empty right pane through the plugin launcher API',
  )
  assert.doesNotMatch(
    textDiff,
    /duplicate/i,
    'text-diff source picker should not include duplicate-current-pane behavior',
  )
  assert.doesNotMatch(
    textDiff,
    /pairPaneSources|choice\.comparePair|buildFirstSourceOutput|buildSecondSelectionOutput|pickFirst|pickSecond|selectSecondSource|originalSource|useAsOriginal/,
    'text-diff source picker should not expose pair-combination or two-step source/target oriented flows',
  )

  const effectRunner = read('src/workspace/effectRunner.ts')
  assert.match(
    effectRunner,
    /Renderer "\$\{effect\.renderer\}" not found[\s\S]*return message/,
    'missing pane renderers should be returned through EffectRunnerResult.errors',
  )
  assert.match(
    effectRunner,
    /const error = applyPaneRendererEffect\(effect\)[\s\S]*result\.errors\.push\(error\)/,
    'pane renderer effect errors should not be swallowed as successful launcher execution',
  )
}

function assertLauncherApiExposesPaneCreation() {
  assert.match(
    read('src/workspace/launcher/types.ts'),
    /createPane\(options\?:\s*\{[\s\S]*direction\?:\s*['"]left['"]\s*\|\s*['"]right['"]\s*\|\s*['"]top['"]\s*\|\s*['"]bottom['"][\s\S]*\}\):\s*string/,
    'PluginLauncherApi should expose generic pane creation for plugin-owned launcher flows',
  )
  assert.match(
    read('src/workspace/launcher/pluginApi.ts'),
    /createPane:\s*\(options\)\s*=>\s*useWorkspaceStore\.getState\(\)\.createPane\(options\)/,
    'PluginLauncherApi createPane should delegate to the workspace API',
  )
}

function assertLauncherParamsAreLocalized() {
  const i18nRegistry = read('src/i18n/pluginI18nRegistry.ts')
  assert.match(
    i18nRegistry,
    /function localizeTool[\s\S]*tool\.params[\s\S]*localizeParam\(messages, param\)/,
    'tool params should be localized before they are adapted into launcher items',
  )
  assert.match(
    i18nRegistry,
    /function localizeLauncherItem[\s\S]*item\.params[\s\S]*localizeParam\(messages, param\)/,
    'launcher item params should be localized, including labels and select options',
  )

  const corePaneZh = JSON.parse(read('src/plugins/core-pane/locales/zh.json'))
  const corePane = read('src/plugins/core-pane/index.ts')
  for (const key of [
    'param.direction.label',
    'param.direction.option.right.label',
    'param.direction.option.left.label',
    'param.direction.option.down.label',
    'param.direction.option.up.label',
    'param.language.label',
    'param.language.option.auto.label',
    'param.language.option.plaintext.label',
    'param.language.option.javascript.label',
    'param.language.option.shell.label',
    'message.stickyScroll.enabled',
    'message.stickyScroll.disabled',
  ]) {
    assert.equal(typeof corePaneZh[key], 'string', `core-pane zh locale should define ${key}`)
    assert.notEqual(corePaneZh[key], key, `core-pane zh locale should translate ${key}`)
  }
  assert.doesNotMatch(
    corePane,
    /\{\s*label:\s*['"](JSON|JavaScript|TypeScript|Markdown|Shell)['"],\s*value:/,
    'core-pane language options should be declared through locale keys, not raw English labels',
  )
}

function assertLauncherSystemMessagesAreLocalized() {
  const output = read('src/workspace/launcher/output.ts')
  assert.match(output, /translate\(locale,\s*['"]palette['"],\s*key\)/, 'launcher output should resolve labels through palette i18n')
  assert.match(output, /showMessage\(palette\(locale,\s*['"]copied['"]\)/, 'launcher copy message should use palette i18n')
  assert.match(output, /palette\(locale,\s*['"]replaceActiveText['"]\)/, 'launcher replace action should use palette i18n')
  assert.match(output, /palette\(locale,\s*['"]insert['"]\)/, 'launcher insert action should use palette i18n')
  assert.match(output, /palette\(locale,\s*['"]copy['"]\)/, 'launcher copy action should use palette i18n')
  assert.doesNotMatch(output, /showMessage\(['"]Copied['"]|title:\s*['"]Replace active text['"]|title:\s*['"]Insert['"]|title:\s*['"]Copy['"]/, 'launcher output should not hardcode English action text')

  const controller = read('src/workspace/launcher/controller.ts')
  assert.match(controller, /fieldRequiredWithLabel/, 'launcher required-param validation should use localized palette message')
  assert.match(controller, /inputRequired/, 'launcher empty-input validation should use localized palette message')
  assert.doesNotMatch(controller, /is required|Input required/, 'launcher controller should not hardcode English validation text')

  const dateTime = read('src/plugins/date-time-assistant/index.ts')
  assert.match(dateTime, /resultKindLabel\(parsed\.kind,\s*ctx\.locale\)/, 'date-time dynamic subtitles should be locale-aware')
  assert.doesNotMatch(dateTime, /subtitle:\s*['"](Timestamp|DateTime)['"]|subtitle:\s*parsed\.kind/, 'date-time dynamic subtitles should not hardcode English labels')
}

assertLauncherToolsHaveSubtitles()
assertBuiltinVersionsMatchManifests()
assertTextDiffCanBeFoundAndFailureIsVisible()
assertLauncherApiExposesPaneCreation()
assertLauncherParamsAreLocalized()
assertLauncherSystemMessagesAreLocalized()

console.log('launcher plugin contract checks passed')
