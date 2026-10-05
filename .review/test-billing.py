from pathlib import Path
exec((Path(__file__).parent/'test-auth.py').read_text().split('with sync_playwright() as p:')[0])

with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    context.route('**/auth/v1/**',api)
    state={'subscriptions':[],'error':False}
    billing_calls=[]
    def billing(route):
        body=route.request.post_data_json;billing_calls.append(body)
        if state['error']: route.fulfill(status=503,json={'error':'Checkout is being connected.'})
        elif body['action']=='status': route.fulfill(json={'subscriptions':state['subscriptions'],'preview':state.get('preview')})
        elif body['action']=='checkout': route.fulfill(json={'url':'https://buy.stripe.com/test_fixture?client_reference_id=fixture'})
        else: route.fulfill(json={'url':'https://billing.stripe.com/p/session/fixture'})
    context.route('**/functions/v1/billing',billing)
    context.route('https://buy.stripe.com/**',lambda r:r.fulfill(body='Checkout fixture'))
    context.route('https://billing.stripe.com/**',lambda r:r.fulfill(body='Portal fixture'))
    page=context.new_page();errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(BASE+'account.html')
    page.locator('#signin-email').fill(user['email']);page.locator('#signin-password').fill('Password123!')
    page.locator('#signin-form button[type=submit]').click()
    page.locator('#dash-tab-pricing').click()
    expect(page.locator('[data-subscribe=starter]')).to_be_enabled()
    assert page.locator('.plan__per').all_text_contents()==['AUD / 28 days']*5
    for plan in ['starter','growth','pro','enterprise','enterprise-plus']:
        with context.expect_page() as popup: page.locator('[data-subscribe="'+plan+'"]').click()
        tab=popup.value;tab.wait_for_url('https://buy.stripe.com/**');tab.close()
        assert any(c.get('plan')==plan for c in billing_calls)
    state['error']=True
    page.locator('[data-subscribe=starter]').click()
    expect(page.locator('#dash-panel-pricing [data-billing-message]').first).to_contain_text('being connected')
    state['error']=False
    state['subscriptions']=[{'stripe_subscription_id':'sub_fixture','plan':'growth','status':'active','amount':14900,'current_period_end':'2026-11-02T00:00:00Z','cancel_at_period_end':False}]
    page.locator('#dash-tab-account').click();page.locator('#billing-refresh').click()
    expect(page.locator('#billing-records')).to_contain_text('Growth — active')
    expect(page.locator('#billing-records')).to_contain_text('every 28 days')
    expect(page.locator('#billing-records')).to_contain_text('Next billing date:')
    with context.expect_page() as popup: page.get_by_role('button',name='Manage subscription',exact=True).click()
    tab=popup.value;tab.wait_for_url('https://billing.stripe.com/**');tab.close()
    assert billing_calls[-1]=={'action':'portal','subscriptionId':'sub_fixture'}
    page.locator('#dash-tab-pricing').click()
    for button in page.locator('.plan [data-subscribe]').all(): expect(button).to_be_disabled()
    addon=page.locator('[data-subscribe="google-business-posts"]')
    expect(addon).to_be_enabled()
    with context.expect_page() as popup: addon.click()
    tab=popup.value;tab.wait_for_url('https://buy.stripe.com/**');tab.close()
    assert any(c.get('plan')=='google-business-posts' for c in billing_calls)
    state['subscriptions'].append({'stripe_subscription_id':'sub_addon','plan':'google-business-posts','status':'active','amount':2900,'current_period_end':'2026-11-02T00:00:00Z','cancel_at_period_end':False})
    page.locator('#dash-tab-account').click();page.locator('#billing-refresh').click()
    expect(page.locator('#billing-records')).to_contain_text('Google Business Posts (add-on)')
    assert page.get_by_role('button',name='Manage subscription',exact=True).count()==2
    page.locator('#dash-tab-pricing').click();expect(addon).to_be_disabled()
    page.locator('#dash-tab-account').click()
    for width in [1440,390,320]:
        page.set_viewport_size({'width':width,'height':1000})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
    page.screenshot(path=str(OUT/'billing-account-mobile.png'),full_page=True)
    state['subscriptions']=[]
    state['preview']={'plan':'pro','amount':24900,'website':'https://example.test'}
    page.locator('#billing-refresh').click()
    expect(page.locator('#billing-records')).to_contain_text('Pro — active preview')
    expect(page.locator('#billing-records')).to_contain_text('Your cost: $0')
    expect(page.locator('#billing-records')).to_contain_text('example.test')
    assert page.get_by_role('button',name='Manage subscription',exact=True).count()==0
    page.locator('#dash-tab-pricing').click()
    expect(page.locator('[data-subscribe=pro]')).to_have_text('Your plan · Free preview')
    expect(page.locator('[data-subscribe=pro]')).to_be_disabled()
    expect(addon).to_be_disabled()
    page.locator('#header-logout').click()
    expect(page.locator('[data-view=signin]')).to_be_visible()
    expect(page.locator('#billing-records')).to_be_empty()
    assert not errors,errors
    browser.close()
print('Billing checkout, errors, active plan, portal, responsive layout and logout checks passed')
