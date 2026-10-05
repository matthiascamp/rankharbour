"""Dashboard checks; all auth requests are intercepted, with no live user changes."""
from pathlib import Path
exec((Path(__file__).parent/'test-auth.py').read_text().split('with sync_playwright() as p:')[0])

with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    context.route('**/auth/v1/**',api)
    context.route('**/functions/v1/billing',lambda route:route.fulfill(json={'subscriptions':[]}))
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'account.html')
    expect(page.locator('[data-view="account"]')).to_be_hidden()
    page.locator('#signin-email').fill(user['email'])
    page.locator('#signin-password').fill('Password123!')
    page.locator('#signin-form button[type=submit]').click()
    expect(page.locator('#dash-panel-overview')).to_be_visible()
    expect(page.locator('#account-title')).to_contain_text('Test')
    page.get_by_role('tab',name='Plans').click()
    expect(page.locator('#dash-panel-pricing')).to_be_visible()
    assert page.locator('.plan__amount').all_text_contents()==['$99','$149','$249','$499','$799']
    rows=page.locator('#compare-table tbody tr')
    source_rows=[line for line in Path('SEO-PLANS.txt').read_text(encoding='utf-8').splitlines() if line.startswith('|')][2:]
    def normal(value):
        value=' '.join(value.split()).replace(chr(0x2713),'Included').replace(chr(0x2014),'Not included')
        return value.replace('Not includedNot included','Not included')
    assert rows.count()==len(source_rows)==15
    for i,line in enumerate(source_rows):
        expected=[normal(cell.strip()).replace('Monthly Price','Price every 28 days') for cell in line.strip('|').split('|')]
        actual=[normal(cell) for cell in rows.nth(i).locator('th,td').all_text_contents()]
        assert actual==expected,(i,actual,expected)
    for width in [1440,768,390,320]:
        page.set_viewport_size({'width':width,'height':1000})
        page.wait_for_timeout(200)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Overflow {width}'
        page.screenshot(path=str(OUT/f'dashboard-pricing-{width}.png'),full_page=True)
    for key,name in [('starter','Starter'),('growth','Growth'),('pro','Pro'),('enterprise','Enterprise'),('enterprise-plus','Enterprise Plus')]:
        page.locator('[data-compare="'+key+'"]').click()
        expect(page.locator('#compare-focus')).to_be_visible()
        expect(page.locator('#compare-focus-name')).to_have_text(name)
        header=page.locator('#compare-table thead [data-col="'+key+'"]')
        box=header.bounding_box(); region=page.locator('.compare__scroll').bounding_box()
        assert box['x']+box['width']<=region['x']+region['width']+2, key+' column clipped'
    for summary in page.locator('#dash-panel-pricing details > summary').all():
        summary.focus(); page.keyboard.press('Enter')
        assert summary.evaluate('(e)=>e.parentElement.open')
        page.keyboard.press('Enter')
        assert not summary.evaluate('(e)=>e.parentElement.open')
    page.locator('#compare-clear').click()
    expect(page.locator('#compare-focus')).to_be_hidden()
    page.locator('#dash-tab-pricing').focus()
    page.keyboard.press('End')
    expect(page.locator('#dash-tab-account')).to_have_attribute('aria-selected','true')
    expect(page.locator('#account-email')).to_have_text(user['email'])
    page.keyboard.press('Home')
    expect(page.locator('#dash-tab-overview')).to_have_attribute('aria-selected','true')
    page.reload()
    expect(page.locator('[data-view="account"]')).to_be_visible()
    page.locator('#dash-tab-account').click()
    page.locator('#signout-btn').click()
    expect(page.locator('[data-view="signin"]')).to_be_visible()
    expect(page.locator('[data-view="account"]')).to_be_hidden()
    expect(page.locator('#account-email')).to_have_text('')
    # A second user must not see the previous user or selected pricing tab.
    user['email']='second@example.test';user['user_metadata']['display_name']='Second User'
    page.locator('#signin-email').fill(user['email']);page.locator('#signin-password').fill('Password123!')
    page.locator('#signin-form button[type=submit]').click()
    expect(page.locator('#account-title')).to_contain_text('Second')
    expect(page.locator('#dash-panel-overview')).to_be_visible()
    page.goto(BASE+'RankHarbour.html')
    page.goto(BASE+'account.html#access_token='+token+'&refresh_token=test-refresh-token&expires_in=3600&token_type=bearer&type=recovery')
    expect(page.locator('[data-view="recovery"]')).to_be_visible()
    expect(page.locator('[data-view="account"]')).to_be_hidden()
    assert not errors,errors
    browser.close()
print('PASS: prices and all fifteen comparison rows, responsive layouts, comparison controls, keyboard tabs, session restore, logout clears user, second-user isolation, recovery precedence.')
