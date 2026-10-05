import { chromium } from 'C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs';
import { resolve } from 'path';

const fileUrl = 'file:///' + resolve('RankHarbour.html').replace(/\\/g, '/');

const browser = await chromium.launch();

// Desktop 1440x900
const page1 = await browser.newPage();
await page1.setViewportSize({ width: 1440, height: 900 });

const consoleErrors = [];
page1.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

await page1.goto(fileUrl);
await page1.waitForTimeout(2000);

const headlineLines = await page1.$$eval('.rh-hero__headline .line', els => els.map(e => e.textContent.trim()));
const heroVisible = await page1.isVisible('.rh-hero__bg');
const ctaPrimary = await page1.isVisible('.rh-hero__actions .btn-brass');
const ctaSecondary = await page1.isVisible('.rh-hero__actions .btn-chalk');
const annotation = await page1.isVisible('.rh-hero__annotation');

console.log('Headline lines:', headlineLines);
console.log('Hero bg visible:', heroVisible);
console.log('Primary CTA visible:', ctaPrimary);
console.log('Secondary CTA visible:', ctaSecondary);
console.log('Annotation visible:', annotation);

await page1.screenshot({ path: '.review/desktop-hero.png', clip: { x: 0, y: 0, width: 1440, height: 900 } });
await page1.screenshot({ path: '.review/desktop-full.png', fullPage: true });
console.log('Desktop screenshots saved');

// Mobile 390x844
const page2 = await browser.newPage();
await page2.setViewportSize({ width: 390, height: 844 });
await page2.goto(fileUrl);
await page2.waitForTimeout(1500);
await page2.screenshot({ path: '.review/mobile-hero.png', clip: { x: 0, y: 0, width: 390, height: 844 } });
await page2.screenshot({ path: '.review/mobile-full.png', fullPage: true });

const menuBtnVisible = await page2.isVisible('#rh-menu-btn');
const desktopNavHidden = !await page2.isVisible('.rh-nav');
console.log('Mobile menu btn visible:', menuBtnVisible);
console.log('Desktop nav hidden on mobile:', desktopNavHidden);

await page2.click('#rh-menu-btn');
await page2.waitForTimeout(400);
const mobileNavOpen = await page2.isVisible('#rh-mobile-nav.open');
console.log('Mobile nav opens on click:', mobileNavOpen);
await page2.screenshot({ path: '.review/mobile-nav-open.png', clip: { x: 0, y: 0, width: 390, height: 844 } });

// 320px overflow
const page3 = await browser.newPage();
await page3.setViewportSize({ width: 320, height: 568 });
await page3.goto(fileUrl);
await page3.waitForTimeout(1000);
const bodyScrollWidth = await page3.evaluate(() => document.body.scrollWidth);
console.log(`320px scrollWidth: ${bodyScrollWidth} (overflow: ${bodyScrollWidth > 320})`);
await page3.screenshot({ path: '.review/320px.png' });

// Tablet 768x1024
const page4 = await browser.newPage();
await page4.setViewportSize({ width: 768, height: 1024 });
await page4.goto(fileUrl);
await page4.waitForTimeout(1500);
await page4.screenshot({ path: '.review/tablet-full.png', fullPage: true });
console.log('Tablet screenshot saved');

// Interaction checks
const page5 = await browser.newPage();
await page5.setViewportSize({ width: 1440, height: 900 });
await page5.goto(fileUrl);
await page5.waitForTimeout(1500);

// Expertise disclosure default state
const firstDiscOpen = await page5.evaluate(() => document.querySelector('details.rh-disc').open);
console.log('First expertise disclosure open by default:', firstDiscOpen);

// Click 2nd expertise disclosure
await page5.locator('details.rh-disc:nth-of-type(2) summary').scrollIntoViewIfNeeded();
await page5.locator('details.rh-disc:nth-of-type(2) summary').click();
await page5.waitForTimeout(300);
const disc2Open = await page5.evaluate(() => document.querySelectorAll('details.rh-disc')[1].open);
console.log('Second expertise disclosure opens on click:', disc2Open);

// Approach tabs
await page5.locator('#approach').scrollIntoViewIfNeeded();
await page5.waitForTimeout(500);
await page5.locator('#tab-prioritise').click();
await page5.waitForTimeout(300);
const panel2Active = await page5.evaluate(() => document.getElementById('panel-prioritise').classList.contains('active'));
const panel1Hidden = await page5.evaluate(() => !document.getElementById('panel-discover').classList.contains('active'));
console.log('Approach tab 2 activates panel 2:', panel2Active);
console.log('Approach panel 1 deactivates:', panel1Hidden);

// FAQ open
await page5.locator('.rh-faq:nth-of-type(1) summary').scrollIntoViewIfNeeded();
await page5.locator('.rh-faq:nth-of-type(1) summary').click();
await page5.waitForTimeout(300);
const faq1Open = await page5.evaluate(() => document.querySelector('details.rh-faq').open);
console.log('FAQ 1 opens on click:', faq1Open);

// Form visible
const formVisible = await page5.isVisible('#rh-contact-form');
console.log('Contact form visible:', formVisible);

// Test form submit (fake)
await page5.locator('#contact').scrollIntoViewIfNeeded();
await page5.waitForTimeout(500);
await page5.fill('input[name="name"]', 'Test User');
await page5.fill('input[name="email"]', 'test@example.com');
await page5.click('.rh-form__submit');
await page5.waitForTimeout(500);
const resultVisible = await page5.isVisible('#rh-form-result.visible');
console.log('Form result shows on submit:', resultVisible);

await page5.screenshot({ path: '.review/desktop-interactions.png', fullPage: true });

if (consoleErrors.length) {
  console.log('Console errors:', consoleErrors);
} else {
  console.log('No JS console errors');
}

await browser.close();
console.log('All verification steps complete.');
