const pw = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');
(async () => {
  const url = 'file:///' + path.resolve('RankHarbour.html').split('\\').join('/');
  const browser = await pw.chromium.launch();
  const p = await browser.newPage();
  await p.setViewportSize({ width: 768, height: 1024 });
  await p.goto(url);
  await p.waitForTimeout(2000);

  const data = await p.evaluate(() => {
    function info(sel) {
      const el = document.querySelector(sel);
      if (!el) return { h: 'NOT_FOUND', top: 0 };
      const r = el.getBoundingClientRect();
      return { h: Math.round(r.height), top: Math.round(r.top + window.scrollY) };
    }
    return {
      total: document.body.scrollHeight,
      hero:      info('.rh-hero'),
      position:  info('.rh-position'),
      work:      info('.rh-work'),
      expertise: info('.rh-expertise'),
      ai:        info('.rh-ai'),
      approach:  info('.rh-approach'),
      about:     info('.rh-about'),
      contact:   info('.rh-contact'),
      footer:    info('.rh-footer'),
    };
  });

  console.log(JSON.stringify(data, null, 2));
  await p.screenshot({ path: '.review/tablet-full.png', fullPage: true });
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
