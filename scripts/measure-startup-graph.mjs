#!/usr/bin/env node
// Inspect an existing production build; this script never builds or edits dist.
// --check enforces the deferred builtin-source boundary on the actual JS graph.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import ts from 'typescript'

const options = { root: process.cwd() }
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  if (flag === '--check') options.check = true
  else if (['--root', '--dist', '--output'].includes(flag) && process.argv[i + 1]) options[flag.slice(2)] = process.argv[++i]
  else throw new Error(`Unknown or incomplete option: ${flag}`)
}
const root = path.resolve(options.root)
const dist = options.dist ? path.resolve(options.dist) : path.join(root, 'dist')
const relative = (base, file) => path.relative(base, file).split(path.sep).join('/')
const gzipBytes = value => gzipSync(value, { level: 9 }).length
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)])
}
const rawSources = walk(path.join(root, 'src/plugins')).filter(file =>
  /^src\/plugins\/[^/]+\/.+\.(?:ts|tsx|js|jsx|mjs|json|css|md)$/.test(relative(root, file)))
const rawByValue = new Map()
for (const file of rawSources) {
  const value = fs.readFileSync(file, 'utf8')
  if (!rawByValue.has(value)) rawByValue.set(value, [])
  rawByValue.get(value).push(relative(root, file))
}

