const playwright = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');

(async () => {
  const fileUrl = 'file:///' + path.resolve('RankHarbour.html').split('\\').join('/');
  const browser = await playwright.chromium.launch();
  const p = await browser.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(fileUrl);
  await p.waitForTimeout(2500);

  const heights = await p.evaluate(() => {
    function h(s) {
      const el = document.querySelector(s);
      return el ? Math.round(el.getBoundingClientRect().height) : 'NOT_FOUND';
    }
    return {
      total:     document.body.scrollHeight,
      header:    h('header'),
      hero:      h('.rh-hero'),
      position:  h('.rh-position'),
      work:      h('.rh-work'),
      expertise: h('.rh-expertise'),
      ai:        h('.rh-ai'),
      approach:  h('.rh-approach'),
      about:     h('.rh-about'),
      contact:   h('.rh-contact'),
      faq:       h('.rh-faq-sec'),
      footer:    h('.rh-footer'),
    };
  });

  console.log(JSON.stringify(heights, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
