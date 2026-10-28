#!/usr/bin/env python3
"""Run against the existing Vite server. Fresh browser contexts; no desktop bridge."""
import argparse
import json
import re
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from v4_cases import s33, s34, s35, s36, s37, s38, s39, s40, s41, s42, s43, s44, s45, s46

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
    page.wait_for_timeout(250)
    field.click()
    field.fill(query)
    expect(page.locator('[data-launcher-row-index]').first).to_be_visible()
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
    page.get_by_role('button', name='Edit', exact=True).click()
    for i, (name, value) in enumerate([('Team','cedar'),('Stage','violet')]):
        page.get_by_placeholder('Field name', exact=True).nth(i).fill(name)
        page.get_by_placeholder('Value', exact=True).nth(i).fill(value)
    page.get_by_placeholder('Value', exact=True).last.press('Escape')
    expect(page.locator('.clipboard-history-item-subtitle')).to_contain_text('cedar · violet')
    page.get_by_placeholder('Search history').fill('violet')
    expect(page.locator('.clipboard-history-item')).to_have_count(1)
    page.locator('.clipboard-history-favorite-fields').get_by_role('button', name='cedar', exact=True).click()
    page.wait_for_function("__hivenSandbox.clipboard().text === 'cedar'")


def s12(page):
    copy(page, 'c2FuZGJveC1yZXN1bHQ=')
    command(page, 'base64')
    surface = page.locator('.base64-surface')
    expect(surface.get_by_test_id('base64-result')).to_have_text('sandbox-result')
    page.get_by_role('button', name=re.compile('Paste to')).click()
    editor(page, 'sandbox-result')


def s13(page):
    command(page, 'summarize')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('A short text for the simulated summary.')
    expect(page.locator('.global-launcher-panel')).to_contain_text('Press ↵ to send to Simulated AI')
    expect(page.get_by_test_id('launcher-preview-well')).to_have_text('A short text for the simulated summary.')
    field.press('Enter')
    expect(page.locator('.launcher-command-footer')).to_contain_text('Sent to Simulated AI')
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



SCREENSHOTS = None


def capture_themes(page, name, root):
    if not SCREENSHOTS:
        return
    for theme in ['light', 'dark']:
        page.evaluate('theme => __hivenSandbox.appearance(theme, "en")', theme)
        page.clock.run_for(200)
        root.screenshot(animations="disabled", path=str(SCREENSHOTS / f"{name}-{theme}.png"))


def open_surface(page, target, presentation='inline'):
    if presentation == 'inline':
        page.set_viewport_size({'width':1440,'height':900})
    page.evaluate('([target, presentation]) => __hivenSandbox.openSurface(target, presentation)', [target, presentation])
    if presentation == 'window':
        size = page.evaluate('__hivenSandbox.surfaceWindow()')
        page.set_viewport_size({'width':size['width'], 'height':size['height']})
    chrome = page.locator('.surface-chrome:visible')
    expect(chrome).to_have_count(1)
    expect(chrome.locator('.surface-shell-tag')).not_to_be_empty()
    roots = {'calculator':'.calculator-surface', 'clipboard-history':'.clipboard-history-surface', 'csv':'.csv-tools-surface', 'date-time-assistant':'.date-time-surface', 'image-tools':'.image-tools-surface', 'qr-code':'.qr-surface', 'regex-tester':'.regex-tester-surface', 'text-explode':'.text-explode-surface', 'text-tools':'.url-query-surface, .json-expression-surface, .base64-surface', 'text-diff':'.td-surface', 'translate':'.translate-surface'}
    expect(chrome.locator(roots[target['pluginId']])).to_be_visible()
    return chrome


def surfaces(page):
    page.wait_for_function('document.querySelector(".global-launcher-panel")')
    return page.evaluate('__hivenSandbox.surfaces()')


