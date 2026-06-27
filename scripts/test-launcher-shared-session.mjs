#!/usr/bin/env node
/**
 * Phase 4 launcher shared session contract.
 *
 * Covers Task 6:
 * - GlobalLauncherHost and EditorCommandBarHost share a launcher session/view
 * - shared launcher UI primitives exist under an explicit shared UI directory
 * - hosts are configured by LauncherHostConfig instead of duplicating full state/UI
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

const root = process.cwd()
const failures = []

function check(condition, message) {
  if (!condition) failures.push(message)
}

function checkMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message)
}

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function exists(path) {
  return existsSync(join(root, path))
}

function walk(dir) {
  const abs = join(root, dir)
  if (!existsSync(abs)) return []
  const out = []
  for (const entry of readdirSync(abs)) {
    const path = join(abs, entry)
    const rel = relative(root, path)
    if (statSync(path).isDirectory()) {
      out.push(...walk(rel))
    } else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) {
      out.push(rel)
    }
  }
  return out
}

function firstExisting(paths) {
  return paths.find((path) => exists(path)) ?? null
}

function moduleText(files) {
  return files.map((path) => `\n// ${path}\n${read(path)}`).join('\n')
}

const packageJson = JSON.parse(read('package.json'))
check(
  packageJson.scripts?.['test:launcher-shared-session'] === 'node scripts/test-launcher-shared-session.mjs',
  'package.json must expose test:launcher-shared-session',
)

const srcFiles = walk('src')
const launcherFiles = srcFiles.filter((path) => /(^|\/)launcher(\/|\.|[A-Z])|GlobalLauncher|CommandPalette|EditorCommandBar/.test(path))

// 1. Shared launcher session hook/module.
const sessionFiles = launcherFiles.filter((path) => {
  const name = basename(path)
  const source = read(path)
  return (
    /useLauncherSession|LauncherSession|createLauncherSession/i.test(name)
    || /\bexport\s+(?:function|const)\s+useLauncherSession\b/.test(source)
    || /\bexport\s+(?:interface|type|class|function|const)\s+LauncherSession\b/.test(source)
    || /\bexport\s+(?:function|const)\s+createLauncherSession\b/.test(source)
  )
})
const sessionSource = moduleText(sessionFiles)

check(
  sessionFiles.length > 0,
  'Phase 4 must add a shared useLauncherSession hook or equivalent LauncherSession module',
)
checkMatch(
  sessionSource,
  /LauncherController|collectDynamicItems|rankLauncherItems|selectedIndex|dynamicItems/,
  'shared launcher session must own controller/query/selection/dynamic item orchestration, not just a type alias',
)

// 2. Shared launcher UI primitive directory.
const sharedUiDir = firstExisting([
  'src/launcher/ui',
  'src/components/launcher/shared',
])

check(
  sharedUiDir,
  'Phase 4 must add a shared launcher UI directory such as src/launcher/ui or src/components/launcher/shared',
)

const sharedUiFiles = sharedUiDir ? walk(sharedUiDir) : []
const sharedUiSource = moduleText(sharedUiFiles)
const requiredUiModules = {
  shell: /LauncherShell|launcher[-/]shell|shell/i,
  search: /LauncherSearch|SearchStep|launcher[-/]search|search/i,
  list: /LauncherList|ListStep|launcher[-/]list|list/i,
  result: /LauncherResult|ResultStep|ResultChoice|launcher[-/]result|result/i,
  collect: /CollectInputStep|LauncherCollect|collect[-/]input|collect/i,
  param: /LauncherParam|ParamStep|launcher[-/]param|param/i,
  footer: /LauncherFooter|launcher[-/]footer|footer/i,
}
const presentUiModules = Object.entries(requiredUiModules)
  .filter(([name, pattern]) => sharedUiFiles.some((path) => pattern.test(basename(path))) || pattern.test(sharedUiSource))
  .map(([name]) => name)

check(
  presentUiModules.length >= 5
    && ['shell', 'search', 'list', 'result'].every((name) => presentUiModules.includes(name)),
  `shared launcher UI must cover the main shell/search/list/result/collect/param/footer modules; found: ${presentUiModules.join(', ') || 'none'}`,
)

// 3. Host config contract.
const hostConfigFiles = launcherFiles.filter((path) => /LauncherHostConfig|launcherHostConfig|hostConfig/i.test(basename(path)) || /LauncherHostConfig/.test(read(path)))
const hostConfigSource = moduleText(hostConfigFiles)

check(
  hostConfigFiles.length > 0,
  'Phase 4 must add LauncherHostConfig or an equivalent host config module',
)
checkMatch(hostConfigSource, /hostId/, 'LauncherHostConfig must describe hostId')
checkMatch(hostConfigSource, /capabilities/, 'LauncherHostConfig must describe host capabilities')
checkMatch(hostConfigSource, /presentation/, 'LauncherHostConfig must describe host presentation')
checkMatch(
  hostConfigSource,
  /closeBehavior|closeOnBlur|requestClose|restoreFocus|onClose/,
  'LauncherHostConfig must describe close behavior',
)

// 4. Hosts reuse shared session/view instead of duplicating full launcher state and UI.
const globalHostPath = firstExisting([
  'src/components/GlobalLauncherHost.tsx',
  'src/launcher/hosts/GlobalLauncherHost.tsx',
  'src/components/GlobalLauncher.tsx',
])
const editorHostPath = firstExisting([
  'src/components/EditorCommandBarHost.tsx',
  'src/launcher/hosts/EditorCommandBarHost.tsx',
  'src/components/CommandPalette.tsx',
])

check(globalHostPath, 'GlobalLauncherHost or compatible GlobalLauncher wrapper must exist')
check(editorHostPath, 'EditorCommandBarHost or compatible CommandPalette wrapper must exist')

const globalHost = globalHostPath ? read(globalHostPath) : ''
const editorHost = editorHostPath ? read(editorHostPath) : ''
const hostPair = `${globalHost}\n${editorHost}`

checkMatch(
  hostPair,
  /GlobalLauncherHost|function\s+GlobalLauncher|const\s+GlobalLauncher/,
  'global launcher host/wrapper must be explicit',
)
checkMatch(
  hostPair,
  /EditorCommandBarHost|function\s+CommandPalette|const\s+CommandPalette/,
  'editor command bar host/wrapper must be explicit',
)

const sharedSessionUse = /useLauncherSession|createLauncherSession|LauncherSession/.test(hostPair)
const sharedViewUse = /LauncherView|LauncherShell|LauncherList|LauncherSearch|LauncherResult|CollectInputStep|ResultStep/.test(hostPair)

check(
  sharedSessionUse,
  'GlobalLauncherHost and EditorCommandBarHost must reuse a shared launcher session hook/module',
)
check(
  sharedViewUse,
  'GlobalLauncherHost and EditorCommandBarHost must render through shared launcher view/UI primitives',
)

const duplicatedStatePatterns = [
  { name: 'query', pattern: /useState(?:<[^>]+>)?\(\s*['"]{2}\s*\)/g },
  { name: 'selectedIndex', pattern: /useState(?:<[^>]+>)?\(\s*0\s*\)/g },
  { name: 'dynamicItems', pattern: /useState<[^>]*LauncherItem[^>]*>\(\s*\[\]\s*\)|setDynamicItems|collectDynamicItems/g },
  { name: 'IME composition', pattern: /isImeComposingRef|startImeComposition|finishImeComposition|shouldIgnoreImeKeyDown/g },
  { name: 'result UI', pattern: /ResultChoiceRow|resultSelectedIndex|selectedChoiceIds|toggleResultChoice|global-launcher-result-row/g },
]

const duplicatedState = duplicatedStatePatterns
  .filter(({ pattern }) => (globalHost.match(pattern) ?? []).length > 0 && (editorHost.match(pattern) ?? []).length > 0)
  .map(({ name }) => name)

check(
  duplicatedState.length === 0,
  `hosts must not both maintain full query/selection/dynamicItems/IME/result UI logic after sharing session/view; duplicated: ${duplicatedState.join(', ')}`,
)

if (failures.length > 0) {
  console.error('✗ launcher shared session contract failed:')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('launcher shared session checks passed')
