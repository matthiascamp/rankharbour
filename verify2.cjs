const playwright = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');

(async () => {
  const fileUrl = 'file:///' + path.resolve('RankHarbour.html').split('\\').join('/');
  const browser = await playwright.chromium.launch();
  const p = await browser.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(fileUrl);
  await p.waitForTimeout(2500);

  // Scroll to section and screenshot the viewport
  async function shotSection(selector, file) {
    const el = p.locator(selector).first();
    await el.scrollIntoViewIfNeeded();
    await p.waitForTimeout(300);
    await p.screenshot({ path: file });
  }

  await shotSection('.rh-position',  '.review/s2-positioning.png');
  await shotSection('.rh-work',      '.review/s3-work.png');
  await shotSection('.rh-expertise', '.review/s4-expertise.png');
  await shotSection('.rh-ai',        '.review/s5-ai.png');
  await shotSection('.rh-approach',  '.review/s6-approach.png');
  await shotSection('.rh-about',     '.review/s7-about.png');
  await shotSection('.rh-contact',   '.review/s8-contact.png');

  const imgLoaded = await p.evaluate(() => {
    const img = document.querySelector('.rh-ai__visual img');
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  });
  console.log('AI image naturalSize:', imgLoaded);

  await browser.close();
  console.log('Done.');
})().catch(e => { console.error(e); process.exit(1); });