def s14(page):
    for plugin in page.evaluate('__hivenSandbox.plugins()'):
        manifests = list(Path('src/plugins').glob('*/manifest.json'))
        expected = next(json.loads(p.read_text())['version'] for p in manifests if json.loads(p.read_text())['pluginId'] == plugin['pluginId'])
        assert plugin['version'] == expected, f"loaded version differs: {plugin['pluginId']}"

    targets = surfaces(page)
    assert len(targets) >= 18, targets
    for language, theme in [('en', 'light'), ('zh', 'dark')]:
        page.evaluate('([theme, locale]) => __hivenSandbox.appearance(theme, locale)', [theme, language])
        for target in targets:
            for presentation in ['inline', 'window']:
                chrome = open_surface(page, target, presentation)
                title = target.get('titleI18n', {}).get(language, target['title'])
                expect(chrome.locator('.surface-shell-title')).to_have_text(title)
                header = chrome.locator('.surface-chrome-header')
                # A header that hosts the surface's input grows to fit a bordered field.
                expected = 56
                assert round(header.bounding_box()['height']) == expected, target
                assert header.locator('button[data-tauri-drag-region]').count() == 0
                assert chrome.locator('.surface-chrome-body').get_attribute('data-no-drag') is not None
                assert chrome.locator('.surface-chrome-body [data-tauri-drag-region]').count() == 0
                assert chrome.locator('.surface-chrome-actions > *').count() <= 3
                if presentation == 'window':
                    assert header.get_attribute('data-tauri-drag-region') is not None
                else:
                    before = page.evaluate('__hivenSandbox.dragCount()')
                    header.dispatch_event('pointerdown', {'button': 0})
                    page.wait_for_timeout(50)
                    assert page.evaluate('__hivenSandbox.dragCount()') == before + 1, target
                    header.locator('button').first.dispatch_event('pointerdown', {'button': 0})
                    chrome.locator('.surface-chrome-body').dispatch_event('pointerdown', {'button': 0})
                    page.wait_for_timeout(50)
                    assert page.evaluate('__hivenSandbox.dragCount()') == before + 1, target
                if SCREENSHOTS and target['pluginId'] != 'clipboard-history':
                    chrome.screenshot(animations="disabled", path=str(SCREENSHOTS / f"{target['pluginId']}-{target['surfaceId']}-{presentation}-{theme}.png"))
    print(f'S14 checked {len(targets)} surfaces × 2 presentations × 2 locales/themes', flush=True)


def s15(page):
    target = next(item for item in surfaces(page) if item['pluginId'] == 'calculator')
    for method in ['escape', 'back']:
        chrome = open_surface(page, target)
        expect(page.locator('.global-launcher-header')).to_have_count(0)
        if method == 'escape':
            chrome.focus()
            page.keyboard.press('Escape')
        else:
            chrome.locator('.surface-shell-tag').click()
        expect(page.get_by_placeholder(re.compile('Search (commands|actions)'))).to_be_visible()
        expect(page.locator('.surface-chrome:visible')).to_have_count(0)


def s16(page):
    copy(page, 'undo-a', 'undo-b')
    for presentation in ['inline', 'window']:
        target = next(item for item in surfaces(page) if item['pluginId'] == 'clipboard-history')
        chrome = open_surface(page, target, presentation)
        rows = chrome.locator('.clipboard-history-item')
        expect(rows).to_have_count(2)
        rows.first.click()
        page.keyboard.press('Backspace')
        toast = chrome.locator('.surface-feedback-inline')
        expect(toast).to_contain_text('Deleted')
        assert page.evaluate('__hivenSandbox.surfaceFeedback()')[0]['level'] == 'success'
        toast.hover()
        page.clock.fast_forward(1000)
        expect(toast).to_be_visible()
        toast.get_by_role('button', name='Undo', exact=True).click()
        expect(rows).to_have_count(2)
        expect(toast).to_have_count(0)
    rows.first.click()
    page.keyboard.press('Backspace')
    page.mouse.move(1, 1)
    page.clock.fast_forward(5500)
    expect(chrome.locator('.surface-feedback-inline')).to_have_count(0)
    expect(rows).to_have_count(1)


