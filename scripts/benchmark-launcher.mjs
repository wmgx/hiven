#!/usr/bin/env node
// 固定合成数据，直接运行实际排序代码；不读取桌面历史或调用插件。
// node scripts/benchmark-launcher.mjs [output.json] [baseline.json]
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  cacheDir: 'temp/benchmark-vite',
  server: { middlewareMode: true, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
  appType: 'custom',
  logLevel: 'error',
})
try {
  const { rankLauncherItems } = await server.ssrLoadModule('/src/workspace/launcher/ranking.ts')
  const { emptyUsageBySurface } = await server.ssrLoadModule('/src/workspace/launcher/usage.ts')
  const makeItems = (count, navigation) => Array.from({ length: count }, (_, i) => {
    const tab = navigation && i % 4 !== 0
    return {
      systemKey: navigation ? `${tab ? 'host:tab:focus:' : 'host:window:focus:'}${i}` : `plugin:benchmark:command:${i}`,
      kind: navigation ? 'host' : 'plugin',
      display: { title: `${tab ? 'Document' : 'Project'} ${i} — Workspace`, titleI18n: { zh: `${tab ? '文档' : '项目'} ${i} 工作区` }, aliases: [`workspace ${i}`] },
      behavior: { type: 'perform' },
      requiredCapabilities: navigation ? [tab ? 'desktop-browser-tabs' : 'desktop-windows'] : [],
      execute: () => ({ ok: true }),
    }
  })
  // 标题缓存必须跟随窗口/标签标题变化，不能保留过期的降权结果。
  const { navNearDuplicateDemotion, NAV_NEAR_DUP_DEMOTION } = await server.ssrLoadModule('/src/workspace/desktopTargets/browserWindowPolicy.ts')
  const [windowItem, tabItem] = makeItems(2, true)
  windowItem.display.title = tabItem.display.title = 'Quarterly budget report'
  assert.equal(navNearDuplicateDemotion(windowItem, [windowItem, tabItem]), NAV_NEAR_DUP_DEMOTION)
  tabItem.display.title = 'Unrelated support queue'
  assert.equal(navNearDuplicateDemotion(windowItem, [windowItem, tabItem]), 0)
  windowItem.display.title = tabItem.display.title
  assert.equal(navNearDuplicateDemotion(windowItem, [windowItem, tabItem]), NAV_NEAR_DUP_DEMOTION)
  const cases = [
    ['commands-empty-300', 300, false, '', 'en', 30],
    ['commands-search-300', 300, false, 'workspace', 'en', 30],
    ['commands-pinyin-300', 300, false, 'xiangmu', 'zh', 30],
    ['navigation-empty-300', 300, true, '', 'en', 30],
    ['navigation-search-1000', 1000, true, 'workspace', 'en', 100],
    ['favorites-empty-1000', 1000, false, '', 'en', 200],
  ]
  const results = []
  for (const [name, count, navigation, query, locale, favorites] of cases) {
    const items = makeItems(count, navigation)
    const ctx = { query, locale, surfaceId: 'global-launcher', usage: emptyUsageBySurface(), now: 1_700_000_000_000, favoriteKeys: items.slice(0, favorites).map(item => item.systemKey) }
    const expected = rankLauncherItems(ctx, items).map(item => item.systemKey)
    assert.equal(expected.length, query ? 50 : 16)
    // 预热不计时；每个样本平均 5 次调用，降低计时器噪声。
    for (let i = 0; i < 20; i++) rankLauncherItems(ctx, items)
    const samplesMs = []
    for (let sample = 0; sample < 40; sample++) {
      const started = performance.now()
      let result
      for (let i = 0; i < 5; i++) result = rankLauncherItems(ctx, items)
      samplesMs.push((performance.now() - started) / 5)
      assert.deepEqual(result.map(item => item.systemKey), expected)
    }
    const sorted = [...samplesMs].sort((a, b) => a - b)
    results.push({ name, count, favorites, query, locale, p50Ms: sorted[19], p95Ms: sorted[37], samplesMs, resultHash: createHash('sha256').update(JSON.stringify(expected)).digest('hex') })
  }
  const report = { at: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0].model, warmup: 20, samples: 40, callsPerSample: 5, results }
  if (process.argv[3]) {
    const baseline = JSON.parse(readFileSync(process.argv[3], 'utf8'))
    assert.deepEqual(results.map(r => [r.name, r.resultHash]), baseline.results.map(r => [r.name, r.resultHash]), '优化前后结果及顺序必须一致')
  }
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n')
  console.table(results.map(({ name, p50Ms, p95Ms }) => ({ name, p50Ms: +p50Ms.toFixed(3), p95Ms: +p95Ms.toFixed(3) })))
} finally {
  await server.close()
}
