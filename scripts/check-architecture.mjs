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
      out.push(...walk(full))
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
  // Legacy plugins with known host deep-path imports (to be migrated later)
  const legacyAllowList = new Set(['jsFilter', 'regex-tester'])
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
        // For relative imports starting with ../, resolve and check if it escapes the plugin dir
        if (/^\.\.\//.test(spec)) {
          const fileDir = file.substring(0, file.lastIndexOf('/'))
          const resolved = normalize(join(fileDir, spec))
          if (!resolved.startsWith(pluginDir)) {
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
  // Legacy plugins with known host deep-path imports (to be migrated later)
  const legacyAllowList = new Set(['jsFilter', 'regex-tester'])
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
  const legacyAllowList = new Set(['jsFilter', 'regex-tester'])
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
      if (/`[^`]{240,}`/.test(text)) {
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

checkImports('src/workspace', [
  /(^|\/)plugins(\/|$)/,
  /^\.\.\/plugins/,
  /^\.\.\/\.\.\/plugins/,
], 'workspace must not depend on plugins')

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

if (failures.length > 0) {
  console.error('Architecture boundary check failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Architecture boundary check passed.')