def s17(page):
    copy(page, 'synthetic text')
    page.evaluate('__hivenSandbox.copyImage()')
    page.wait_for_timeout(500)
    chrome = open_surface(page, {'pluginId':'clipboard-history', 'surfaceId':'main', 'source':'builtin'})
    rows = chrome.locator('.clipboard-history-item')
    expect(rows).to_have_count(2)
    rows.first.click()
    page.keyboard.press('Shift+ArrowDown')
    # Mixed selections paste their text; the skip is announced before Enter.
    expect(chrome.get_by_text('1 image/file item(s) will be skipped')).to_be_visible()
    page.keyboard.press('Enter')
    editor(page, 'synthetic text')


def s18(page):
    sizes = {'small': [728, 400, 480, 400], 'medium': [728, 560, 600, 400], 'large': [960, 640, 720, 480]}
    for target in surfaces(page):
        chrome = open_surface(page, target, 'window')
        actual = page.evaluate('__hivenSandbox.surfaceWindow()')
        expected = sizes[target.get('shell', {}).get('size', 'medium')]
        assert [actual[key] for key in ['width', 'height', 'minWidth', 'minHeight']] == expected, actual
        frame = page.locator('.sandbox-surface .plugin-surface-window-frame')
        rect = frame.bounding_box()
        assert [round(rect['width']), round(rect['height'])] == expected[:2], (target, rect)
        overflow = chrome.evaluate('root => [root, ...root.querySelectorAll("*")].filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && ["auto", "scroll"].includes(getComputedStyle(el).overflowX)).map(el => el.className)')
        assert not overflow, (target, overflow)


def s19(page):
    command(page, 'uppercase')
    field = page.locator('.global-launcher-panel textarea').first
    text = '\n'.join(f'synthetic line {i}' for i in range(80))
    field.evaluate("(el, text) => { const data = new DataTransfer(); data.setData('text/plain', text); el.dispatchEvent(new ClipboardEvent('paste', {bubbles:true, cancelable:true, clipboardData:data})) }", text)
    well = page.get_by_test_id('launcher-preview-well')
    expect(well).to_contain_text('SYNTHETIC LINE 79')
    assert well.inner_text().count('\n') >= 79
    page.wait_for_function('__hivenSandbox.launcherSize()?.height === 640')
    assert well.evaluate('el => el.scrollHeight > el.clientHeight')
    field.press('Meta+e')
    page.locator('.launcher-block-editor').fill('\n'.join(f'synthetic line {i}' for i in range(100)))
    page.locator('.launcher-block-editor').press('Meta+e')
    expect(well).to_contain_text('SYNTHETIC LINE 99')
    assert page.evaluate('__hivenSandbox.launcherSize().height') == 640


def s20(page):
    command(page, 'uppercase')
    page.wait_for_function('__hivenSandbox.launcherSize()?.height === 318')
    handle = page.get_by_role('separator', name='Resize command window')
    rect = handle.bounding_box()
    page.mouse.move(rect['x'] + rect['width']/2, rect['y'] + rect['height']/2)
    page.mouse.down()
    page.mouse.move(rect['x'] + rect['width']/2, rect['y'] + rect['height']/2 + 322, steps=8)
    page.mouse.up()
    page.wait_for_function('__hivenSandbox.launcherSize()?.height === 640')
    page.keyboard.press('Escape')
    page.wait_for_function('__hivenSandbox.launcherSize()?.height !== 640')
    command(page, 'lowercase')
    page.wait_for_function('__hivenSandbox.launcherSize()?.height === 640')
    page.keyboard.press('Escape')
    page.keyboard.press('Escape')
    command(page, 'uppercase')
    page.wait_for_function('__hivenSandbox.launcherSize()?.height === 640')


def s21(page):
    command(page, 'summarize')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('synthetic input')
    expect(page.locator('.launcher-command-footer-spacer')).to_be_empty()
    expect(page.locator('.global-launcher-footer').get_by_role('button')).to_have_count(1)
    expect(page.get_by_test_id('launcher-preview-well')).not_to_contain_text('↵ Run')
    page.keyboard.press('Escape')
    command(page, 'uppercase')
    page.locator('.global-launcher-panel textarea').first.fill('x' * (1024 * 1024 + 1))
    expect(page.locator('.launcher-command-footer-spacer')).to_have_text('Long input, ↵ to run')
    expect(page.get_by_test_id('launcher-preview-well')).not_to_contain_text('Long input, ↵ to run')


