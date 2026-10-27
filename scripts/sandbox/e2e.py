#!/usr/bin/env python3
"""Run against the existing Vite server. Fresh browser contexts; no desktop bridge."""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

URL = 'http://localhost:1420/?window=launcher&sandbox=1'


def copy(page, *texts):
    for text in texts:
        page.evaluate('(text) => __hivenSandbox.copy(text)', text)
        # Let the actual 250ms clipboard watcher finish its async reads.
        page.wait_for_timeout(400)


def snapshot(page):
    return page.evaluate('__hivenSandbox.snapshot()')


def wait_snapshot(page, predicate):
    # This installed Playwright polls a returned Promise as truthy; evaluate awaits it.
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        actual = snapshot(page)
        if predicate(actual):
            return actual
        page.wait_for_timeout(50)
    raise AssertionError(f"沙盒状态未就绪: {actual}")


def queue(page, **expected):
    wait_snapshot(page, lambda state: all(state['queue'][key] == value for key, value in expected.items()))


def press(page, key='Control+Shift+V'):
    page.evaluate('(key) => __hivenSandbox.pressShortcut(key)', key)
    page.wait_for_timeout(100)


def editor(page, text):
    expect(page.locator('#sandbox-editor')).to_have_value(text)


def command(page, query):
    page.evaluate('__hivenSandbox.open()')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill(query)
    page.wait_for_timeout(200)
    field.press('Enter')


def history(page):
    command(page, 'clipboard')
    expect(page.get_by_placeholder('Search history')).to_be_visible()
    page.wait_for_timeout(150)
    return page.locator('.clipboard-history-item')


def s1(page):
    copy(page, 'one', 'two', 'two', 'three')
    queue(page, total=3)
    for i in range(3):
        press(page)
        queue(page, completed=i+1)
    editor(page, 'onetwothree')
    value = page.evaluate('__hivenSandbox.clipboard()')
    assert value['text'] == 'three' and value['origin'] == 'hiven' and not value['transient'], value


def s2(page):
    copy(page, 'one', 'two')
    queue(page, total=2)
    page.clock.fast_forward(11000)
    copy(page, 'three')
    queue(page, total=1, completed=0)
    press(page)
    editor(page, 'three')


def s3(page):
    copy(page, 'one', 'two', 'three')
    press(page)
    editor(page, 'one')
    copy(page, 'four')
    queue(page, total=4, completed=1)
    for i in range(3):
        press(page)
        queue(page, completed=i+2)
    editor(page, 'onetwothreefour')


def s4(page):
    copy(page, 'one', 'two')
    page.locator('.sandbox-hud .toast-hud-cancel').click()
    queue(page, remaining=0)
    expect(page.locator('.sandbox-hud [data-slot=status]')).to_have_count(0)
    press(page)
    expect(page.locator('.sandbox-hud')).to_contain_text('No consecutive copies')
    editor(page, '')


def s5(page):
    copy(page, 'one', 'two')
    page.clock.fast_forward(8500)
    # The queue notice stays a full card with its cancel button; it never collapses.
    expect(page.locator('.sandbox-hud .toast-hud-cancel')).to_be_visible()


def s6(page):
    command(page, 'paste queue')
    recorder = page.locator('.srow').filter(has=page.get_by_text('Paste next queued copy', exact=True)).locator('.shortcut-recorder-display')
    recorder.click()
    expect(recorder).to_contain_text('Press')
    wait_snapshot(page, lambda state: not state['shortcuts'])
    page.wait_for_timeout(50)  # Commit the recorder's ready state after its lease resolves.
    recorder.press('Control+Shift+b')
    wait_snapshot(page, lambda state: 'Ctrl+Shift+B' in state['shortcuts'])
    page.locator('#sandbox-editor').click()
    copy(page, 'one', 'two')
    expect(page.locator('.sandbox-hud')).to_contain_text('B paste next')
    press(page)
    editor(page, '')
    press(page, 'Control+Shift+B')
    editor(page, 'one')


def s7(page):
    command(page, 'paste queue')
    expect(page.locator('.global-launcher-panel')).to_contain_text('Shortcut unavailable')


def s8(page):
    page.evaluate("__hivenSandbox.setEditor('before-after', {start:7,end:7})")
    copy(page, 'history-text')
    rows = history(page)
    rows.first.click()
    page.keyboard.press('Enter')
    editor(page, 'before-history-textafter')


def s9(page):
    copy(page, 'one', 'two', 'three', 'four')
    rows = history(page)
    expect(rows).to_have_count(4)
    rows.nth(0).click()
    page.keyboard.press('Shift+ArrowDown')
    page.keyboard.press('Shift+ArrowDown')
    page.keyboard.press('Meta+c')
    page.wait_for_function("__hivenSandbox.clipboard().text === 'four\\nthree\\ntwo'")
    rows = history(page)
    rows.filter(has=page.get_by_text('four', exact=True)).click()
    rows.filter(has=page.get_by_text('two', exact=True)).click(modifiers=['Meta'])
    page.keyboard.press('Enter')
    editor(page, 'four\ntwo')


