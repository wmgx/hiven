"""Round 3 regressions, using only the existing in-memory sandbox."""
from pathlib import Path
from playwright.sync_api import expect
from v4_r2_cases import footer_bottom


def s56(page):
    folder = Path('temp/v4r3-visual')
    folder.mkdir(parents=True, exist_ok=True)

    def size(height):
        page.clock.run_for(300)
        page.wait_for_function('height => __hivenSandbox.launcherSize()?.height === height', arg=height)
        assert round(page.locator('.global-launcher-panel').bounding_box()['height']) == height - 24
        footer_bottom(page, '.global-launcher-footer')

    for theme in ['light', 'dark']:
        page.evaluate('theme => __hivenSandbox.appearance(theme, "zh")', theme)
        page.evaluate('__hivenSandbox.open()')
        field = page.locator('.global-launcher-panel textarea').first
        expect(field).to_have_value('')
        size(318)
        field.fill('s')
        size(640)
        field.fill('sort')
        expect(page.locator('[data-launcher-row-index]')).to_have_count(1)
        size(318)
        page.locator('.global-launcher-panel').screenshot(path=str(folder / f'G1-height-{theme}.png'), animations='disabled')
        field.fill('')
        size(318)
        field.press('Escape')
        expect(page.locator('.global-launcher-panel')).not_to_be_visible()
        page.evaluate('__hivenSandbox.open()')
        expect(field).to_have_value('')
        size(318)
        field.press('Escape')
