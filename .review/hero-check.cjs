const { chromium } = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const url = 'file:///' + path.resolve(__dirname, '..', 'RankHarbour.html').replace(/\\/g, '/');
  for (const w of [1440, 1280, 768, 390, 320]) {
    const p = await b.newPage({ viewport: { width: w, height: w > 700 ? 900 : 800 } });
    await p.goto(url);
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => {
      const box = s => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right), b: Math.round(r.bottom) }; };
      const h1 = document.querySelector('.rh-hero__headline');
      const lines = [...h1.querySelectorAll('.line')].map(l => { const rg = document.createRange(); rg.selectNodeContents(l); const rr = rg.getBoundingClientRect(); return Math.round(rr.right); });
      const header = document.querySelector('header') || document.querySelector('.rh-header');
      // elements wider than the viewport
      const over = [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(e).position !== 'fixed').slice(0, 5).map(e => e.className || e.tagName);
      return { vw: innerWidth, sw: document.documentElement.scrollWidth, header: header ? box(header.tagName.toLowerCase() === 'header' ? 'header' : '.rh-header') : null,
        emblem: box('.rh-hero__emblem'), content: box('.rh-hero__content'), h1: box('.rh-hero__headline'), lineRights: lines,
        h1fs: getComputedStyle(h1).fontSize, actions: box('.rh-hero__actions'), hero: box('.rh-hero'), over };
    });
    console.log(w, JSON.stringify(r));
    await p.screenshot({ path: path.join(__dirname, `hero-${w}.png`) });
    await p.close();
  }
  await b.close();
})();
