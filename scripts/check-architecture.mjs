#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const failures = []

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const styleExtensions = new Set(['.css'])

function walk(dir) {
  return walkWithExtensions(dir, sourceExtensions)
}

function walkWithExtensions(dir, extensions) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.worktrees' || name === 'target') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      // Keep the caller's extension filter while descending (do not fall back to walk()).
      out.push(...walkWithExtensions(full, extensions))
    } else if (extensions.has(full.slice(full.lastIndexOf('.')))) {
      out.push(full)
    }
  }
  return out
}

function read(file) {
  return readFileSync(file, 'utf8')
}

function rel(file) {
  return relative(root, file)
}

function addFailure(message) {
  failures.push(message)
}

function isWithin(file, dir) {
  const relPath = relative(dir, file)
  return relPath === '' || (!relPath.startsWith('..') && !relPath.startsWith('/'))
}

function checkForbiddenPath(path) {
  if (existsSync(join(root, path))) {
    addFailure(`Forbidden framework path exists: ${path}`)
  }
}

function checkForbiddenSourceTerms(dir, terms, label) {
  for (const file of walk(join(root, dir))) {
    const text = read(file)
    for (const term of terms) {
      if (term.test(text)) {
        addFailure(`${label}: ${rel(file)} matches ${term}`)
      }
    }
  }
}

function checkImports(dir, forbidden, label) {
  const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  for (const file of walk(join(root, dir))) {
    const text = read(file)
    let match
    while ((match = importRe.exec(text))) {
      const spec = match[1] ?? match[2]
      for (const rule of forbidden) {
        if (rule.test(spec)) {
          addFailure(`${label}: ${rel(file)} imports "${spec}"`)
        }
      }
    }
  }
}

function checkPluginCrossImports() {
  const pluginsDir = join(root, 'src/plugins')
  if (!existsSync(pluginsDir)) return
  const legacyAllowList = new Set()
  for (const pluginName of readdirSync(pluginsDir)) {
    const pluginDir = join(pluginsDir, pluginName)
    if (!statSync(pluginDir).isDirectory()) continue
    if (legacyAllowList.has(pluginName)) continue
    const absoluteForbidden = [
      /^\.\.\/\.\.\/plugins\//,
      /^@fluxtext\/plugin-/,
    ]
    for (const file of walk(pluginDir)) {
      const text = read(file)
      const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
      let match
      while ((match = importRe.exec(text))) {
        const spec = match[1] ?? match[2]
        if (absoluteForbidden.some((rule) => rule.test(spec))) {
          addFailure(`plugins must not import other plugins: ${rel(file)} imports "${spec}"`)
          continue
        }
        // For relative imports starting with ../, resolve and only block plugin→plugin escapes here.
        // Host deep imports are checked separately by checkPluginHostDeepImports.
        if (/^\.\.\//.test(spec)) {
          const fileDir = file.substring(0, file.lastIndexOf('/'))
          const resolved = normalize(join(fileDir, spec))
          if (!resolved.startsWith(pluginDir) && isWithin(resolved, pluginsDir)) {
            addFailure(`plugins must not import other plugins: ${rel(file)} imports "${spec}"`)
          }
        }
      }
    }
  }
}

function checkPluginHostDeepImports() {
  const pluginsDir = join(root, 'src/plugins')
  if (!existsSync(pluginsDir)) return
  const legacyAllowList = new Set()
  const forbiddenHostDirs = [
    join(root, 'src/components'),
    join(root, 'src/store'),
    join(root, 'src/workspace'),
    join(root, 'src/i18n'),
    join(root, 'src/kits'),
  ]
  const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

  for (const pluginName of readdirSync(pluginsDir)) {
    const pluginDir = join(pluginsDir, pluginName)
    if (!statSync(pluginDir).isDirectory()) continue
    if (legacyAllowList.has(pluginName)) continue

    for (const file of walk(pluginDir)) {
      const text = read(file)
      importRe.lastIndex = 0
      let match
      while ((match = importRe.exec(text))) {
        const spec = match[1] ?? match[2]
        if (/@tauri-apps\//.test(spec)) {
          addFailure(`plugins must not import Tauri APIs directly: ${rel(file)} imports "${spec}"`)
          continue
        }
        if (!spec.startsWith('.')) continue
        const resolved = normalize(join(dirname(file), spec))
        for (const forbiddenDir of forbiddenHostDirs) {
          if (isWithin(resolved, forbiddenDir)) {
            addFailure(`plugins must not import host deep paths: ${rel(file)} imports "${spec}"`)
          }
        }
      }
    }
  }
}

