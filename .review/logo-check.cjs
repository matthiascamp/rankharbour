const pw = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');
(async () => {
  const b = await pw.chromium.launch();
  for (const [page, w, h] of [['RankHarbour.html',1440,900],['RankHarbour.html',375,740],['account.html',1440,300],['account.html',375,300]]) {
    const p = await b.newPage();
    await p.setViewportSize({ width: w, height: h });
    await p.goto(require('url').pathToFileURL(path.resolve(page)).href);
    await p.waitForTimeout(2500);
    const m = await p.evaluate(() => {
      const r = s => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [b.x,b.y,b.width,b.height].map(Math.round); };
      return { logo:r('.rh-logo'), mark:r('.rh-logo__mark'), word:r('.rh-logo__word'), header:r('.rh-header'), content:r('.rh-hero__content'), sw:document.documentElement.scrollWidth, markFilter: getComputedStyle(document.querySelector('.rh-logo__mark')).filter };
    });
    console.log(page, w, JSON.stringify(m));
    await p.screenshot({ path: `.review/logo-${page.split('.')[0]}-${w}.png`, clip:{x:0,y:0,width:w,height:h} });
    await p.close();
  }
  await b.close();
})();