def s22(page):
    command(page, 'summarize')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('Synthetic input for the simulated summary.')
    expect(page.locator('.launcher-command-footer-spacer')).to_be_empty()
    expect(page.locator('.global-launcher-footer').get_by_role('button')).to_have_count(1)
    field.press('Enter')
    expect(page.get_by_test_id('launcher-ai-send')).to_have_count(0)
    expect(page.locator('.launcher-command-footer-spacer')).to_contain_text('Sent to Simulated AI')
    expect(page.locator('.launcher-command-footer-spacer')).to_have_class(re.compile('anim-running-pulse'))
    page.keyboard.press('Escape')
    expect(page.locator('.launcher-command-footer-spacer')).not_to_have_class(re.compile('anim-running-pulse'))


def s23(page):
    page.evaluate('__hivenSandbox.open()')
    page.locator('.global-launcher-panel textarea').first.focus()
    expect(page.locator('.launcher-clipboard-explanation')).to_be_visible()
    # Real use closes the launcher, copies in another app, then reopens it.
    page.keyboard.press('Escape')
    copy(page, '{"synthetic":true}')
    page.evaluate('__hivenSandbox.open()')
    # The installed fake clock also holds requestAnimationFrame.
    page.clock.run_for(1200)
    expect(page.locator('.launcher-clipboard-explanation')).to_have_count(0)
    expect(page.locator('.global-launcher-panel')).to_contain_text('{"synthetic":true}')


def s24(page):
    changed = {'calculator', 'csv', 'date-time-assistant', 'image-tools', 'qr-code', 'regex-tester', 'text-explode', 'translate'}
    for target in surfaces(page):
        if target['pluginId'] not in changed:
            continue
        for presentation in ['inline', 'window']:
            chrome = open_surface(page, target, presentation)
            title = chrome.locator('.surface-shell-tag').inner_text()
            expect(chrome.locator('.surface-chrome-body').get_by_text(title, exact=True)).to_have_count(0)


def s25(page):
    copy(page, 'synthetic-favorite')
    rows = history(page)
    rows.first.click()
    page.keyboard.press('Alt+p')
    expect(page.get_by_role('dialog')).to_have_count(0)
    expect(page.locator('.clipboard-history-item-row').first.get_by_role('button', name='Remove favorite', exact=True)).to_be_visible()
    expect(page.locator('.surface-feedback-inline')).to_contain_text('Favorited')
    rows.first.click()
    page.keyboard.press('Alt+p')
    expect(page.locator('.clipboard-history-item-row').first.get_by_role('button', name='Favorite', exact=True)).to_be_visible()


def s26(page):
    copy(page, 'other-item', 'editable-item')
    rows = history(page)
    rows.first.click()
    page.keyboard.press('Alt+p')
    expect(page.locator('.clipboard-history-item-row').first.get_by_role('button', name='Remove favorite', exact=True)).to_be_visible()
    page.keyboard.press('Meta+e')
    page.get_by_placeholder('Title', exact=True).fill('Saved title')
    for i, (name, value) in enumerate([('Team', 'cedar'), ('Stage', 'violet')]):
        page.get_by_placeholder('Field name', exact=True).nth(i).fill(name)
        page.get_by_placeholder('Value', exact=True).nth(i).fill(value)
    expect(page.get_by_role('button', name='Save', exact=True)).to_have_count(0)
    rows.filter(has_text='other-item').click()
    rows.filter(has_text='Saved title').click()
    table = page.locator('table.clipboard-history-favorite-fields')
    expect(table).to_contain_text('cedar')
    expect(table).to_contain_text('violet')
    expect(page.locator('.clipboard-history-item-subtitle').filter(has_text='cedar · violet')).to_be_visible()
    page.get_by_placeholder('Search history').fill('violet')
    expect(rows).to_have_count(1)


