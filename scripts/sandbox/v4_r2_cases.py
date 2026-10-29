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


def footer_bottom(page, footer):
    page.clock.run_for(300)
    page.wait_for_function("selector => {const p=document.querySelector('.global-launcher-panel')?.getBoundingClientRect(); const f=document.querySelector(selector)?.getBoundingClientRect();return p&&f&&Math.abs(p.bottom-f.bottom)<=1}", arg=footer)
    panel = page.locator('.global-launcher-panel').bounding_box()
    bar = page.locator(footer).bounding_box()
    assert abs(panel['y'] + panel['height'] - bar['y'] - bar['height']) <= 1, page.locator('.global-launcher-panel,.global-launcher-flow-frame,.launcher-result-text-frame,.launcher-preview-well,.launcher-command-footer').evaluate_all("els=>els.map(el=>({class:el.className,style:el.getAttribute('style'),height:el.getBoundingClientRect().height,max:getComputedStyle(el).maxHeight,min:getComputedStyle(el).minHeight,flex:getComputedStyle(el).flex,padding:getComputedStyle(el).padding}))")


def s52(page):
    page.evaluate('__hivenSandbox.openSurface({pluginId:"text-tools",surfaceId:"base64",source:"builtin"})')
    expect(page.locator('.base64-surface')).to_be_visible()
    footer_bottom(page, '.surface-shell-footer')
    capture(page, 'V1-footer', lambda: footer_bottom(page, '.surface-shell-footer'))
    page.locator('[data-command-input]').press('Backspace')
    field = page.locator('.global-launcher-panel textarea').first
    field.fill('base64')
    expect(page.locator('[data-launcher-row-index]')).to_have_count(1)
    footer_bottom(page, '.global-launcher-footer')


def s53(page):
    def summary():
        page.evaluate('__hivenSandbox.open()')
        page.wait_for_timeout(250)
        field = page.locator('.global-launcher-panel textarea').first
        field.fill('summarize')
        expect(page.locator('[data-launcher-row-index]').first).to_be_visible()
        field.press('Enter')
        field.fill('A short synthetic text for the simulated summary.')
        field.press('Enter')
        import re
        expect(page.get_by_test_id('launcher-preview-well')).to_have_text(re.compile(r'^(?:Simulated summary\.\s*|这是一段模拟摘要。\s*){12}$'))
        page.clock.run_for(300)
        preview = page.get_by_test_id('launcher-preview-well').bounding_box()
        assert preview['height'] < 100, preview
        footer_bottom(page, '.launcher-command-footer')
    summary()
    capture(page, 'V5-ai', summary)
    key = page.locator('.launcher-command-footer kbd').last
    style = key.evaluate('el => {const s=getComputedStyle(el);return [s.fontSize,s.height,s.backgroundImage,s.borderRadius]}')
    assert key.evaluate('el => el.previousSibling?.textContent.trim().length > 0')
    page.evaluate('__hivenSandbox.openSurface({pluginId:"text-tools",surfaceId:"base64",source:"builtin",initialText:"hello"})')
    expect(page.locator('.surface-shell-footer kbd').first).to_be_visible()
    other = page.locator('.surface-shell-footer kbd').first.evaluate('el => {const s=getComputedStyle(el);return [s.fontSize,s.height,s.backgroundImage,s.borderRadius]}')
    assert style == other, (style, other)
    capture(page, 'V6-actions')


def s54(page):
    page.evaluate('__hivenSandbox.openSurface({pluginId:"qr-code",surfaceId:"main",source:"builtin",initialText:"https://example.com"})')
    expect(page.locator('.qr-surface__preview img')).to_be_visible()
    page.get_by_role('button', name='Size: 256px', exact=True).click()
    page.get_by_role('option', name='480px', exact=True).click()
    def visible():
        image = page.locator('.qr-surface__preview img')
        expect(image).to_be_visible()
        box = image.bounding_box()
        area = page.locator('.qr-surface__preview').bounding_box()
        assert box['y'] >= area['y'] - 1 and box['y'] + box['height'] <= area['y'] + area['height'] + 1, (box, area)
        assert box['x'] >= area['x'] - 1 and box['x'] + box['width'] <= area['x'] + area['width'] + 1, (box, area)
        assert abs(box['width'] - box['height']) <= 1, box
        assert image.evaluate('el => el.complete && el.naturalWidth > 0')
        footer_bottom(page, '.surface-shell-footer')
    capture(page, 'V2-qr', visible)
