const playwright = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');

(async () => {
  const fileUrl = 'file:///' + path.resolve('RankHarbour.html').split('\\').join('/');
  console.log('Opening:', fileUrl);

  const browser = await playwright.chromium.launch();

  // ── Desktop 1440×900 ──
  const p1 = await browser.newPage();
  const consoleErrors = [];
  p1.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  await p1.setViewportSize({ width: 1440, height: 900 });
  await p1.goto(fileUrl);
  await p1.waitForTimeout(2200);

  const headlineLines = await p1.$$eval('.rh-hero__headline .line', els => els.map(e => e.textContent.trim()));
  const heroVisible  = await p1.isVisible('.rh-hero__bg');
  const ctaPrimary   = await p1.isVisible('.rh-hero__actions .btn-brass');
  const ctaSecondary = await p1.isVisible('.rh-hero__actions .btn-chalk');
  const annotation   = await p1.isVisible('.rh-hero__annotation');
  const formVisible  = await p1.isVisible('#rh-contact-form');

  console.log('Headline lines:', headlineLines);
  console.log('Hero bg visible:', heroVisible);
  console.log('Primary CTA visible:', ctaPrimary);
  console.log('Secondary CTA visible:', ctaSecondary);
  console.log('Annotation panel visible:', annotation);
  console.log('Contact form visible:', formVisible);

  await p1.screenshot({ path: '.review/desktop-hero.png', clip: { x:0, y:0, width:1440, height:900 } });
  await p1.screenshot({ path: '.review/desktop-full.png', fullPage: true });
  console.log('Desktop screenshots saved');

  // ── Mobile 390×844 ──
  const p2 = await browser.newPage();
  await p2.setViewportSize({ width: 390, height: 844 });
  await p2.goto(fileUrl);
  await p2.waitForTimeout(1500);
  const menuBtnVisible = await p2.isVisible('#rh-menu-btn');
  const navHidden      = !(await p2.isVisible('.rh-nav'));
  console.log('Mobile menu btn visible:', menuBtnVisible);
  console.log('Desktop nav hidden on mobile:', navHidden);

  await p2.screenshot({ path: '.review/mobile-hero.png', clip: { x:0, y:0, width:390, height:844 } });
  await p2.click('#rh-menu-btn');
  await p2.waitForTimeout(400);
  const navOpen = await p2.evaluate(() => document.getElementById('rh-mobile-nav').classList.contains('open'));
  console.log('Mobile nav opens on click:', navOpen);
  await p2.screenshot({ path: '.review/mobile-nav-open.png', clip: { x:0, y:0, width:390, height:844 } });
  await p2.screenshot({ path: '.review/mobile-full.png', fullPage: true });

  // ── 320px overflow ──
  const p3 = await browser.newPage();
  await p3.setViewportSize({ width: 320, height: 568 });
  await p3.goto(fileUrl);
  await p3.waitForTimeout(1000);
  const scrollW = await p3.evaluate(() => document.body.scrollWidth);
  console.log('320px body.scrollWidth:', scrollW, '— overflow:', scrollW > 320);
  await p3.screenshot({ path: '.review/320px.png' });

  // ── Tablet 768×1024 ──
  const p4 = await browser.newPage();
  await p4.setViewportSize({ width: 768, height: 1024 });
  await p4.goto(fileUrl);
  await p4.waitForTimeout(1500);
  await p4.screenshot({ path: '.review/tablet-full.png', fullPage: true });
  console.log('Tablet screenshot saved');

  // ── Interactions ──
  const p5 = await browser.newPage();
  await p5.setViewportSize({ width: 1440, height: 900 });
  await p5.goto(fileUrl);
  await p5.waitForTimeout(1500);

  const disc1Open = await p5.evaluate(() => document.querySelector('details.rh-disc').open);
  console.log('First expertise disclosure open by default:', disc1Open);

  await p5.locator('#tab-prioritise').scrollIntoViewIfNeeded();
  await p5.locator('#tab-prioritise').click();
  await p5.waitForTimeout(300);
  const tab2Active = await p5.evaluate(() => {
    const p = document.getElementById('panel-prioritise');
    return p && p.classList.contains('active');
  });
  console.log('Approach tab 2 activates:', tab2Active);

  await p5.locator('#tab-build').click();
  await p5.waitForTimeout(300);
  const tab3Active = await p5.evaluate(() => {
    const p = document.getElementById('panel-build');
    return p && p.classList.contains('active');
  });
  console.log('Approach tab 3 activates:', tab3Active);

  await p5.locator('details.rh-faq summary').first().scrollIntoViewIfNeeded();
  await p5.locator('details.rh-faq summary').first().click();
  await p5.waitForTimeout(300);
  const faqOpen = await p5.evaluate(() => document.querySelector('details.rh-faq').open);
  console.log('FAQ 1 opens on click:', faqOpen);

  // Form submit
  await p5.locator('#contact').scrollIntoViewIfNeeded();
  await p5.waitForTimeout(500);
  await p5.fill('input[name="name"]', 'Test User');
  await p5.fill('input[name="email"]', 'test@example.com');
  await p5.locator('.rh-form__submit').click();
  await p5.waitForTimeout(500);
  const resultShown = await p5.evaluate(() => {
    const el = document.getElementById('rh-form-result');
    return el && el.classList.contains('visible');
  });
  console.log('Form result message shown on submit:', resultShown);
  await p5.screenshot({ path: '.review/form-submit.png', clip: { x:0, y:700, width:1440, height:900 } });

  if (consoleErrors.length) {
    console.log('JS console errors:', consoleErrors);
  } else {
    console.log('No JS console errors');
  }

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