def s27(page):
    command(page, 'summarize')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('token ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8')
    expect(page.locator('.global-launcher-panel [role=alert]')).to_contain_text('Sending is blocked')
    expect(page.locator('.l-foot-primary')).to_be_disabled()
    field.press('Enter')
    expect(page.get_by_test_id('launcher-ai-send')).to_have_count(0)
    expect(page.locator('.global-launcher-panel')).not_to_contain_text('Simulated summary.')
    field.fill('Synthetic input after a blocked secret.')
    expect(page.locator('.l-foot-primary')).to_be_enabled()
    field.press('Enter')
    expect(page.locator('.global-launcher-panel')).to_contain_text('Simulated summary.')
    expect(page.locator('.launcher-command-footer')).to_contain_text('Sent to Simulated AI')
    page.keyboard.press('Escape')
    page.keyboard.press('Escape')
    page.evaluate('__hivenSandbox.openSettings()')
    expect(page.locator('[data-ai-send-summary], [data-ai-send-grants]')).to_have_count(0)
    page.evaluate('__hivenSandbox.appearance("dark", "zh")')
    expect(page.locator('body')).not_to_contain_text('直接发送的命令')
    page.evaluate('__hivenSandbox.appearance("light", "en")')
    expect(page.locator('body')).not_to_contain_text('Commands that send directly')


def s28(page):
    page.evaluate('__hivenSandbox.open()')
    page.wait_for_function('document.querySelector(".global-launcher-panel")')
    text = '{"a":{"b":[1,2]}}'
    page.evaluate('([text, offset]) => __hivenSandbox.runCursorCommand(text, offset)', [text, text.index('2') + 1])
    page.wait_for_function("__hivenSandbox.clipboard().text === '$[\"a\"][\"b\"][1]'")
    expect(page.locator('body')).to_contain_text('Copied: $["a"]["b"][1]')


def s29(page):
    copy(page, '{"a":{"b":[1,2]}}')
    command(page, 'json expression')
    surface = page.locator('.json-expression-surface')
    expect(surface.get_by_role('textbox', name='JSON', exact=True)).to_have_value('{"a":{"b":[1,2]}}')
    expression = page.get_by_role('textbox', name='Expression', exact=True)
    expression.fill('.a.b[1]')
    expect(surface.get_by_role('textbox', name='Result', exact=True)).to_have_value('2')
    capture_themes(page, 'json-expression', page.locator('.surface-chrome:visible'))
    expression.fill('.a[')
    expect(page.locator('.surface-shell-error')).not_to_be_empty()
    expression.fill('.a.b[1]')
    page.locator('.hiven-output-actions').get_by_role('button', name='Copy', exact=False).click()
    page.wait_for_function('__hivenSandbox.clipboard().text === "2"')
    expect(surface).to_have_count(0)


def s30(page):
    page.evaluate('__hivenSandbox.copyImage()')
    command(page, 'base64')
    surface = page.locator('.base64-surface')
    output = surface.get_by_test_id('base64-result')
    expect(output).to_have_text(re.compile('^data:image/png;base64,'))
    expect(surface.get_by_role('img', name='Image preview')).to_be_visible()
    capture_themes(page, 'base64-image', page.locator('.surface-chrome:visible'))
    uri = output.inner_text()
    page.locator('.surface-chrome-field textarea').fill(uri)
    expect(surface.get_by_role('img', name='Image preview')).to_be_visible()
    before = page.evaluate('__hivenSandbox.clipboard().changeCount')
    page.get_by_role('button', name='Copy image', exact=True).click()
    page.wait_for_function('before => __hivenSandbox.clipboard().kind === "image" && __hivenSandbox.clipboard().changeCount > before', arg=before)
    page.locator('.surface-chrome-field textarea').fill('hello world')
    expect(output).to_have_text('aGVsbG8gd29ybGQ=')
    page.locator('.surface-chrome-field textarea').fill('aGVsbG8gd29ybGQ=')
    expect(output).to_have_text('hello world')
    page.keyboard.press('Escape')
    page.evaluate('__hivenSandbox.open()')
    page.locator('.global-launcher-panel textarea').first.fill('base64')
    page.wait_for_timeout(250)
    expect(page.locator('.launcher-item-title').filter(has_text=re.compile('^Base64$'))).to_have_count(1)
    assert not any(item['surfaceId'] == 'image-base64' for item in surfaces(page))


