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


def s35(page):
    page.evaluate('__hivenSandbox.open()')
    query = page.locator('.global-launcher-panel textarea').first
    page.wait_for_timeout(250)
    query.fill('calculator')
    expect(page.locator('[data-launcher-row-index]').first).to_be_visible()
    query.press('Enter')
    field = page.get_by_role('textbox', name='Expression', exact=True)
    expect(page.locator('.surface-chrome-field #calculator-expression')).to_be_visible()
    field.fill('x = 2 + 3')
    expect(page.locator('.calculator-surface__result output')).to_have_text('5')
    field.press('Enter')
    expect(field).to_have_value('')
    expect(page.locator('.calculator-surface__variables')).to_contain_text('x = 5')
    expect(page.locator('.calculator-surface__result output')).to_have_text('5')
    page.wait_for_function("document.querySelector('.calculator-surface__body').getBoundingClientRect().bottom <= document.querySelector('.surface-shell-footer').getBoundingClientRect().top + 1")
    field.press('ArrowUp')
    expect(field).to_have_value('x = 2 + 3')
    field.press('ArrowDown')
    expect(field).to_have_value('')
    page.get_by_role('button', name='Use 5', exact=True).click()
    expect(field).to_have_value('5')
    field.fill('x * 4')
    expect(page.locator('.calculator-surface__result output')).to_have_text('20')
    field.press('Shift+Enter')
    expect(page.locator('#sandbox-editor')).to_have_value('20')


def s36(page):
    page.evaluate('__hivenSandbox.openSurface({pluginId:"text-tools",surfaceId:"base64",source:"builtin"})')
    field = page.locator('.surface-chrome-field textarea')
    field.fill('hello world')
    result = page.get_by_test_id('base64-result')
    expect(result).to_have_text('aGVsbG8gd29ybGQ=')
    chip = page.locator('[data-value-chip]')
    chip.click()
    page.locator('.hiven-value-menu').get_by_role('option', name='Auto', exact=True).hover()
    page.locator('.hiven-value-menu').get_by_role('option', name='Decode text', exact=True).hover()
    assert chip.get_attribute('aria-label') == 'Direction: Decode text', page.locator('.surface-chrome').inner_text()
    expect(page.locator('.surface-shell-error')).not_to_be_empty()
    page.keyboard.press('Escape')
    expect(result).to_have_text('aGVsbG8gd29ybGQ=')
    field.fill('aGVsbG8gd29ybGQ=')
    expect(result).to_have_text('hello world')
    field.fill('long material ' * 100)
    expect(field).to_have_attribute('data-multiline', 'true')
    size = field.evaluate('el => ({font:getComputedStyle(el).fontSize, line:parseFloat(getComputedStyle(el).lineHeight), height:el.clientHeight, scroll:el.scrollHeight})')
    assert size['font'] == '14px' and size['height'] <= size['line'] * 4 + 2 and size['scroll'] > size['height']
    field.fill('')
    field.evaluate("el => {const data = new DataTransfer(); data.setData('text/plain','one\\ntwo');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))}")
    expect(field).to_have_attribute('readonly', '')
    field.press('Meta+e')
    expanded = page.locator('.launcher-block-editor')
    expect(expanded).to_have_value('one\ntwo')
    expanded.press('Escape')
    expect(expanded).to_have_count(0)
    expect(result).to_have_text('b25lCnR3bw==')
