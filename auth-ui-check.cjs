// Browser check for account.html. Every Supabase request is intercepted and
// mocked, so no real accounts are created and no emails are sent.
// Usage: python -m http.server 8765 --bind 127.0.0.1  then  node auth-ui-check.cjs
const playwright = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');

const BASE = 'http://127.0.0.1:8765/';
const PAGE = BASE + 'account.html';
const SUPABASE = 'https://gczopudgxfciatvtxhll.supabase.co';
const OUT = '.review/';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const fakeJwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'u1', exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
const user = { id: 'u1', aud: 'authenticated', role: 'authenticated', email: 'test@example.com', user_metadata: { display_name: 'Test Person' }, app_metadata: {}, created_at: new Date().toISOString() };
const session = { access_token: fakeJwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r1', user };

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

async function setup(browser, handlers = {}, viewport = { width: 1280, height: 860 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname}`;
    calls.push({ key, url: req.url(), body: req.postData() });
    const h = handlers[key];
    if (!h) return route.abort();
    const r = await h(req);
    if (r === 'abort') return route.abort();
    await route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r.body ?? {}) });
  });
  return { context, page, calls, errors };
}

const visibleView = (page) => page.evaluate(() => document.querySelector('[data-view]:not([hidden])')?.dataset.view);
const noticeText = (page) => page.locator('#auth-notice').innerText();
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await playwright.chromium.launch();

  // 1. Anonymous load → sign-in view, SDK loads from vendored file, no network needed.
  {
    const { page, context, calls, errors } = await setup(browser);
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    check(true, 'anonymous load shows sign-in view');
    check(!(await page.locator('#signin-email').isDisabled()), 'sign-in fieldset enabled after ready');
    check(calls.length === 0, 'no Supabase requests on anonymous load');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    check(await page.getAttribute('#signin-password', 'autocomplete') === 'current-password', 'password autocomplete=current-password');
    check(await page.getAttribute('#signin-form', 'method') === 'post', 'form method is POST');
    await page.screenshot({ path: OUT + 'auth-signin-desktop.png' });

    // Validation: empty submit
    await page.click('#signin-form [type=submit]');
    check((await noticeText(page)).includes('enter your email'), 'empty email validation message');
    check(await page.evaluate(() => document.activeElement.id) === 'signin-email', 'focus moves to invalid email');
    await page.fill('#signin-email', 'not-an-email');
    await page.click('#signin-form [type=submit]');
    check((await noticeText(page)).includes('valid email'), 'invalid email message');

    // Switch to signup carries email, mismatch check
    await page.fill('#signin-email', 'new@example.com');
    await page.click('[data-view="signin"] [data-go="signup"]');
    check(await visibleView(page) === 'signup', 'switch to sign-up view');
    check(await page.inputValue('#signup-email') === 'new@example.com', 'email carried across views');
    check(await page.evaluate(() => document.activeElement.id) === 'signup-title', 'focus moves to view heading');
    await page.fill('#signup-password', 'secret123');
    await page.fill('#signup-confirm', 'secret124');
    await page.click('#signup-form [type=submit]');
    check((await noticeText(page)).includes('don\u2019t match'), 'password mismatch message');
    await page.fill('#signup-password', '123');
    await page.fill('#signup-confirm', '123');
    await page.click('#signup-form [type=submit]');
    check((await noticeText(page)).includes('at least 6'), 'short password message');
    check(calls.length === 0, 'client validation sends no requests');
    await page.screenshot({ path: OUT + 'auth-signup-desktop.png' });
    await context.close();
  }

  // 2. Sign-in error, duplicate submit protection, then success → account → sign out.
  {
    let attempt = 0;
    const { page, context, calls } = await setup(browser, {
      'POST /auth/v1/token': async () => {
        attempt++;
        await delay(400);
        return attempt === 1
          ? { status: 400, body: { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' } }
          : { body: session };
      },
      'POST /auth/v1/logout': async () => ({ status: 204, body: {} }),
    });
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    await page.fill('#signin-email', 'test@example.com');
    await page.fill('#signin-password', 'wrongpass');
    await page.click('#signin-form [type=submit]');
    check(await page.locator('#signin-email').isDisabled(), 'fieldset disabled while submitting');
    check((await page.innerText('#signin-form [type=submit]')).includes('Signing in'), 'busy button label');
    await page.evaluate(() => document.getElementById('signin-form').requestSubmit());
    await page.waitForFunction(() => document.getElementById('auth-notice').textContent.length > 0);
    check(calls.filter((c) => c.key === 'POST /auth/v1/token').length === 1, 'duplicate submit sent only one request');
    check(await noticeText(page) === 'Incorrect email or password.', 'invalid credentials error shown');
    check(await page.getAttribute('#auth-notice', 'data-tone') === 'error', 'notice tone error');
    await page.screenshot({ path: OUT + 'auth-signin-error.png' });

    await page.fill('#signin-password', 'rightpass');
    await page.click('#signin-form [type=submit]');
    await page.waitForFunction(() => document.querySelector('[data-view="account"]:not([hidden])'));
    check(await page.innerText('#account-email') === 'test@example.com', 'account view shows email');
    check(await page.innerText('#account-name') === 'Test Person', 'account view shows display name');
    check(await page.inputValue('#signin-password') === '', 'password field cleared after sign-in');
    await page.screenshot({ path: OUT + 'auth-account.png' });

    // Session persists across reload (localStorage), no network needed.
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-view="account"]:not([hidden])'));
    check(true, 'session persists across reload');

    await page.click('#dash-tab-account'); // sign out lives in the dashboard's Account tab
    await page.click('#signout-btn');
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    check((await noticeText(page)).includes('signed out'), 'sign-out returns to sign-in with notice');
    await context.close();
  }

  // 3. Sign-up requiring confirmation → check-email; exact redirect URL.
  {
    const { page, context, calls } = await setup(browser, {
      'POST /auth/v1/signup': async () => ({ body: { ...user, email: 'new@example.com', identities: [{ id: 'i1' }] } }),
    });
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    await page.click('[data-view="signin"] [data-go="signup"]');
    await page.fill('#signup-name', 'New Person');
    await page.fill('#signup-email', 'new@example.com');
    await page.fill('#signup-password', 'secret123');
    await page.fill('#signup-confirm', 'secret123');
    await page.click('#signup-form [type=submit]');
    await page.waitForFunction(() => document.querySelector('[data-view="check-email"]:not([hidden])'));
    const call = calls.find((c) => c.key === 'POST /auth/v1/signup');
    const body = JSON.parse(call.body);
    check(new URL(call.url).searchParams.get('redirect_to') === PAGE, `signup redirect_to is exact (${new URL(call.url).searchParams.get('redirect_to')})`);
    check(body.data?.display_name === 'New Person', 'display name sent as metadata');
    check((await page.innerText('#check-text')).includes('new@example.com'), 'confirmation feedback shows email');
    await page.screenshot({ path: OUT + 'auth-check-email.png' });
    await context.close();
  }

  // 4. Forgot password → exact redirect, generic confirmation.
  {
    const { page, context, calls } = await setup(browser, { 'POST /auth/v1/recover': async () => ({ body: {} }) });
    await page.goto(PAGE + '?next=https://evil.example/');
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    check(!page.url().includes('evil'), 'unrelated query params are stripped, never followed');
    await page.click('[data-go="forgot"]');
    await page.fill('#forgot-email', 'test@example.com');
    await page.click('#forgot-form [type=submit]');
    await page.waitForFunction(() => document.querySelector('[data-view="check-email"]:not([hidden])'));
    const call = calls.find((c) => c.key === 'POST /auth/v1/recover');
    check(new URL(call.url).searchParams.get('redirect_to') === PAGE, 'reset redirect_to is exact account.html');
    check(await page.innerText('#check-title') === 'Check your email', 'reset confirmation title');
    await context.close();
  }

  // 5. Recovery callback → new-password view (not account), update → account.
  {
    const { page, context, calls } = await setup(browser, {
      'GET /auth/v1/user': async () => ({ body: user }),
      'PUT /auth/v1/user': async () => ({ body: user }),
    });
    const hash = `#access_token=${fakeJwt}&expires_at=${exp}&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery`;
    await page.goto(PAGE + hash);
    await page.waitForFunction(() => document.querySelector('[data-view="recovery"]:not([hidden])'));
    await delay(500); // let any late SIGNED_IN / PASSWORD_RECOVERY events fire
    check(await visibleView(page) === 'recovery', 'recovery link shows new-password view and stays there');
    check(!page.url().includes('access_token') && !page.url().includes('#'), `tokens removed from URL (${page.url()})`);
    check(!(await page.content()).includes(fakeJwt), 'token not rendered in DOM');
    await page.screenshot({ path: OUT + 'auth-recovery.png' });
    await page.fill('#recovery-password', 'newsecret1');
    await page.fill('#recovery-confirm', 'newsecret2');
    await page.click('#recovery-form [type=submit]');
    check((await noticeText(page)).includes('don\u2019t match'), 'recovery mismatch message');
    await page.fill('#recovery-confirm', 'newsecret1');
    await page.click('#recovery-form [type=submit]');
    await page.waitForFunction(() => document.querySelector('[data-view="account"]:not([hidden])'));
    check((await noticeText(page)).includes('password has been updated'), 'password update success → account view');
    check(JSON.parse(calls.find((c) => c.key === 'PUT /auth/v1/user').body).password === 'newsecret1', 'updateUser sent new password');
    await context.close();
  }

  // 6. Expired link callback → sign-in with error, URL cleaned.
  {
    const { page, context, calls } = await setup(browser);
    await page.goto(PAGE + '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    check((await noticeText(page)).includes('expired'), 'expired link message shown');
    check(page.url() === PAGE, `error params removed from URL (${page.url()})`);
    check(calls.length === 0, 'no API calls for expired link');
    await page.screenshot({ path: OUT + 'auth-expired.png' });
    await context.close();
  }

  // 7. Network failure on sign-in → visible friendly error.
  {
    const { page, context } = await setup(browser, { 'POST /auth/v1/token': async () => 'abort' });
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    await page.fill('#signin-email', 'test@example.com');
    await page.fill('#signin-password', 'whatever1');
    await page.click('#signin-form [type=submit]');
    await page.waitForFunction(() => document.getElementById('auth-notice').textContent.length > 0, null, { timeout: 30000 });
    check((await noticeText(page)).includes('couldn\u2019t reach'), `network failure message (${await noticeText(page)})`);
    check(!(await page.locator('#signin-email').isDisabled()), 'form re-enabled after failure');
    await context.close();
  }

  // 8. SDK import failure → unavailable view; forms stay disabled.
  {
    const { page, context } = await setup(browser);
    await context.route('**/vendor/**', (route) => route.abort());
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('[data-view="unavailable"]:not([hidden])'));
    check(true, 'SDK load failure shows unavailable view');
    check(await page.locator('#signin-email').isDisabled(), 'forms remain disabled when SDK fails');
    await context.close();
  }

  // 9. JavaScript disabled → no usable password form, noscript message.
  {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(PAGE);
    check(await page.locator('#signin-form').isHidden(), 'without JS the password form is hidden');
    check(await page.locator('#signin-email').isDisabled(), 'without JS the fieldset is disabled');
    check((await page.innerText('body')).includes('JavaScript is required'), 'noscript message shown');
    await context.close();
  }

  // 10. Mobile layout + RankHarbour nav links.
  {
    const { page, context } = await setup(browser, {}, { width: 390, height: 844 });
    await page.goto(PAGE);
    await page.waitForFunction(() => document.querySelector('[data-view="signin"]:not([hidden])'));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    check(!overflow, 'account page has no horizontal overflow at 390px');
    await page.screenshot({ path: OUT + 'auth-signin-mobile.png' });

    await page.goto(BASE + 'RankHarbour.html');
    check(await page.locator('.rh-header__login').isHidden(), 'desktop login link hidden on mobile');
    await page.click('#rh-menu-btn');
    check(await page.locator('.rh-mobile-nav__link--login').isVisible(), 'mobile nav shows Log in');
    await page.screenshot({ path: OUT + 'auth-mobile-nav.png' });
    await page.click('.rh-mobile-nav__link--login');
    await page.waitForURL('**/account.html');
    check(true, 'mobile Log in navigates to account.html');
    await context.close();
  }
  for (const width of [1440, 1100, 1025]) {
    const { page, context } = await setup(browser, {}, { width, height: 800 });
    await page.goto(BASE + 'RankHarbour.html');
    const ok = await page.evaluate(() => {
      const login = document.querySelector('.rh-header__login').getBoundingClientRect();
      const cta = document.querySelector('.rh-header__cta').getBoundingClientRect();
      const lastNav = [...document.querySelectorAll('.rh-nav__link')].pop().getBoundingClientRect();
      return login.width > 0 && login.right <= cta.left && lastNav.right <= login.left && login.height < 40;
    });
    check(ok, `desktop header fits Log in link at ${width}px`);
    if (width === 1440) await page.screenshot({ path: OUT + 'auth-desktop-nav.png', clip: { x: 0, y: 0, width, height: 120 } });
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
