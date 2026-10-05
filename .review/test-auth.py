"""Browser checks with real Supabase SDK and intercepted auth responses. No emails sent."""
import base64, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

BASE = 'http://127.0.0.1:8767/'
OUT = Path(__file__).parent
user = {'id':'00000000-0000-4000-8000-000000000001','aud':'authenticated','role':'authenticated',
        'email':'test@example.test','email_confirmed_at':'2026-10-05T00:00:00Z',
        'created_at':'2026-10-05T00:00:00Z','app_metadata':{'provider':'email'},
        'user_metadata':{'display_name':'Test User'}}
def enc(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip('=')
token = enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':user['id'],'exp':int(time.time())+3600,'iat':int(time.time()),'aud':'authenticated'})+'.testsignature'
session = {'access_token':token,'refresh_token':'test-refresh-token','token_type':'bearer','expires_in':3600,'user':user}
calls=[]
def api(route):
    req=route.request
    calls.append((req.url,req.method))
    if '/token' in req.url:
        data=req.post_data_json or {}
        if data.get('password')=='WrongPassword123!':
            route.fulfill(status=400,json={'code':'invalid_credentials','msg':'Invalid login credentials','error_code':'invalid_credentials'}); return
        route.fulfill(json=session)
    elif '/signup' in req.url: route.fulfill(json=user)
    elif '/recover' in req.url or '/logout' in req.url: route.fulfill(json={})
    elif '/user' in req.url: route.fulfill(json=user)
    else: route.fulfill(status=400,json={'msg':'Unexpected test request'})

with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':900},reduced_motion='reduce')
    context.route('**/auth/v1/**',api)
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto(BASE+'account.html')
    expect(page.locator('[data-view="signin"]')).to_be_visible()
    page.locator('#signin-form button[type=submit]').click()
    expect(page.locator('#auth-notice')).to_be_visible()
    expect(page.locator('#auth-notice')).to_contain_text('email')
    page.locator('#signin-email').fill(user['email'])
    page.locator('#signin-password').fill('WrongPassword123!')
    page.locator('#signin-form button[type=submit]').click()
    expect(page.locator('#auth-notice')).to_contain_text('Incorrect email or password')
    page.locator('[data-view="signin"] [data-go="signup"]').click()
    page.locator('#signup-email').fill(user['email'])
    page.locator('#signup-password').fill('Password123!')
    page.locator('#signup-confirm').fill('Mismatch123!')
    before=len(calls)
    page.locator('#signup-form button[type=submit]').click()
    expect(page.locator('#auth-notice')).to_contain_text('match')
    assert len(calls)==before,'Mismatched passwords reached Supabase'
    page.locator('#signup-confirm').fill('Password123!')
    page.locator('#signup-form button[type=submit]').click()
    expect(page.locator('[data-view="check-email"]')).to_be_visible()
    expect(page.locator('#check-title')).to_contain_text('Confirm')
    page.reload()
    expect(page.locator('[data-view="signin"]')).to_be_visible()
    page.locator('[data-view="signin"] [data-go="forgot"]').click()
    page.locator('#forgot-email').fill(user['email'])
    page.locator('#forgot-form button[type=submit]').click()
    expect(page.locator('#check-title')).to_have_text('Check your email')
    page.reload()
    page.locator('#signin-email').fill(user['email'])
    page.locator('#signin-password').fill('Password123!')
    page.locator('#signin-form button[type=submit]').click()
    expect(page.locator('#account-email')).to_have_text(user['email'])
    page.reload()
    expect(page.locator('[data-view="account"]')).to_be_visible()
    if page.locator('#dash-tab-account').count(): page.locator('#dash-tab-account').click()
    page.locator('#signout-btn').click()
    expect(page.locator('[data-view="signin"]')).to_be_visible()
    page.reload()
    expect(page.locator('[data-view="signin"]')).to_be_visible()
    for width in [1440,768,390,320]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Account overflow at {width}'
        page.screenshot(path=str(OUT/f'account-{width}.png'))
    page.goto(BASE+'RankHarbour.html')
    page.goto(BASE+'account.html#error=access_denied&error_code=otp_expired')
    expect(page.locator('#auth-notice')).to_be_visible()
    expect(page.locator('#auth-notice')).to_contain_text('expired')
    assert '#' not in page.url,'Callback error not scrubbed'
    page.goto(BASE+'RankHarbour.html')
    page.goto(BASE+'account.html#access_token='+token+'&refresh_token=test-refresh-token&expires_in=3600&token_type=bearer&type=recovery')
    expect(page.locator('[data-view="recovery"]')).to_be_visible()
    page.locator('#recovery-password').fill('NewPassword123!')
    page.locator('#recovery-confirm').fill('NewPassword123!')
    page.locator('#recovery-form button[type=submit]').click()
    expect(page.locator('[data-view="account"]')).to_be_visible()
    expect(page.locator('#auth-notice')).to_contain_text('updated')
    for width in [1440,1024,768,390,320]:
        page.set_viewport_size({'width':width,'height':900})
        page.goto(BASE+'RankHarbour.html')
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Home overflow at {width}'
    assert not errors, errors
    context.close()
    context=browser.new_context()
    context.route('**/vendor/**',lambda r:r.abort())
    page=context.new_page()
    page.goto(BASE+'account.html')
    expect(page.locator('[data-view="unavailable"]')).to_be_visible(timeout=20000)
    context.close()
    browser.close()
print('PASS: validation, auth errors, signup confirmation, reset request, login, persistent session, logout, recovery update, expired callback, network failure, responsive layouts.')
