const pw = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');
(async () => {
  const url = 'file:///' + path.resolve('RankHarbour.html').split('\\').join('/');
  const b = await pw.chromium.launch();
  const p = await b.newPage();
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.goto(url);
  await p.waitForTimeout(2000);
  await p.screenshot({ path: '.review/navbar.png', clip: { x: 0, y: 0, width: 1440, height: 90 } });

  const rects = await p.evaluate(() => {
    function mid(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), mid: Math.round(r.top + r.height / 2) };
    }
    return {
      logo:    mid('.rh-logo'),
      navLink: mid('.rh-nav__link'),
      cta:     mid('.rh-header__cta'),
      header:  mid('.rh-header'),
    };
  });
  console.log(JSON.stringify(rects, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