def s31(page):
    page.evaluate('__hivenSandbox.openSettings("web-open")')
    for theme in ['light', 'dark']:
        page.evaluate('theme => __hivenSandbox.appearance(theme, "en")', theme)
        for name in ['Configure', 'Manage']:
            page.get_by_role('button', name=name, exact=True).click()
            modal = page.locator('[data-settings-page]:not([data-settings-page=root])')
            expect(modal).to_be_visible()
            expect(modal.locator('select')).to_have_count(0)
            assert modal.locator('input:not([data-slot]):not([type=hidden]):not([aria-hidden=true])').count() == 0, modal.locator('input:not([data-slot]):not([type=hidden]):not([aria-hidden=true])').evaluate_all('(els)=>els.map(e=>e.outerHTML)')
            assert modal.locator('button:not([data-slot]):not([data-settings-modal-close]):not(.hiven-ui-select-trigger):not(.hiven-ui-button)').count() == 0, modal.locator('button:not([data-slot]):not([data-settings-modal-close]):not(.hiven-ui-select-trigger):not(.hiven-ui-button)').evaluate_all('(els)=>els.map(e=>e.outerHTML)')
            if name == 'Configure':
                expect(modal.get_by_role('switch')).to_have_count(3)
            if SCREENSHOTS:
                modal.screenshot(animations="disabled", path=str(SCREENSHOTS / f"web-open-{name}-{theme}.png"))
            page.locator('.surface-shell-tag').click()
            page.clock.run_for(200)


def s32(page):
    copy(page, 'synthetic focus')
    target = {'pluginId':'clipboard-history', 'surfaceId':'main', 'source':'builtin'}
    for presentation in ['inline', 'window']:
        chrome = open_surface(page, target, presentation)
        # The header search takes focus on open; no transient placeholder text in the body.
        page.wait_for_function('document.activeElement?.hasAttribute("data-clipboard-history-search")')
        expect(chrome.get_by_text('Loading', exact=True)).to_have_count(0)
        expect(chrome.get_by_text('No preview', exact=True)).to_have_count(0)
        # Reshowing a retained window: focus left on a row goes back to the search.
        chrome.locator('.clipboard-history-item').first.click()
        page.wait_for_function('!document.activeElement?.hasAttribute("data-clipboard-history-search")')
        page.evaluate('window.dispatchEvent(new Event("focus"))')
        page.wait_for_function('document.activeElement?.hasAttribute("data-clipboard-history-search")')


CASES = [s1,s2,s3,s4,s5,s6,s7,s8,s9,s10,s11,s12,s13,s14,s15,s16,s17,s18,s19,s20,s21,s22,s23,s24,s25,s26,s27,s28,s29,s30,s31,s32,s33,s34,s35,s36,s37,s38,s39,s40,s41,s42,s43,s44,s45,s46]


def main():
    global SCREENSHOTS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', nargs='*', choices=[case.__name__.upper() for case in CASES], help='例如 S1 S2；默认全部')
    parser.add_argument('--output', help='可选 JSON 结果路径（建议 temp/）')
    parser.add_argument('--screenshots', help='S14 截图目录；不截图剪贴板历史')
    args = parser.parse_args()
    if args.screenshots:
        SCREENSHOTS = Path(args.screenshots)
        SCREENSHOTS.mkdir(parents=True, exist_ok=True)
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
            errors, external, console_errors = [], [], []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: console_errors.append(message.text) if message.type == 'error' else None)
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
                assert not console_errors, console_errors
                result.update(status='PASS', reason='行为断言通过；无页面异常或外部请求')
            except Exception as error:
                result.update(status='FAIL', reason=str(error).strip()[:1400])
                result['geometry'] = page.evaluate('({size:window.__hivenSandbox?.launcherSize(), parts: [...document.querySelectorAll(".global-launcher-panel,.launcher-result-text-frame,.launcher-preview-well,.launcher-preview-well pre")].map(el=>({class:el.className,height:el.clientHeight,scroll:el.scrollHeight}))})')
            result.update(pageErrors=errors, externalRequests=external, consoleErrors=console_errors)
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
