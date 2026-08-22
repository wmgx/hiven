#!/usr/bin/env node

/**
 * Entry reachability check: traverses the import graph from src/main.tsx
 * and reports .ts/.tsx files under src/ that are unreachable.
 *
 * Supports: static imports, dynamic import(), import.meta.glob, Vite aliases.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize, relative, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const srcDir = join(root, 'src')
const entry = join(srcDir, 'main.tsx')

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

const VITE_ALIASES = {
  '@hiven/plugin': join(srcDir, 'plugin-sdk.ts'),
  '@hiven/plugin-diff': join(srcDir, 'pluginHostDiff.ts'),
  '@hiven/plugin-ui/icons': join(srcDir, 'plugin-ui-icons.ts'),
  '@hiven/plugin-ui': join(srcDir, 'plugin-ui.tsx'),
  '@fluxtext/plugin': join(srcDir, 'plugin-sdk.ts'),
}

// White-listed files that are allowed to be unreachable (with reason)
const WHITELIST = new Set([
  // Type declaration files are side-effect-free
  'src/hiven.d.ts',
  // Barrel files and utilities — disconnected but may be needed
  'src/launcher/clipboard/index.ts',
  'src/workflow/index.ts',
  // Barrel re-export only; consumers import concrete modules under desktopTargets/.
  'src/workspace/desktopTargets/index.ts',
])

function isWhitelisted(relPath) {
  if (WHITELIST.has(relPath)) return true
  if (relPath.endsWith('.d.ts')) return true
  return false
}

function collectAllSourceFiles(dir) {
  const results = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.worktrees') continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectAllSourceFiles(full))
    } else {
      const ext = full.slice(full.lastIndexOf('.'))
      if (EXTENSIONS.includes(ext)) {
        results.push(full)
      }
    }
  }
  return results
}

function resolveImport(specifier, fromFile) {
  // Check Vite aliases first (longest match wins)
  const aliasKeys = Object.keys(VITE_ALIASES).sort((a, b) => b.length - a.length)
  for (const alias of aliasKeys) {
    if (specifier === alias || specifier.startsWith(alias + '/')) {
      const target = VITE_ALIASES[alias]
      if (existsSync(target)) return target
    }
  }

  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null

  const base = dirname(fromFile)
  let target = normalize(join(base, specifier))

  for (const ext of EXTENSIONS) {
    if (target.endsWith(ext) && existsSync(target)) return target
  }

  for (const ext of EXTENSIONS) {
    if (existsSync(target + ext)) return target + ext
  }

  for (const ext of EXTENSIONS) {
    const indexFile = join(target, 'index' + ext)
    if (existsSync(indexFile)) return indexFile
  }

  if (existsSync(target)) {
    const stat = statSync(target)
    if (stat.isFile()) return target
  }

  return null
}

// Expand import.meta.glob patterns to actual files
function expandGlobImports(content, fromFile) {
  const results = []
  const globRe = /import\.meta\.glob\(\s*['"]([^'"]+)['"]/g
  let m
  while ((m = globRe.exec(content))) {
    const pattern = m[1]
    const base = dirname(fromFile)
    const expanded = expandSimpleGlob(pattern, base)
    results.push(...expanded)
  }
  return results
}

function expandSimpleGlob(pattern, baseDir) {
  const results = []
  const parts = pattern.split('/')
  walkGlob(baseDir, parts, 0, results)
  return results
}

function walkGlob(currentDir, parts, index, results) {
  if (index >= parts.length) return
  if (!existsSync(currentDir)) return

  const part = parts[index]
  const isLast = index === parts.length - 1

  if (part === '*') {
    let entries
    try { entries = readdirSync(currentDir) } catch { return }
    for (const name of entries) {
      const full = join(currentDir, name)
      if (isLast) {
        if (statSync(full).isFile()) {
          const ext = full.slice(full.lastIndexOf('.'))
          if (EXTENSIONS.includes(ext)) results.push(full)
        }
      } else {
        if (statSync(full).isDirectory()) {
          walkGlob(full, parts, index + 1, results)
        }
      }
    }
  } else if (part.includes('*') || part.includes('{')) {
    // Handle patterns like "index.{ts,tsx}" or "*.ts"
    const regex = globPartToRegex(part)
    let entries
    try { entries = readdirSync(currentDir) } catch { return }
    for (const name of entries) {
      if (!regex.test(name)) continue
      const full = join(currentDir, name)
      if (isLast) {
        if (statSync(full).isFile()) {
          const ext = full.slice(full.lastIndexOf('.'))
          if (EXTENSIONS.includes(ext)) results.push(full)
        }
      } else {
        if (statSync(full).isDirectory()) {
          walkGlob(full, parts, index + 1, results)
        }
      }
    }
  } else if (part === '..') {
    walkGlob(normalize(join(currentDir, '..')), parts, index + 1, results)
  } else if (part === '.') {
    walkGlob(currentDir, parts, index + 1, results)
  } else {
    const next = join(currentDir, part)
    if (isLast) {
      if (existsSync(next) && statSync(next).isFile()) {
        const ext = next.slice(next.lastIndexOf('.'))
        if (EXTENSIONS.includes(ext)) results.push(next)
      }
    } else {
      walkGlob(next, parts, index + 1, results)
    }
  }
}

function globPartToRegex(part) {
  let pattern = '^'
  let i = 0
  while (i < part.length) {
    const ch = part[i]
    if (ch === '*') {
      pattern += '[^/]*'
    } else if (ch === '{') {
      const end = part.indexOf('}', i)
      if (end === -1) { pattern += '\\{'; i++; continue }
      const alternatives = part.slice(i + 1, end).split(',')
      pattern += '(' + alternatives.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')'
      i = end
    } else if (ch === '?') {
      pattern += '.'
    } else {
      pattern += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    i++
  }
  pattern += '$'
  return new RegExp(pattern)
}

function extractImports(content) {
  const specifiers = []
  const staticRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g
  let m
  while ((m = staticRe.exec(content))) {
    specifiers.push(m[1])
  }
  const dynamicRe = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dynamicRe.exec(content))) {
    specifiers.push(m[1])
  }
  return specifiers
}

function buildReachableSet(entryFile) {
  const reachable = new Set()
  const queue = [entryFile]
  const warnings = []

  while (queue.length > 0) {
    const file = queue.shift()
    if (reachable.has(file)) continue
    reachable.add(file)

    let content
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    // Handle import.meta.glob
    const globFiles = expandGlobImports(content, file)
    for (const gf of globFiles) {
      if (!reachable.has(gf)) queue.push(gf)
    }

    const specifiers = extractImports(content)
    for (const spec of specifiers) {
      if (spec.includes('${') || spec.includes('+')) {
        warnings.push(`  ⚠ Dynamic import path in ${relative(root, file)}: ${spec}`)
        continue
      }

      const resolved = resolveImport(spec, file)
      if (resolved && !reachable.has(resolved)) {
        queue.push(resolved)
      }
    }
  }

  return { reachable, warnings }
}

// Main
const allFiles = collectAllSourceFiles(srcDir)
const { reachable, warnings } = buildReachableSet(entry)

const unreachable = []
for (const file of allFiles) {
  if (reachable.has(file)) continue
  const relPath = relative(root, file)
  if (isWhitelisted(relPath)) continue
  unreachable.push(relPath)
}

if (warnings.length > 0) {
  console.log('Warnings (dynamic import paths not followed):')
  for (const w of warnings) console.log(w)
  console.log('')
}

if (unreachable.length === 0) {
  console.log(`Reachability check passed. ${reachable.size} files reachable from entry.`)
  process.exit(0)
} else {
  console.error(`Reachability check failed. ${unreachable.length} unreachable file(s):`)
  unreachable.sort()
  for (const f of unreachable) {
    console.error(`  - ${f}`)
  }
  process.exit(1)
}