const modules = new Map(), matchedSources = new Set()
for (const file of walk(dist).filter(file => file.endsWith('.js'))) {
  const name = relative(dist, file)
  const code = fs.readFileSync(file, 'utf8')
  const ast = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  assert.equal(ast.parseDiagnostics.length, 0, `Could not parse ${name}`)
  const imports = [], dynamic = [], rawLiterals = []
  for (const statement of ast.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(statement.moduleSpecifier), `Nonliteral static import in ${name}`)
      imports.push(statement.moduleSpecifier.text)
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      dynamic.push(node.arguments[0].text)
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && rawByValue.has(node.text)) {
      const sources = rawByValue.get(node.text)
      sources.forEach(source => matchedSources.add(source))
      rawLiterals.push({
        start: node.getStart(ast), end: node.end,
        bytes: Buffer.byteLength(code.slice(node.getStart(ast), node.end)),
        sources,
        kind: sources.every(source => /^src\/plugins\/[^/]+\/manifest\.json$/.test(source)) ? 'manifest' : 'source',
      })
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  function resolve(specifier) {
    assert.ok(specifier.startsWith('.'), `Unexpected external static import: ${name} -> ${specifier}`)
    return path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier))
  }
  let ablated = code
  for (const literal of rawLiterals.filter(item => item.kind === 'source').sort((a, b) => b.start - a.start)) {
    ablated = `${ablated.slice(0, literal.start)}""${ablated.slice(literal.end)}`
  }
  modules.set(name, {
    file: name, bytes: Buffer.byteLength(code), gzipBytes: gzipBytes(code),
    imports: imports.map(resolve), dynamic: dynamic.filter(specifier => specifier.startsWith('.')).map(resolve),
    rawSourceLiteralBytes: rawLiterals.filter(item => item.kind === 'source').reduce((sum, item) => sum + item.bytes, 0),
    rawManifestLiteralBytes: rawLiterals.filter(item => item.kind === 'manifest').reduce((sum, item) => sum + item.bytes, 0),
    rawLiteralOccurrences: rawLiterals.length,
    sourceLiteralAblationByteDelta: Buffer.byteLength(code) - Buffer.byteLength(ablated),
    sourceLiteralAblationGzipDelta: gzipBytes(code) - gzipBytes(ablated),
    sourceFiles: [...new Set(rawLiterals.flatMap(item => item.sources))],
  })
}
function closure(seeds) {
  const seen = new Set()
  function add(file) {
    if (seen.has(file)) return
    assert.ok(modules.has(file), `Missing built module ${file}`)
    seen.add(file)
    modules.get(file).imports.forEach(add)
  }
  seeds.forEach(add)
  return [...seen].sort()
}
function summarize(seeds) {
  const files = closure(seeds), items = files.map(file => modules.get(file))
  const sum = key => items.reduce((total, item) => total + item[key], 0)
  return {
    seeds, jsFiles: files.length, bytes: sum('bytes'), gzipBytes: sum('gzipBytes'),
    rawSourceLiteralBytes: sum('rawSourceLiteralBytes'),
    sourceLiteralAblationByteDelta: sum('sourceLiteralAblationByteDelta'),
    sourceLiteralAblationGzipDelta: sum('sourceLiteralAblationGzipDelta'), files,
  }
}
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const entries = [...html.matchAll(/<script\b(?=[^>]*\btype=["']module["'])[^>]*\bsrc=["']([^"']+)["']/g)]
  .map(match => match[1].replace(/^\//, ''))
assert.ok(entries.length, 'No module script entry in dist/index.html')
const entryDynamicImports = [...new Set(closure(entries).flatMap(file => modules.get(file).dynamic))]
function selectedRoot(prefix) {
  const candidates = entryDynamicImports.filter(file => path.posix.basename(file).startsWith(`${prefix}-`))
  assert.equal(candidates.length, 1, `Expected one entry-graph dynamic ${prefix} root, found ${candidates.join(', ')}`)
  return candidates[0]
}
const quickEditor = selectedRoot('QuickEditorDetachedView')
const graphs = {
  htmlEntryOnly: summarize(entries),
  launcherApp: summarize([...entries, selectedRoot('App')]),
  pluginSurface: summarize([...entries, selectedRoot('PluginSurfaceWindow')]),
  quickEditorRoot: summarize([...entries, quickEditor]),
  quickEditorWithMonaco: summarize([...entries, quickEditor, selectedRoot('monacoRuntime')]),
}
const report = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  method: 'AST static import/export closure, seeded by HTML entry and explicitly selected dynamic root. CSS, deferred imports, workers and runtime-dependent NLS excluded. Bytes are UTF-8 file sizes; gzip is sum of individually gzip level 9 compressed files. Source literal ablation replaces exact AST literal matches with empty strings in memory; it estimates contained payload, not an actual rebuilt bundle or timing.',
  graphs,
  rawSourceCorpus: {
    files: rawSources.length, bytes: rawSources.reduce((sum, file) => sum + fs.statSync(file).size, 0),
    matchedFiles: matchedSources.size, unmatchedFiles: rawSources.map(file => relative(root, file)).filter(file => !matchedSources.has(file)),
  },
  rawContainingModules: [...modules.values()].filter(item => item.rawLiteralOccurrences).map(({ imports, dynamic, ...rest }) => rest),
  staticGraph: Object.fromEntries([...modules.entries()].map(([name, item]) => [name, {
    imports: item.imports, dynamic: item.dynamic, bytes: item.bytes, gzipBytes: item.gzipBytes,
  }])),
}
if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({
  ...report,
  graphs: Object.fromEntries(Object.entries(graphs).map(([name, { files, ...rest }]) => [name, rest])),
  rawContainingModules: report.rawContainingModules.map(({ sourceFiles, ...rest }) => rest),
  staticGraph: undefined,
}, null, 2))
if (options.check) {
  assert.ok(rawSources.length, 'Source corpus must not be empty')
  assert.deepEqual(report.rawSourceCorpus.unmatchedFiles, [], 'Build must retain every current raw source file')
  for (const [name, graph] of Object.entries(graphs)) {
    assert.equal(graph.rawSourceLiteralBytes, 0, `${name} eagerly includes release-only plugin source strings`)
  }
  const startupFiles = new Set(Object.values(graphs).flatMap(graph => graph.files))
  const capsules = [...new Set([...startupFiles].flatMap(file => modules.get(file).dynamic))]
    .filter(file => path.posix.basename(file).startsWith('builtinPluginSources-'))
  assert.equal(capsules.length, 1, 'Startup graph must defer one builtin source capsule through dynamic import')
  assert.ok(!startupFiles.has(capsules[0]), 'Builtin source capsule must not be statically reachable from startup')
  const deferredFiles = new Set(closure(capsules).flatMap(file => modules.get(file).sourceFiles))
  for (const file of rawSources.map(file => relative(root, file))) {
    assert.ok(deferredFiles.has(file), `Deferred source capsule lost ${file}`)
  }
  console.log('PASS built startup graphs defer all builtin release sources and retain the complete source corpus')
}
