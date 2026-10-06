#!/usr/bin/env python3
"""生产预览页基准。需要环境中已有的 Python Playwright + Chromium。
python3 scripts/benchmark-launcher-browser.py http://127.0.0.1:4175 output.json
每轮使用独立浏览器存储，不连接桌面 bridge，不执行外部命令。
"""
import json
import math
import sys
from playwright.sync_api import sync_playwright

url, output = sys.argv[1:3]
samples = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for iteration in range(10):
        context = browser.new_context(viewport={"width": 1100, "height": 850})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.add_init_script("""(() => {
          window.bench = { inputs: [] };
          const observer = new MutationObserver(() => {
            if (!document.querySelector('input')) return;
            observer.disconnect();
            requestAnimationFrame(() => requestAnimationFrame(() => window.bench.ready = performance.now()));
          });
          observer.observe(document, { childList: true, subtree: true });
          document.addEventListener('input', () => {
            const start = performance.now();
            requestAnimationFrame(() => requestAnimationFrame(() => window.bench.inputs.push(performance.now() - start)));
          }, true);
        })()""")
        page.goto(url + '/?window=launcher')
        page.wait_for_function('window.bench.ready > 0')
        page.wait_for_load_state('networkidle')
        assert not page.evaluate('Boolean(window.__HIVEN_WEB_NATIVE_BRIDGE__)'), '使用生产 preview，避免桌面数据干扰'
        sample = page.evaluate("""({ readyMs: window.bench.ready,
          jsBytes: performance.getEntriesByType('resource').filter(e => e.name.endsWith('.js')).reduce((n,e) => n + e.decodedBodySize, 0),
          firstPaintMs: performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint')?.startTime })""")
        search = page.locator('input').first
        for query in ['settings', 'plugins', 'quick', 'settings', 'plugins', 'quick']:
            previous = page.evaluate('window.bench.inputs.length')
            search.fill(query)
            page.wait_for_function('(n) => window.bench.inputs.length > n', arg=previous)
            assert page.locator('[data-launcher-row-index]').count() > 0
        sample['searchInputFrameMs'] = page.evaluate('window.bench.inputs.slice()')
        page.keyboard.press('ArrowDown')
        assert page.locator('[data-launcher-row-index].selected').count() == 1
        search.fill('quick')
        start = page.evaluate('performance.now()')
        page.locator('[data-launcher-row-index]').filter(has_text='Quick Editor').first.click()
        editor = page.locator('.monaco-editor textarea').first
        editor.wait_for(state='visible')
        sample['editorReadyMs'] = page.evaluate('performance.now()') - start
        page.locator('.view-lines').first.click(position={"x": 10, "y": 10})
        page.keyboard.insert_text('performance check')
        page.wait_for_function("document.querySelector('.view-lines')?.textContent.replaceAll('\\u00a0', ' ').includes('performance check')")
        assert not errors, errors
        if iteration == 9:
            page.screenshot(path=output.replace('.json', '-editor.png'))
        samples.append(sample)
        print(f'iteration {iteration + 1}/10 passed', flush=True)
        context.close()
    browser.close()

def stats(values):
    values = sorted(values)
    return {'p50': values[(len(values)-1)//2], 'p95': values[math.ceil(len(values)*.95)-1]}

report = {'browser': browser.version, 'url': url, 'iterations': 10, 'samples': samples,
          'summary': {key: stats([sample[key] for sample in samples]) for key in ['readyMs', 'firstPaintMs', 'jsBytes', 'editorReadyMs']}}
report['summary']['searchInputFrameMs'] = stats([value for sample in samples for value in sample['searchInputFrameMs']])
with open(output, 'w') as file:
    json.dump(report, file, indent=2)
print(json.dumps(report['summary'], indent=2))
