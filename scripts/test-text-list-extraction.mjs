#!/usr/bin/env node
/** Important extraction logic and the actual registry → controller route. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value) },
  removeItem: (key) => { values.delete(key) },
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const originalInfo = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') originalInfo(...args) }
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { extractTextList } = await vite.ssrLoadModule('/src/plugins/text-tools/line/extractTextList.ts')
  const urls = [
    'HTTPS://Example.com/Path?q=A&b=2#Part',
    'https://example.com/wiki/A_(B)',
    'http://localhost:8080/a',
    'https://example.com/a%20b?q=%2F',
    'https://[::1]:8080/path',
  ]
  const sourceUrls = `链接：“${urls[0]}”， (${urls[1]}).\r\n<${urls[2]}>; ${urls[3]}! [${urls[4]}]。\n${urls[0]}`
  assert.deepEqual(extractTextList(sourceUrls, 'urls', true), urls, 'keep spelling, source order, balanced brackets, query/fragment and first duplicate')
  assert.deepEqual(extractTextList(sourceUrls, 'urls'), [...urls, urls[0]], 'dedup off retains every occurrence')
  assert.deepEqual(extractTextList('https://example.com/a(b(c)))). https://example.com/x[y]] https://example.com/a{b}}', 'urls'), [
    'https://example.com/a(b(c))', 'https://example.com/x[y]', 'https://example.com/a{b}',
  ], 'remove only excess trailing bracket closers')
  assert.deepEqual(extractTextList('https://EXAMPLE.com/A?b=2&a=1 https://example.com/a?a=1&b=2 https://EXAMPLE.com/A?b=2&a=1', 'urls', true), [
    'https://EXAMPLE.com/A?b=2&a=1', 'https://example.com/a?a=1&b=2',
  ], 'URL dedup never changes case, query order, host spelling or path')
  assert.deepEqual(extractTextList('www.example.com ftp://example.com mailto:a@example.com http:// https://?bad prefixhttps://example.com', 'urls'), [], 'require an explicit standalone HTTP(S) scheme and parsed host')
  assert.deepEqual(extractTextList('https://example.com/中文?q=值，https://example.com/next。', 'urls'), ['https://example.com/中文?q=值', 'https://example.com/next'], 'Chinese punctuation separates links while Unicode paths remain intact')
  assert.deepEqual(extractTextList('[https://one.example](https://two.example) https://a.example/x,https://b.example/y;https://c.example/z', 'urls'), [
    'https://two.example', 'https://a.example/x', 'https://b.example/y', 'https://c.example/z',
  ], 'Markdown uses only link destinations and keeps punctuation-separated URLs')
  assert.deepEqual(extractTextList('https://example.com/?next=https://other.example/path', 'urls'), ['https://example.com/?next=https://other.example/path'], 'embedded redirect query remains one URL')
  assert.deepEqual(extractTextList('"a.b+tag_1-x@Sub.Example.COM", a.b+tag_1-x@sub.example.com A.b+tag_1-x@sub.example.com; next@example.org.', 'emails'), [
    'a.b+tag_1-x@Sub.Example.COM', 'A.b+tag_1-x@sub.example.com', 'next@example.org',
  ], 'email dedup ignores domain case but preserves local-part case and first spelling')
  assert.deepEqual(extractTextList('a@Example.com a@example.com a@Example.com', 'emails', false), ['a@Example.com', 'a@example.com', 'a@Example.com'])
  const unsupported = [
    '.first@example.com', 'first.@example.com', 'first..last@example.com',
    'a@-example.com', 'a@example-.com', 'a@exam_ple.com', 'a@example..com',
    'a@@example.com', 'a@example', 'a@example.c', 'a@example.123',
    'a!b@example.com', '"quoted local"@example.com', '"foo@bar.com"@example.com', '"foo@bar.com and baz"@example.com',
    'éname@example.com', 'name@example.comé', '用户@example.com', '联系foo@example.com',
    `${'a'.repeat(65)}@example.com`, `a@${'a'.repeat(64)}.com`,
  ]
  assert.deepEqual(extractTextList(unsupported.join(' '), 'emails'), [], 'never salvage partial addresses from invalid labels or unsupported local parts')
  assert.deepEqual(extractTextList('Contact: <a@x.io> (b@sub.example.com), c@example.org...', 'emails'), ['a@x.io', 'b@sub.example.com', 'c@example.org'], 'ordinary text separators and sentence punctuation')
  assert.deepEqual(extractTextList('', 'emails'), [])
  assert.deepEqual(extractTextList('no links or addresses here', 'urls'), [])
  assert.deepEqual(extractTextList(`x@${'.'.repeat(250_000)}a ${'a'.repeat(250_000)}@example.com valid@example.com`, 'emails'), ['valid@example.com'], 'large malformed tokens terminate without backtracking or partial matches')
  assert.deepEqual(extractTextList(`https://${'['.repeat(50_000)} ${'text '.repeat(30_000)} https://example.com/end`, 'urls'), ['https://example.com/end'], 'large malformed URL token does not prevent later valid links')

  const { registerBundledPluginPackages } = await vite.ssrLoadModule('/src/workspace/bundledPluginLoader.ts')
  const { collectStaticCandidates } = await vite.ssrLoadModule('/src/workspace/launcher/registry.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { getHostOutputIntent } = await vite.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { makePluginT } = await vite.ssrLoadModule('/src/i18n/pluginI18nRegistry.ts')
  const { createGlobalLauncherPluginApi } = await vite.ssrLoadModule('/src/launcher/clipboard/globalLauncherApi.ts')
  const { consumePendingObjectBlock } = await vite.ssrLoadModule('/src/launcher/clipboard/pendingObjectBlock.ts')
  registerBundledPluginPackages()
  const key = 'plugin:text-tools:tool:line-tools.extract-list'
  const item = collectStaticCandidates('global-launcher').find((candidate) => candidate.systemKey === key)
  assert.ok(item, 'actual bundled package exposes the new global tool')
  assert.equal(item.requireParamSelection, true)
  assert.deepEqual(item.actionPolicy, { effect: 'pure' })
  assert.equal(item.display.title, 'Extract Links / Emails')
  assert.equal(item.display.titleI18n.zh, '提取链接 / 邮箱')
  assert.deepEqual(item.defaultParams, { kind: 'urls', dedup: false })
  assert.deepEqual(item.params.map(({ key, type, default: value }) => [key, type, value]), [
    ['kind', 'single-select', 'urls'], ['dedup', 'boolean', false],
  ])
  for (const param of item.params) {
    assert.ok(param.label && param.labelI18n.zh)
    assert.ok(!param.label.startsWith('param.'))
    for (const option of param.options ?? []) assert.ok(option.label && option.labelI18n.zh)
  }
  for (const surface of ['quick-editor-command']) {
    assert.ok(collectStaticCandidates(surface).some((candidate) => candidate.systemKey === key))
  }
  const deliveries = []
  let hiddenReads = 0
  const hostReturn = createGlobalLauncherPluginApi({}).returnToLauncher
  const api = {
    getSelectionText() { hiddenReads++; throw new Error('Unexpected selection read') },
    getActiveText() { hiddenReads++; throw new Error('Unexpected editor read') },
    getClipboardText() { hiddenReads++; throw new Error('Unexpected clipboard read') },
    async copyText(text) { deliveries.push(['copy', text]) },
    async returnToLauncher(text) {
      deliveries.push(['return-to-launcher', text])
      await hostReturn(text)
      const block = consumePendingObjectBlock()
      assert.equal(block.source, 'tool-result')
      assert.equal(block.payloadText, text)
    },
    async pasteToForegroundApp() { throw new Error('Unexpected paste') },
    async openUrl() { throw new Error('Extraction cannot open links') },
  }
  const beforeErrors = deliveries.length
  for (const locale of ['en', 'zh']) {
    for (const kind of ['urls', 'emails']) {
      const result = await item.executeWithParams({ surfaceId: 'global-launcher', input: { text: 'Keep this original text' }, api, locale, t: makePluginT('text-tools', locale) }, { kind, dedup: true })
      assert.equal(result.ok, false)
      assert.ok(result.message, 'localized no-match error has a message')
      assert.equal(/[\u4e00-\u9fff]/.test(result.message), locale === 'zh')
    }
  }
  assert.equal(deliveries.length, beforeErrors, 'no-match result never copies, returns, or overwrites source')

  assert.equal(hiddenReads, 0)
  console.log('text-list-extraction: URL/email boundaries, punctuation, exact dedup, malformed input, localized errors, actual registry, localized errors passed')
} finally {
  console.info = originalInfo
  await vite.close()
}
