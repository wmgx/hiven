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


def capture(page, name, prepare=None):
    from pathlib import Path
    folder = Path('temp/v4r2-visual')
    folder.mkdir(parents=True, exist_ok=True)
    for theme in ['light', 'dark']:
        page.evaluate('theme => __hivenSandbox.appearance(theme, "zh")', theme)
        page.clock.run_for(400)
        if prepare:
            prepare()
            page.clock.run_for(200)
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
    def editing():
        button = page.locator('.clipboard-history-favorite-title-bar button')
        if button.count():
            button.click()
        expect(page.locator('.clipboard-history-favorite-form.is-editing')).to_be_visible()
        expect(page.get_by_role('button', name='完成', exact=False)).to_have_count(1)
    capture(page, 'V3-favorite', editing)


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


def s51(page):
    import json
    left = '{\n  "version": "1.2.0",\n  "owner": "alice",\n  "features": ["a", "b"]\n}'
    right = '{"version":"2.0.0","owner":"bob","features":["a","b","c"],"region":"sg"}'
    payload = json.dumps({'original': {'text': left}, 'modified': {'text': right}})
    page.evaluate('__hivenSandbox.appearance("light", "zh")')
    page.evaluate('initialText => __hivenSandbox.openSurface({pluginId:"text-diff",surfaceId:"main",source:"builtin",initialText})', payload)
    status = page.locator('.surface-shell-status')
    expect(status).to_contain_text('4 处差异：改 2 · 删 0 · 增 2')
    chips = page.locator('.td-pane-labels [data-value-chip]')
    expect(chips.nth(0)).to_contain_text('手动输入')
    expect(chips.nth(1)).to_contain_text('手动输入')
    assert not any(word in chips.all_text_contents() for word in ['original', 'modified'])
    expect(page.locator('.td-json-changed').first).to_be_visible()
    expect(page.locator('.td-json-added').first).to_be_visible()
    assert page.locator('.td-body .monaco-editor').nth(1).locator('.view-line').count() > 1
    page.get_by_role('button', name='下一处', exact=True).click()
    # Editing exposes the original text; JSON display formatting never rewrites the source.
    page.locator('.td-body .monaco-editor').nth(1).click()
    page.clock.run_for(100)
    page.keyboard.press('Meta+a')
    page.clock.run_for(100)
    page.evaluate("text => {const data=new DataTransfer();data.setData('text/plain',text);document.activeElement.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}))}", '{"version":"2.0.0","features":["a","b","c"],"region":"sg"}')
    page.clock.run_for(400)
    page.locator('.surface-chrome-header').click(position={'x':350,'y':20})
    expect(status).to_contain_text('4 处差异：改 1 · 删 1 · 增 2')
    for kind in ['changed', 'removed', 'added']:
        expect(page.locator(f'.td-json-{kind}').first).to_be_visible()
        color = page.locator(f'.td-json-{kind}').first.evaluate('el => getComputedStyle(el).backgroundColor')
        assert color not in ['rgba(0, 0, 0, 0)', 'transparent'], (kind, color)
    page.evaluate('initialText => __hivenSandbox.openSurface({pluginId:"text-diff",surfaceId:"main",source:"builtin",initialText})', json.dumps({'mode':'set','original':{'text':'apple\nbanana\ncherry\n'},'modified':{'text':'banana\ndate\nfig\n'}}))
    def union():
        chip = page.locator('[data-value-chip]').filter(has_text='交集').first
        if chip.count():
            chip.click()
            page.get_by_role('option', name='并集', exact=True).click()
        expect(page.locator('.surface-shell-status')).to_contain_text('并集 · 5 项')
        color = page.locator('.td-set-selected').first.evaluate('el => getComputedStyle(el).backgroundColor')
        assert color.startswith('rgba('), color
    capture(page, 'V4-set', union)
