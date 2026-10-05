// Browser check for the signed-in dashboard on account.html. Sessions are
// simulated (seeded localStorage / mocked token endpoint) and every Supabase
// request is intercepted, so no accounts are written and no emails are sent.
// Usage: python -m http.server 8765 --bind 127.0.0.1  then  node dashboard-check.cjs
const playwright = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');

const PAGE = 'http://127.0.0.1:8765/account.html';
const SUPABASE = 'https://gczopudgxfciatvtxhll.supabase.co';
const STORAGE_KEY = 'sb-gczopudgxfciatvtxhll-auth-token';
const OUT = '.review/';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const exp = Math.floor(Date.now() / 1000) + 3600;
const jwt = (sub) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, exp, role: 'authenticated', aud: 'authenticated' })}.sig`;
const makeUser = (id, email, name) => ({ id, aud: 'authenticated', role: 'authenticated', email, user_metadata: name ? { display_name: name } : {}, app_metadata: {}, created_at: new Date().toISOString() });
const makeSession = (user) => ({ access_token: jwt(user.id), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r-' + user.id, user });
const user1 = makeUser('u1', 'test@example.com', 'Test Person');
const user2 = makeUser('u2', 'second@example.com', null);

let failures = 0;
const check = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) failures++; };

async function setup(browser, { viewport = { width: 1440, height: 900 }, seed = null, handlers = {} } = {}) {
  const context = await browser.newContext({ viewport });
  if (seed) {
    await context.addInitScript(([key, value]) => {
      if (!sessionStorage.getItem('__seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('__seeded', '1'); }
    }, [STORAGE_KEY, JSON.stringify(seed)]);
  }
  const page = await context.newPage();
  const calls = [];
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await context.route(`${SUPABASE}/**`, async (route) => {
    const req = route.request();
    const key = `${req.method()} ${new URL(req.url()).pathname}`;
    calls.push({ key, url: req.url(), body: req.postData() });
    const h = handlers[key];
    if (!h) return route.abort();
    const r = await h(req);
    await route.fulfill({ status: r.status || 200, contentType: 'application/json', body: JSON.stringify(r.body ?? {}) });
  });
  return { context, page, calls, errors };
}

const waitView = (page, view) => page.waitForFunction((v) => document.querySelector(`[data-view="${v}"]:not([hidden])`), view);
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth || document.body.scrollWidth > window.innerWidth);
const cardWidth = (page) => page.evaluate(() => document.querySelector('.auth-card').getBoundingClientRect().width);
const selectedTab = (page) => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]').id);
const focusedId = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.dataset?.col || document.activeElement?.tagName);
const visiblePanels = (page) => page.evaluate(() => [...document.querySelectorAll('[role="tabpanel"]')].filter((p) => !p.hidden).map((p) => p.id));

(async () => {
  const browser = await playwright.chromium.launch();

  // 1. Signed out: compact card, no personal data in the DOM.
  {
    const { page, context, errors } = await setup(browser);
    await page.goto(PAGE);
    await waitView(page, 'signin');
    check(await cardWidth(page) <= 400, 'signed-out card stays compact (<=400px)');
    check(await page.evaluate(() => document.body.dataset.authView) === 'signin', 'body marks sign-in view');
    const html = await page.content();
    check(!html.includes('test@example.com') && !html.includes('Test Person'), 'no private data before a session');
    check(await page.textContent('#account-email') === '' && await page.textContent('#account-title') === 'Welcome', 'account fields empty');
    check(errors.length === 0, 'no page errors (signed out)');
    await context.close();
  }

  // 2. Restored session at each viewport: layout, overflow, tab rail, screenshots.
  for (const [w, h] of [[1440, 900], [768, 1024], [390, 844], [320, 640]]) {
    const { page, context, calls, errors } = await setup(browser, { viewport: { width: w, height: h }, seed: makeSession(user1) });
    await page.goto(PAGE);
    await waitView(page, 'account');
    check(calls.length === 0, `${w}: session restored from storage with no network calls`);
    check(await page.textContent('#account-title') === 'Welcome, Test Person', `${w}: greets the signed-in user`);
    const cw = await cardWidth(page);
    check(w >= 960 ? cw > 1000 : cw > w * 0.85, `${w}: dashboard card expands (${Math.round(cw)}px)`);
    const rail = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]').getBoundingClientRect();
      return [...document.querySelectorAll('[role="tab"]')].every((t) => {
        const r = t.getBoundingClientRect();
        return r.width > 0 && r.left >= list.left - 0.5 && r.right <= list.right + 0.5 && t.scrollWidth <= t.clientWidth + 1;
      });
    });
    check(rail, `${w}: all three tabs fit the rail without clipping`);
    check(await page.evaluate(() => document.querySelector('.auth-header__back').getBoundingClientRect().right <= window.innerWidth), `${w}: header "Back to site" link fits`);
    check(await page.getAttribute('[role="tablist"]', 'aria-orientation') === (w >= 960 ? 'vertical' : 'horizontal'), `${w}: aria-orientation matches layout`);
    for (const tab of ['overview', 'pricing', 'account']) {
      await page.click(`#dash-tab-${tab}`);
      check(!(await overflowX(page)), `${w}: no horizontal page overflow on ${tab}`);
      await page.screenshot({ path: `${OUT}dash-${tab}-${w}.png`, fullPage: true });
    }
    if (w <= 390) {
      check(await page.evaluate(() => getComputedStyle(document.querySelector('.dash-tab__more')).width === '1px'), `${w}: short "Plans" label shown`);
      check((await page.getAttribute('#dash-tab-pricing', 'id')) && (await page.evaluate(() => document.getElementById('dash-tab-pricing').textContent.replace(/\s+/g, ' ').trim())) === 'Plans & Pricing', `${w}: tab accessible name is still "Plans & Pricing"`);
      await page.click('#dash-tab-pricing');
      const scroller = await page.evaluate(() => { const s = document.querySelector('.compare__scroll'); return { sw: s.scrollWidth, cw: s.clientWidth }; });
      check(scroller.sw >= scroller.cw, `${w}: comparison scrolls inside its own region (${scroller.sw}/${scroller.cw})`);
      for (const plan of ['enterprise-plus', 'starter']) {
        await page.click(`[data-compare="${plan}"]`);
        await page.waitForTimeout(700);
        const vis = await page.evaluate((p) => {
          const s = document.querySelector('.compare__scroll').getBoundingClientRect();
          const c = document.querySelector(`thead [data-col="${p}"]`).getBoundingClientRect();
          const hdr = document.querySelector('.rh-header').getBoundingClientRect().bottom;
          return c.left >= s.left - 1 && c.right <= s.right + 1 && c.top >= hdr - 1 && c.bottom <= window.innerHeight;
        }, plan);
        check(vis, `${w}: "Compare inclusions" brings the ${plan} column into view below the header`);
        await page.screenshot({ path: `${OUT}dash-compare-${plan}-${w}.png` });
      }
    }
    check(errors.length === 0, `${w}: no page errors`);
    await context.close();
  }

  // 3. Tabs: ARIA wiring and keyboard navigation.
  {
    const { page, context } = await setup(browser, { seed: makeSession(user1) });
    await page.goto(PAGE);
    await waitView(page, 'account');
    const wiring = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].every((t) => {
      const p = document.getElementById(t.getAttribute('aria-controls'));
      return p && p.getAttribute('role') === 'tabpanel' && p.getAttribute('aria-labelledby') === t.id;
    }));
    check(wiring, 'every tab has aria-controls → tabpanel labelled by the tab');
    check(await selectedTab(page) === 'dash-tab-overview', 'Overview selected by default');
    check(JSON.stringify(await visiblePanels(page)) === '["dash-panel-overview"]', 'only Overview panel visible');
    check(await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.tabIndex).join()) === '0,-1,-1', 'roving tabindex');
    await page.focus('#dash-tab-overview');
    const seq = [['ArrowRight', 'pricing'], ['ArrowDown', 'account'], ['ArrowRight', 'overview'], ['ArrowLeft', 'account'], ['ArrowUp', 'pricing'], ['Home', 'overview'], ['End', 'account']];
    for (const [key, want] of seq) {
      await page.keyboard.press(key);
      const ok = await selectedTab(page) === `dash-tab-${want}` && await focusedId(page) === `dash-tab-${want}` &&
        JSON.stringify(await visiblePanels(page)) === `["dash-panel-${want}"]`;
      check(ok, `${key} → ${want} selected, focused, only its panel shown`);
    }
    await page.keyboard.press('Tab');
    check(await focusedId(page) === 'dash-panel-account', 'Tab from the tablist moves into the active panel');

    // Overview shortcuts
    await page.click('#dash-tab-overview');
    await page.click('[data-dash-go="pricing"]');
    check(await selectedTab(page) === 'dash-tab-pricing' && await focusedId(page) === 'dash-pricing-title', 'Overview shortcut opens Plans & Pricing and focuses its heading');
    await page.click('#dash-tab-overview');
    await page.click('[data-dash-go="account"]');
    check(await selectedTab(page) === 'dash-tab-account' && await focusedId(page) === 'dash-account-title', 'Overview shortcut opens Account');
    await context.close();
  }

  // 4. Pricing content: cards, exact comparison rows, honest copy.
  {
    const { page, context } = await setup(browser, { seed: makeSession(user1) });
    await page.goto(PAGE);
    await waitView(page, 'account');
    await page.click('#dash-tab-pricing');
    const cards = await page.$$eval('.plan', (els) => els.map((el) => ({
      name: el.querySelector('.plan__name').textContent.trim(),
      price: el.querySelector('.plan__amount').textContent.trim(),
      per: el.querySelector('.plan__per').textContent.trim(),
      badge: el.querySelector('.plan__badge')?.textContent.trim() || null,
    })));
    check(cards.length === 5, `exactly 5 plan cards (${cards.length})`);
    check(JSON.stringify(cards.map((c) => [c.name, c.price])) === JSON.stringify([['Starter', '$99'], ['Growth', '$149'], ['Pro', '$249'], ['Enterprise', '$499'], ['Enterprise Plus', '$799']]), 'plan names and prices exact');
    check(cards.every((c) => c.per === 'AUD / month'), 'prices labelled AUD / month');
    check(JSON.stringify(cards.map((c) => c.badge)) === JSON.stringify([null, 'Best Value', null, null, null]), 'only Growth carries the Best Value badge');
    const groups = await page.$$eval('.plans-group', (gs) => gs.map((g) => [g.querySelector('h3').textContent.trim(), g.querySelectorAll('.plan').length]));
    check(JSON.stringify(groups) === '[["Small Business SEO",3],["Enterprise SEO",2]]', 'plans grouped 3 Small Business + 2 Enterprise on one tab');
    const fullCounts = await page.$$eval('.plan', (els) => els.map((el) => el.querySelectorAll('.plan__full li').length));
    check(JSON.stringify(fullCounts) === '[17,20,26,24,24]', `full inclusions retained for every plan (${fullCounts})`);
    const C = 'Included', N = 'Not included';
    const expected = [
      ['Monthly Price', '$99', '$149', '$249', '$499', '$799'],
      ['Search Monitoring', C, C, C, C, C],
      ['Search Opportunities Monitored', '5', '15', '30+', '75+', '150+'],
      ['Continuous Search Opportunity Optimisation', 'Basic', C, 'Advanced', 'Advanced', 'Advanced'],
      ['Competitor Monitoring', 'Basic', C, C, 'Advanced', 'Advanced'],
      ['Significant Page Optimisations', 'Minor', '1/month', '2/month', '4/month', '8/month'],
      ['SEO Articles', '—' + N, 'Strategy Brief', '1/month', '2/month', '4/month'],
      ['Existing Content Refresh', '—' + N, 'Recommendations', C, C, C],
      ['Internal Linking', 'Basic', C, C, 'Advanced', 'Advanced'],
      ['Technical SEO', 'Monitoring', 'Monitoring', C, 'Advanced', 'Advanced'],
      ['Local SEO', 'Basic', C, C, C, 'Multi-location'],
      ['AI Search Visibility', '—' + N, '—' + N, 'Basic', C, C],
      ['Strategy Review', '—' + N, '—' + N, 'Included in Report', 'Monthly', 'Monthly'],
      ['Reporting', 'Monthly', 'Monthly', 'Advanced', 'Advanced', 'Custom'],
      ['Support', 'Standard', 'Standard', 'Priority', 'Priority', 'Priority'],
    ];
    const rows = await page.$$eval('#compare-table tbody tr', (trs) => trs.map((tr) => [...tr.children].map((c) => c.textContent.trim())));
    check(rows.length === 15, `comparison has exactly 15 rows (${rows.length})`);
    check(JSON.stringify(rows) === JSON.stringify(expected), 'comparison rows and values exact');
    check(await page.$$eval('#compare-table tbody th[scope="row"]', (e) => e.length) === 15, 'row headers use th scope=row');
    check(JSON.stringify(await page.$$eval('#compare-table thead th[data-col]', (e) => e.map((th) => th.textContent.trim()))) === '["Starter","Growth","Pro","Enterprise","Enterprise Plus"]', 'column headers for all 5 plans');
    check(await page.$$eval('.explain__item', (e) => e.length) === 6 && await page.$$eval('.explain__steps li', (e) => e.length) === 13, 'six explainer disclosures incl. 13-step process');
    check(await page.isVisible('#no-guarantee'), 'no-ranking-guarantee explanation visible');
    // Native disclosures open by keyboard
    await page.focus('[data-plan="enterprise-plus"] .plan__more summary');
    await page.keyboard.press('Enter');
    check(await page.evaluate(() => document.querySelector('[data-plan="enterprise-plus"] .plan__more').open), 'Full inclusions opens with Enter');
    await page.focus('.explain__item summary');
    await page.keyboard.press('Space');
    check(await page.evaluate(() => document.querySelector('.explain__item').open), 'explainer opens with Space');
    check(await page.getAttribute('.compare__scroll', 'role') === 'region' && !!(await page.getAttribute('.compare__scroll', 'aria-labelledby')), 'table scroll area is a labelled region');
    const text = await page.evaluate(() => document.body.innerText);
    check(!/GST/i.test(text), 'no GST claims');
    check(!/subscribed|checkout|active plan|current plan|invoice|discount|setup fee|\bsave\b/i.test(text), 'no fake subscription, checkout, invoice, discount or setup-fee copy');
    check(await page.$$eval('.custom-work__list li', (e) => e.map((li) => li.textContent).join('|')) === 'Website rebuilds|Custom software|Integrations|Major SEO projects|Photography|Google Ads setup', 'custom work panel lists the six quoted services');

    // Compare inclusions → highlight + focus + clear
    await page.click('[data-compare="growth"]');
    check(await page.getAttribute('#compare-table', 'data-highlight') === 'growth', 'Compare inclusions highlights the Growth column');
    check(await page.$$eval('#compare-table .is-highlight', (e) => e.length === 16 && e.every((c) => c.dataset.col === 'growth')), 'only the Growth column cells are highlighted (16)');
    check(await focusedId(page) === 'growth', 'focus moves to the Growth column header');
    check(await page.isVisible('#compare-focus') && (await page.textContent('#compare-focus-name')) === 'Growth', 'highlight is described in text');
    await page.waitForTimeout(700);
    check(await page.evaluate(() => { const r = document.getElementById('compare').getBoundingClientRect(); return r.top >= 0 && r.top < window.innerHeight; }), 'comparison scrolled into view');
    await page.screenshot({ path: OUT + 'dash-compare-growth-1440.png' });
    await page.click('#compare-clear');
    check(await page.getAttribute('#compare-table', 'data-highlight') === null && await page.isHidden('#compare-focus'), '"Show all plans" clears the highlight');
    const metaWrites = await page.evaluate(() => JSON.stringify(localStorage));
    check(!/plan|starter|growth|pro"/i.test(metaWrites.replace(/"provider[^"]*"/g, '')), 'no plan choice stored locally');
    await context.close();
  }

  // 5. Password reset from Account tab (mocked), then sign out resets everything,
  //    then a second user signs in and sees none of the first user's state.
  {
    let tokenUser = user2;
    const { page, context, calls, errors } = await setup(browser, {
      seed: makeSession(user1),
      handlers: {
        'POST /auth/v1/recover': async () => { await new Promise((r) => setTimeout(r, 300)); return { body: {} }; },
        'POST /auth/v1/logout': async () => ({ status: 204, body: {} }),
        'POST /auth/v1/token': async () => ({ body: makeSession(tokenUser) }),
      },
    });
    await page.goto(PAGE);
    await waitView(page, 'account');
    await page.click('#dash-tab-account');
    check(await page.textContent('#account-email') === 'test@example.com' && await page.textContent('#account-name') === 'Test Person' && await page.isVisible('#account-name-row'), 'Account tab shows real name and email');
    await page.click('#dash-reset-btn');
    check(await page.isDisabled('#dash-reset-btn') && (await page.textContent('#dash-reset-btn')).includes('Sending'), 'reset button shows busy state');
    await page.waitForFunction(() => document.getElementById('dash-reset-status').textContent.length > 0);
    const recover = calls.find((c) => c.key === 'POST /auth/v1/recover');
    check(recover && JSON.parse(recover.body).email === 'test@example.com', 'reset requested for the signed-in email (mocked, no email sent)');
    check(new URL(recover.url).searchParams.get('redirect_to') === PAGE, 'reset redirect_to is exact account.html');
    check((await page.textContent('#dash-reset-status')).includes('test@example.com'), 'reset confirmation shown in Account tab');

    // Leave some dashboard state behind, then sign out.
    await page.click('#dash-tab-pricing');
    await page.click('[data-compare="pro"]');
    await page.click('#dash-tab-account');
    await page.click('#signout-btn');
    await waitView(page, 'signin');
    const cleared = await page.evaluate(() => ({
      title: document.getElementById('account-title').textContent,
      email: document.getElementById('account-email').textContent,
      name: document.getElementById('account-name').textContent,
      nameHidden: document.getElementById('account-name-row').hidden,
      status: document.getElementById('dash-reset-status').textContent,
      recoveryUser: document.getElementById('recovery-username').value,
      highlight: document.getElementById('compare-table').dataset.highlight || null,
      tab: document.querySelector('[role="tab"][aria-selected="true"]').id,
      view: document.body.dataset.authView,
      html: document.body.innerHTML,
    }));
    check(cleared.title === 'Welcome' && !cleared.email && !cleared.name && cleared.nameHidden && !cleared.status && !cleared.recoveryUser, 'SIGNED_OUT clears every personal field');
    check(!cleared.html.includes('test@example.com') && !cleared.html.includes('Test Person'), 'no trace of the previous user in the DOM');
    check(cleared.highlight === null && cleared.tab === 'dash-tab-overview', 'dashboard state reset to Overview with no highlight');
    check(cleared.view === 'signin' && await cardWidth(page) <= 400, 'card returns to compact sign-in layout');
    check((await page.textContent('#auth-notice')).includes('signed out'), 'sign-out notice shown');
    check(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY) === null, 'session removed from storage');

    // Second user (no display name) signs in on the same page.
    await page.fill('#signin-email', 'second@example.com');
    await page.fill('#signin-password', 'secret123');
    await page.click('#signin-form [type=submit]');
    await waitView(page, 'account');
    check(await page.textContent('#account-title') === 'Welcome', 'second user without a name gets a neutral greeting');
    check(await page.isHidden('#account-name-row') && await page.textContent('#account-email') === 'second@example.com', 'second user sees only their own details');
    check(await selectedTab(page) === 'dash-tab-overview', 'second user starts on Overview');
    check(await page.evaluate(() => document.activeElement.id) === 'account-title', 'focus lands on the dashboard heading after sign-in');
    check(errors.length === 0, `no page errors (${errors.join('; ')})`);
    await context.close();
  }

  // 6. Recovery link takes precedence over the dashboard even with a stored session.
  {
    const { page, context } = await setup(browser, {
      seed: makeSession(user1),
      handlers: { 'GET /auth/v1/user': async () => ({ body: user1 }) },
    });
    const s = makeSession(user1);
    await page.goto(`${PAGE}#access_token=${s.access_token}&expires_at=${exp}&expires_in=3600&refresh_token=r1&token_type=bearer&type=recovery`);
    await waitView(page, 'recovery');
    await page.waitForTimeout(500);
    check(await page.evaluate(() => document.querySelector('[data-view]:not([hidden])').dataset.view) === 'recovery', 'recovery view wins over dashboard');
    check(await page.evaluate(() => document.body.dataset.authView) === 'recovery' && await cardWidth(page) <= 400, 'recovery stays in the compact card');
    await page.screenshot({ path: OUT + 'dash-recovery-precedence.png' });
    await context.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
