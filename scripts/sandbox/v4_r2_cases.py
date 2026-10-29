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


def capture(page, name):
    from pathlib import Path
    folder = Path('temp/v4r2-visual')
    folder.mkdir(parents=True, exist_ok=True)
    for theme in ['light', 'dark']:
        page.evaluate('theme => __hivenSandbox.appearance(theme, "zh")', theme)
        page.clock.run_for(400)
        page.locator('.global-launcher-panel').screenshot(path=str(folder / f'{name}-{theme}.png'), animations='disabled')


def s49(page):
    page.evaluate('__hivenSandbox.copy("synthetic favorite")')
    page.wait_for_timeout(500)
    page.evaluate('__hivenSandbox.openSurface({pluginId:"clipboard-history",surfaceId:"main",source:"builtin"})')
    page.locator('.clipboard-history-item').first.click()
    page.clock.run_for(100)
    page.keyboard.press('Alt+p')
    expect(page.get_by_role('button', name='Remove favorite', exact=True)).to_be_visible()
    page.keyboard.press('Meta+e')
    form = page.locator('.clipboard-history-favorite-form.is-editing')
    title = form.get_by_placeholder('Title', exact=True)
    title.fill('Synthetic favorite')
    title.press('Enter')
    name = form.get_by_placeholder('Field name', exact=True).first
    expect(name).to_be_focused()
    name.fill('Team')
    name.press('Tab')
    value = form.get_by_placeholder('Value', exact=True).first
    expect(value).to_be_focused()
    expect(form).to_be_visible()
    value.fill('Synthetic')
    value.press('Shift+Tab')
    expect(name).to_be_focused()
    expect(page.locator('.surface-shell-footer .hiven-ui-surface-actionbar')).to_have_count(1)
    expect(page.get_by_role('button', name='Done', exact=False)).to_have_count(1)
    expect(page.locator('.clipboard-history-footer')).to_have_count(0)
    capture(page, 'V3-favorite')


def s50(page):
    page.evaluate('__hivenSandbox.open()')
    page.wait_for_timeout(250)
    page.locator('.global-launcher-panel textarea').first.fill('translate')
    page.evaluate('__hivenSandbox.appearance("light", "zh")')
    page.evaluate('__hivenSandbox.openSettings("translate")')
    chip = page.locator('[data-settings-field-key=defaultTargetLang] [data-value-chip]')
    chip.click()
    menu = page.locator('.hiven-value-menu')
    field = menu.get_by_role('textbox', name='默认目标语种')
    expect(field).to_be_focused()
    field.fill('日')
    expect(menu.get_by_role('option')).to_have_count(1)
    expect(menu.get_by_role('option')).to_contain_text('日')
    field.evaluate("el => {el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true,cancelable:true}))}")
    expect(menu).to_be_visible()
    field.evaluate("el => el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日'}))")
    page.clock.run_for(150)
    field.press('Enter')
    expect(chip).to_contain_text('日')
    page.keyboard.press('Escape')
    expect(page.locator('.global-launcher-panel textarea').first).to_have_value('')
