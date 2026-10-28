"""V4 behavior checks using only the existing in-memory browser sandbox."""
from playwright.sync_api import expect


def s33(page):
    page.evaluate('__hivenSandbox.open()')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('sort lines')
    page.wait_for_timeout(200)
    field.press('Enter')
    field = page.locator('.global-launcher-panel textarea').first
    field.evaluate("el => {const data = new DataTransfer(); data.setData('text/plain','b\\na\\nc');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))}")
    result = page.get_by_test_id('launcher-preview-well')
    expect(result).to_have_text('a\nb\nc')
    chip = page.locator('[data-value-chip]').first
    chip.click()
    menu = page.locator('.hiven-value-menu')
    assert menu.bounding_box()['y'] >= chip.bounding_box()['y'] + chip.bounding_box()['height']
    menu.get_by_role('option', name='Descending', exact=True).hover()
    expect(result).to_have_text('c\nb\na')
    page.keyboard.press('Escape')
    expect(menu).to_have_count(0)
    expect(result).to_have_text('a\nb\nc')
    field.press('Tab')
    page.keyboard.press('ArrowDown')
    expect(result).to_have_text('c\nb\na')
    page.keyboard.press('Tab')
    expect(menu.get_by_role('listbox', name='Ignore case')).to_be_visible()
    page.keyboard.press('Escape')
    expect(result).to_have_text('c\nb\na')
    field.press('Meta+k')
    expect(page.get_by_role('menu')).to_be_visible()
    page.keyboard.press('Escape')
    expect(page.get_by_role('menu')).to_have_count(0)
    expect(result).to_be_visible()


def s34(page):
    page.evaluate('__hivenSandbox.open()')
    field = page.locator('.global-launcher-panel textarea').first
    page.wait_for_timeout(250)
    field.fill('json minify')
    expect(page.locator('[data-launcher-row-index]').first).to_be_visible()
    field.press('Enter')
    field.fill('{bad')
    error = page.locator('.global-launcher-panel [role=alert]')
    expect(error).to_be_visible()
    header = page.locator('.global-launcher-header')
    assert error.bounding_box()['y'] >= header.bounding_box()['y'] + header.bounding_box()['height']
    field.fill('{"a":1}')
    expect(error).to_have_count(0)
    expect(page.get_by_test_id('launcher-preview-well')).to_have_text('{"a":1}')
    expect(page.locator('.global-launcher-panel .surface-toasts, .global-launcher-panel .toast-container')).to_have_count(0)
    field.press('Enter')
    page.wait_for_function('!__hivenSandbox.launcherVisible()')
    page.wait_for_function('__hivenSandbox.toasts().some(t => t.slot === "flash" && t.level === "success")')
    assert page.evaluate('__hivenSandbox.clipboard().text') == '{"a":1}'
    notices = page.evaluate('__hivenSandbox.toasts()')
    assert all('{"a":1}' not in notice['message'] for notice in notices)
