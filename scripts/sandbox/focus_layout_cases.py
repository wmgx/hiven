"""Typing focus and content-sized launcher layout, using the in-memory sandbox."""
from playwright.sync_api import expect
from v4_r2_cases import footer_bottom


def enter(page, query):
    page.evaluate('__hivenSandbox.open()')
    field = page.locator('.global-launcher-panel textarea').first
    page.wait_for_timeout(250)
    field.click()
    field.fill(query)
    expect(page.locator('[data-launcher-row-index]').first).to_be_visible()
    field.press('Enter')


def s58(page):
    # Picking a value chip option hands focus back to the field typed in before.
    page.evaluate('__hivenSandbox.appearance("light", "zh")')
    enter(page, 'qr')
    field = page.locator('.qr-surface__input')
    expect(field).to_be_focused()
    page.locator('[data-value-chip]').first.click()
    page.locator('.hiven-value-menu [role=option]').nth(1).click()
    expect(field).to_be_focused()
    page.keyboard.type('hi')
    expect(field).to_have_value('hi')
    page.keyboard.press('Escape')
    # A clicked history row keeps ⌫ for deletion; typing still goes to the search.
    page.evaluate('__hivenSandbox.copy("synthetic focus")')
    page.wait_for_timeout(500)
    page.evaluate('__hivenSandbox.openSurface({pluginId:"clipboard-history",surfaceId:"main",source:"builtin"})')
    page.locator('.clipboard-history-item').first.click()
    page.keyboard.type('syn')
    expect(page.locator('[data-clipboard-history-search]')).to_have_value('syn')


def s59(page):
    # Overflowing command content scrolls inside the capped panel; fixed surfaces fill their window.
    page.evaluate('__hivenSandbox.appearance("light", "zh")')
    enter(page, '计算器')
    field = page.locator('#calculator-expression')
    for index in range(14):
        field.fill(f'{index}+1')
        field.press('Enter')
    page.clock.run_for(300)
    page.wait_for_function('__hivenSandbox.launcherSize()?.height === 640')
    footer_bottom(page, '.surface-shell-footer')
    body = page.locator('.global-launcher-surface-shell .surface-chrome-body')
    assert body.evaluate('el => el.scrollHeight > el.clientHeight'), 'long history must scroll'
    body.evaluate('el => { el.scrollTop = el.scrollHeight }')
    last = page.locator('.global-launcher-panel').get_by_text('0+1', exact=True)
    assert last.bounding_box()['y'] + last.bounding_box()['height'] <= page.locator('.surface-shell-footer').bounding_box()['y'] + 1
    page.keyboard.press('Escape')
    enter(page, '大爆炸')
    page.clock.run_for(300)
    window = page.evaluate('__hivenSandbox.launcherSize().height')
    assert round(page.locator('.global-launcher-panel').bounding_box()['height']) == window - 24, window
    footer_bottom(page, '.surface-shell-footer')