def s10(page):
    copy(page, 'one', 'two', 'three')
    rows = history(page)
    rows.nth(1).click()
    page.keyboard.press('Backspace')
    expect(rows).to_have_count(2)
    page.get_by_role('button', name='Undo', exact=True).click()
    expect(rows).to_have_count(3)
    assert rows.locator('.clipboard-history-item-title').all_text_contents() == ['three','two','one']
    rows.nth(1).click()
    page.keyboard.press('Backspace')
    expect(rows).to_have_count(2)
    page.clock.fast_forward(5500)
    expect(page.get_by_role('button', name='Undo', exact=True)).to_have_count(0)
    page.get_by_placeholder('Search history').fill('two')
    expect(rows).to_have_count(0)
    bodies = page.evaluate("async() => (await __TAURI_INTERNALS__.invoke('plugin_kv_page', {source:'builtin',pluginId:'clipboard-history',options:{prefix:'history/items/',limit:64}})).entries.map(row=>JSON.parse(row.valueJson).text)")
    assert 'two' not in bodies, '过期删除仍留有正文'


def s11(page):
    copy(page, 'saved-text')
    history(page)
    page.get_by_role('button', name='Favorite', exact=True).first.click()
    for i, (name, value) in enumerate([('Team','cedar'),('Stage','violet')]):
        page.get_by_role('button', name='Add field', exact=True).click()
        page.get_by_placeholder('Field name', exact=True).nth(i).fill(name)
        page.get_by_placeholder('Value', exact=True).nth(i).fill(value)
    page.get_by_role('button', name='Save favorite', exact=True).click()
    expect(page.locator('.clipboard-history-item-subtitle')).to_contain_text('cedar · violet')
    page.get_by_placeholder('Search history').fill('violet')
    expect(page.locator('.clipboard-history-item')).to_have_count(1)
    page.locator('.clipboard-history-favorite-fields').get_by_role('button', name='cedar', exact=True).click()
    page.wait_for_function("__hivenSandbox.clipboard().text === 'cedar'")


def s12(page):
    command(page, 'base64 decode')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('c2FuZGJveC1yZXN1bHQ=')
    page.wait_for_timeout(400)
    field.press('Shift+Enter')
    editor(page, 'sandbox-result')


def s13(page):
    command(page, 'summarize')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('A short text for the simulated summary.')
    field.press('Enter')
    page.wait_for_timeout(300)
    expect(page.locator('.global-launcher-panel')).to_contain_text('Will send to Simulated AI')
    page.keyboard.press('Enter')
    expect(page.locator('.global-launcher-panel')).to_contain_text('Simulated summary.')
    page.keyboard.press('Escape')
    expect(page.locator('.global-launcher-panel')).to_contain_text('AI Summary')
    page.wait_for_timeout(250)
    stopped = page.locator('.global-launcher-panel').inner_text()
    page.clock.run_for(800)
    assert page.locator('.global-launcher-panel').inner_text() == stopped, 'Esc 后流仍在生成'
    page.keyboard.press('Escape')
    expect(page.get_by_placeholder(re.compile('Search (commands|actions)'))).to_be_visible()
    expect(page.locator('.global-launcher-panel')).to_contain_text('All actions')



CASES = [s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', nargs='*', choices=[case.__name__.upper() for case in CASES], help='例如 S1 S2；默认全部')
    parser.add_argument('--output', help='可选 JSON 结果路径（建议 temp/）')
    args = parser.parse_args()
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        for case in CASES:
            name = case.__name__.upper()
            if args.case and name not in args.case:
                continue
            context = browser.new_context(viewport={'width':1440,'height':900})
            page = context.new_page()
            page.set_default_timeout(5000)
            errors, external = [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://localhost:1420/') else (external.append(route.request.url.split('?')[0]), route.abort()))
            # Install before app timers. Only long deadlines are advanced; polling is real.
            page.add_init_script("""
                window.__sandboxOriginalStorage = window.localStorage;
                window.__sandboxOriginalStorage.setItem('isolation-sentinel', 'unchanged');
                Object.defineProperty(navigator, 'clipboard', {configurable:true,get(){throw new Error('RealClipboardAccess')}});
            """)
            page.clock.install()
            if name == 'S7':
                page.add_init_script("Object.defineProperty(window, '__hivenSandbox', {configurable:true,set(value){Object.defineProperty(window,'__hivenSandbox',{value,configurable:true});value.occupyShortcut('Control+Shift+V')}})")
            result = {'case': name}
            try:
                page.goto(URL)
                page.wait_for_function("window.__hivenSandbox && document.querySelector('#sandbox-editor')")
                if name != 'S7':
                    wait_snapshot(page, lambda state: 'Control+Shift+V' in state['shortcuts'])
                # The queue subscribes before clipboard.watch's initial reads finish.
                page.wait_for_timeout(600)
                page.locator('#sandbox-editor').click()
                case(page)
                assert page.evaluate("localStorage !== __sandboxOriginalStorage && __sandboxOriginalStorage.length === 1 && __sandboxOriginalStorage.getItem('isolation-sentinel') === 'unchanged'"), '真实浏览器存储被修改'
                assert not errors, errors
                assert not external, external
                result.update(status='PASS', reason='行为断言通过；无页面异常或外部请求')
            except Exception as error:
                result.update(status='FAIL', reason=str(error).strip()[:1400])
            result.update(pageErrors=errors, externalRequests=external)
            if page.evaluate('!!window.__hivenSandbox'):
                result['snapshot'] = snapshot(page)
            results.append(result)
            print(f"{name} {result['status']}: {result['reason']}", flush=True)
            context.close()
        browser.close()
    if args.output:
        Path(args.output).write_text(json.dumps(results, ensure_ascii=False, indent=2)+'\n')
    return 1 if any(item['status'] == 'FAIL' for item in results) else 0


if __name__ == '__main__':
    sys.exit(main())