function checkPluginIndexBoundaries() {
  const pluginsDir = join(root, 'src/plugins')
  if (!existsSync(pluginsDir)) return
  const legacyAllowList = new Set()
  for (const pluginName of readdirSync(pluginsDir)) {
    const pluginDir = join(pluginsDir, pluginName)
    if (!statSync(pluginDir).isDirectory()) continue
    if (legacyAllowList.has(pluginName)) continue
    for (const fileName of ['index.ts', 'index.tsx', 'index.js', 'index.jsx']) {
      const indexFile = join(pluginDir, fileName)
      if (!existsSync(indexFile)) continue
      const text = read(indexFile)
      const declaresComplexPluginSurface = /\b(?:ui|background|settings)\s*:/.test(text)
      if (!declaresComplexPluginSurface) continue
      const jsxReturns = (text.match(/return\s*\(/g) ?? []).length
      if (jsxReturns > 2) {
        addFailure(`plugin index must only assemble contributions: ${rel(indexFile)} has ${jsxReturns} JSX return blocks`)
      }
      if ([...text.matchAll(/`(?:\\[\s\S]|[^`\\])*`/g)].some(([literal]) => literal.length >= 242)) {
        addFailure(`plugin index must not contain large CSS/HTML template strings: ${rel(indexFile)}`)
      }
    }
  }
}

function checkPluginCssBoundaries() {
  const pluginsDir = join(root, 'src/plugins')
  if (!existsSync(pluginsDir)) return
  const forbiddenHostSelectors = /\.(?:global|command-palette|workspace)-[A-Za-z0-9_-]*/
  const forbiddenGlobalSelectors = /(^|[}\n]\s*)(?:body|html|:root|button|input|textarea|select)\s*\{/
  for (const file of walkWithExtensions(pluginsDir, styleExtensions)) {
    const text = read(file)
    if (forbiddenHostSelectors.test(text)) {
      addFailure(`plugin CSS must not select host private classes: ${rel(file)}`)
    }
    if (forbiddenGlobalSelectors.test(text)) {
      addFailure(`plugin CSS must not override global element selectors: ${rel(file)}`)
    }
  }
}

// Everything under src/ except src/plugins/ is host code: it may not import plugin implementations.
// Bundled plugins reach the host only through the registry; the three loaders below enumerate
// the plugin packages with import.meta.glob and are the only legitimate composition roots.
const hostPluginGlobLoaders = new Set([
  'src/builtinPluginSources.ts',
  'src/configInit.ts',
  'src/workspace/bundledPluginLoader.ts',
])

function checkHostDoesNotDependOnPlugins() {
  const pluginsDir = join(root, 'src/plugins')
  const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  const globRe = /import\.meta\.glob\(\s*(?:\[\s*)?['"]([^'"]+)['"]/g
  for (const file of walk(join(root, 'src'))) {
    if (isWithin(file, pluginsDir)) continue
    const text = read(file)
    importRe.lastIndex = 0
    let match
    while ((match = importRe.exec(text))) {
      const spec = match[1] ?? match[2]
      if (!spec.startsWith('.')) continue
      const resolved = normalize(join(dirname(file), spec))
      if (isWithin(resolved, pluginsDir)) {
        addFailure(`host code must not depend on plugins: ${rel(file)} imports "${spec}"`)
      }
    }
    globRe.lastIndex = 0
    while ((match = globRe.exec(text))) {
      const resolved = normalize(join(dirname(file), match[1].replace(/[*{].*$/, '')))
      if (isWithin(resolved, pluginsDir) && !hostPluginGlobLoaders.has(rel(file))) {
        addFailure(`host code must not enumerate plugins with import.meta.glob: ${rel(file)}`)
      }
    }
  }
}

checkForbiddenPath('src/workspace/jsonDiff.ts')
checkForbiddenPath('src/workspace/lineDiff.ts')
checkForbiddenPath('src/presentations/CoreJsonDiffRenderer.tsx')
checkForbiddenPath('src/presentations/DualEditorView.tsx')

checkForbiddenSourceTerms('src/workspace', [
  /\bjsonDiff\b/i,
  /\blineDiff\b/i,
  /\bsemanticDiff\b/i,
  /\bCompareRenderer\b/,
  /\bDiffSurface\b/,
  /\bregisterCompareRenderer\b/,
  /\bCompareRendererDef\b/,
  /monaco\.diff/,
  /\bDiffEditor\b/,
  /\bdiffEditors?\b/,
], 'workspace must stay product-agnostic')

checkForbiddenSourceTerms('src', [
  /core\.diff/,
  /core\.json-diff/,
  /core\.jsonDiff/,
  /jd-/,
], 'legacy diff naming is not allowed in source')

checkImports('src/kits', [
  /(^|\/)workspace(\/|$)/,
  /(^|\/)plugins(\/|$)/,
  /^\.\.\/workspace/,
  /^\.\.\/plugins/,
  /^\.\.\/\.\.\/workspace/,
  /^\.\.\/\.\.\/plugins/,
], 'kits must not depend on framework or plugins')

checkHostDoesNotDependOnPlugins()

checkPluginCrossImports()
checkPluginHostDeepImports()
checkPluginIndexBoundaries()
checkPluginCssBoundaries()

// ─── Clipboard History specific checks ───────────────────────────────────────

// clipboard-history must not import @tauri-apps/*
checkImports('src/plugins/clipboard-history', [
  /@tauri-apps\//,
], 'clipboard-history must not import @tauri-apps')

// clipboard-history must not import host store or workspace
checkImports('src/plugins/clipboard-history', [
  /^\.\.\/\.\.\/store/,
  /^\.\.\/\.\.\/workspace/,
  /^\.\.\/\.\.\/components/,
  /^\.\.\/\.\.\/i18n/,
  /^\.\.\/\.\.\/kits/,
], 'clipboard-history must not import host deep paths')

// workspace must not contain clipboard-history product terms
checkForbiddenSourceTerms('src/workspace', [
  /\bClipboardHistoryItem\b/,
  /\bClipboardHistorySettings\b/,
  /\bclipboardHistoryStore\b/,
  /\bclipboardHistoryRepository\b/,
], 'workspace must not contain clipboard-history product logic')

// clipboard-history must have required directories
const cbhDir = join(root, 'src/plugins/clipboard-history')
for (const requiredDir of ['surfaces', 'settings', 'background', 'storage']) {
  if (!existsSync(join(cbhDir, requiredDir))) {
    addFailure(`clipboard-history must have ${requiredDir}/ directory`)
  }
}

// ─── B3: Diff product stays out of public SDK ────────────────────────────────
const pluginSdkPublic = read(join(root, 'src/plugin-sdk.ts'))
const pluginHostSdk = read(join(root, 'src/pluginHostSdk.ts'))
if (/export type \{[^}]*\bDiffSource\b/.test(pluginSdkPublic) && !/DiffSourcePayload/.test(pluginSdkPublic)) {
  addFailure('public @hiven/plugin must not export product DiffSource from workspaceStore')
}
// Ignore comments: only fail on real imports / type members.
if (/import\s*\{[^}]*\bDualEditorView\b|DualEditorView:\s*typeof|buildJsonDiffViewModel|computeTextLineDiff/.test(pluginHostSdk)) {
  addFailure('PluginHostSdk must not expose DualEditorView / kits.diff (use @hiven/plugin-diff for text-diff only)')
}
if (/useWorkspaceActions\s*:|useBoundSourceText\s*:|useActiveFullscreenView\s*:/.test(pluginHostSdk)) {
  addFailure('PluginHostSdk must not expose Diff write-back / fullscreen workspace hooks')
}
// Only text-diff may import @hiven/plugin-diff
const pluginsDirForDiff = join(root, 'src/plugins')
if (existsSync(pluginsDirForDiff)) {
  for (const pluginName of readdirSync(pluginsDirForDiff)) {
    if (pluginName === 'textDiff') continue
    const pluginDir = join(pluginsDirForDiff, pluginName)
    if (!statSync(pluginDir).isDirectory()) continue
    for (const file of walk(pluginDir)) {
      if (read(file).includes('@hiven/plugin-diff')) {
        addFailure(`only text-diff may import @hiven/plugin-diff: ${rel(file)}`)
      }
    }
  }
}

// ─── Retired window / editor concepts (moved from source-regex tests) ────────
for (const retired of [
  'src/components/EditorWindow.tsx',
  'src/components/CommandPalette.tsx',
  'src/views/EditorView.tsx',
  'src/surfaces/PluginEditorSurface.tsx',
]) {
  checkForbiddenPath(retired)
}
checkForbiddenSourceTerms('src', [/\bisEditorWindowRuntime\b/], 'retired editor-window runtime concept')

// The host SDK must not reach into plugin implementations.
if (/from\s+['"]\.\/plugins\//.test(pluginHostSdk)) {
  addFailure('pluginHostSdk must not import from ./plugins/')
}

// ─── Style tokens (doc/redesign/03-roadmap.md V1) ──────────────────────────────
// Colour / type / shadow values live in src/styles/theme.css. Legacy CSS may only shrink:
// each ceiling is the count when the token layer landed; lower it when a cleanup removes literals.
const STYLE_CEILINGS = { hex: 277, rgb: 141, smallFont: 122, important: 266, uppercase: 10 }
const styleCounts = { hex: 0, rgb: 0, smallFont: 0, important: 0, uppercase: 0 }
for (const file of walkWithExtensions(join(root, 'src'), styleExtensions)) {
  if (rel(file) === 'src/styles/theme.css') continue
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '')
  styleCounts.hex += (css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length
  styleCounts.rgb += (css.match(/\brgba?\(/g) ?? []).length
  styleCounts.smallFont += [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].filter((match) => Number(match[1]) < 12).length
  styleCounts.important += (css.match(/!important/g) ?? []).length
  styleCounts.uppercase += (css.match(/text-transform:\s*uppercase/g) ?? []).length
}
for (const [metric, ceiling] of Object.entries(STYLE_CEILINGS)) {
  if (styleCounts[metric] > ceiling) {
    addFailure(`CSS ${metric} literals grew to ${styleCounts[metric]} (ceiling ${ceiling}); use src/styles/theme.css tokens`)
  }
}
console.log('CSS style counts:', styleCounts)
// shadcn components and the plugin UI kit use tokens only: no literal colours, px font sizes or ad-hoc shadows.
for (const file of [...walk(join(root, 'src/components/ui')), join(root, 'src/plugin-ui.tsx')]) {
  const source = read(file)
  for (const [pattern, label] of [
    [/#[0-9a-fA-F]{3,8}\b|\brgba?\(/, 'literal colour'],
    [/\btext-\[\d/, 'arbitrary font size'],
    [/\bshadow-\[/, 'arbitrary shadow'],
  ]) {
    if (pattern.test(source)) addFailure(`${rel(file)} uses a ${label}; use theme tokens`)
  }
}

if (failures.length > 0) {
  console.error('Architecture boundary check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Architecture boundary check passed.')
