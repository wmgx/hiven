import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Pure conversion/trigger and explicit-copy contracts. No native clipboard.
const scratch = await mkdtemp(join(tmpdir(), 'hiven-color-answers-'))
try {
  for (const name of ['colorCore', 'index']) {
    const source = (await readFile(new URL(`../src/plugins/color-tools/${name}.ts`, import.meta.url), 'utf8'))
      .replace("'colorjs.io'", JSON.stringify(import.meta.resolve('colorjs.io')))
      .replace("'./colorCore'", "'./colorCore.mjs'")
    await writeFile(join(scratch, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  }
  const { colorAnswer } = await import(pathToFileURL(join(scratch, 'colorCore.mjs')))
  const { default: plugin } = await import(pathToFileURL(join(scratch, 'index.mjs')))
  const format = (hex, kind) => colorAnswer(hex).formats.find((entry) => entry.format === kind).text
  const coordinates = (text) => [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map(([value]) => Number(value))
  const close = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≈ ${expected}`)

  assert.equal(format('#FF6B35', 'rgb'), 'rgb(255 107 53)')
  assert.equal(format('#FF6B35', 'hsl'), 'hsl(16.0396 100% 60.3922%)')
  // Published CSS Color 4 sRGB red/Oklab sample conversion, polar form.
  const red = coordinates(format('#f00', 'oklch'))
  close(red[0], 62.795536, 0.0001, 'red lightness')
  close(red[1], 0.257683, 0.00001, 'red chroma')
  close(red[2], 29.233885, 0.001, 'red hue')
  assert.equal(format('#000', 'oklch'), 'oklch(0% 0 0)')
  assert.equal(format('#fff', 'oklch'), 'oklch(100% 0 0)')
  assert.equal(format('#808080', 'hsl'), 'hsl(0 0% 50.1961%)')
  assert.equal(coordinates(format('#808080', 'oklch'))[1], 0)
  assert.equal(colorAnswer('  #aBcD  ').hex, '#AABBCCDD')
  assert.equal(format('#abcd', 'rgb'), 'rgb(170 187 204 / 0.866667)')
  assert.equal(format('#12345600', 'rgb'), 'rgb(18 52 86 / 0)')
  assert.equal(format('#123456ff', 'rgb'), 'rgb(18 52 86)')
  for (let alpha = 0; alpha <= 255; alpha++) {
    const text = format(`#123456${alpha.toString(16).padStart(2, '0')}`, 'rgb')
    const serializedAlpha = text.includes('/') ? Number(text.split('/')[1].slice(0, -1).trim()) : 1
    assert.equal(Math.round(serializedAlpha * 255), alpha, 'all alpha bytes survive formatting')
  }
  for (const input of ['', 'red', 'color', 'FF6B35', '#12', '#12345', '#1234567', '#123456789', '#ggg', 'find #fff', '#fff extra', '#fff\n#000', 'rgb(255 0 0)', 'var(--red)', 'url(https://example.com)', '#fff; background:url(x)', ' '.repeat(100000)]) {
    assert.equal(colorAnswer(input), null, `reject ${input.slice(0, 30)}`)
  }
  const icon = decodeURIComponent(colorAnswer('#12345680').icon.split(',')[1])
  assert.ok(icon.includes('fill="#123456"'))
  assert.ok(icon.includes('fill-opacity="0.501961"'))
  assert.ok(!/script|style|href|foreignObject/i.test(icon), 'fixed swatch has no active or external content')

  const copied = []
  const context = { query: '#FF6B35', surfaceId: 'global-launcher', t: (key, values) => `${key}:${values.format}:${values.hex}`, api: { copyText: async (text) => { copied.push(text) } } }
  assert.equal(plugin.launcher.dynamicItems({ ...context, query: 'search' }).length, 0)
  assert.equal(plugin.launcher.dynamicItems({ ...context, surfaceId: 'editor-command-bar' }).length, 0)
  assert.equal(plugin.launcher.dynamicItems({ ...context, signal: { aborted: true } }).length, 0)
  const items = plugin.launcher.dynamicItems(context)
  assert.equal(items.length, 3)
  assert.deepEqual(copied, [], 'suggestions never copy without an explicit action')
  for (const item of items) {
    assert.equal(item.directAnswer, true)
    assert.deepEqual(item.surfaces, ['global-launcher'])
    await item.execute(context)
    assert.equal(copied.at(-1), item.display.title)
  }
  assert.equal(copied.length, 3, 'exactly one write per explicit action')
  await assert.rejects(items[0].execute({ api: { copyText: async () => { throw new Error('synthetic copy failure') } } }), /synthetic copy failure/, 'failed clipboard write must propagate')
  console.log('Color conversion, strict-trigger, alpha and explicit-copy contracts passed.')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
