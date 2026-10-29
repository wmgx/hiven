"""Round 2 regressions; all data and output stay inside the in-memory sandbox."""
from playwright.sync_api import expect


def s48(page):
    page.evaluate('__hivenSandbox.open()')
    query = page.locator('.global-launcher-panel textarea').first
    page.wait_for_timeout(250)
    query.fill('12*3+4')
    expect(page.locator('[data-launcher-row-index]').first).to_contain_text('40')
    query.press('Tab')
    field = page.locator('#calculator-expression')
    expect(field).to_have_value('12*3+4')
    field.fill('')
    field.press('Backspace')
    expect(page.locator('.global-launcher-panel textarea').first).to_have_value('12*3+4')
    query.fill('base64')
    expect(page.locator('[data-launcher-row-index]').first).to_contain_text('Base64')
    query.press('Enter')
    field = page.locator('[data-command-input]')
    expect(field).to_be_visible()
    field.evaluate("el => {const data = new DataTransfer(); data.setData('text/plain','one\\ntwo');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))}")
    expect(field).to_have_attribute('readonly', '')
    field.press('Backspace')
    expect(field).not_to_have_attribute('readonly', '')
    expect(field).to_have_value('')
    field.press('Backspace')
    expect(page.locator('.global-launcher-panel textarea').first).to_have_value('base64')
