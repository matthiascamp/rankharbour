const playwright = require('C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const path = require('path');
(async () => {
  const url = require('url').pathToFileURL(path.resolve('RankHarbour.html')).href;
  const b = await playwright.chromium.launch();
  for (const [w,h,js] of [[1440,900,true],[1280,800,true],[1024,800,true],[768,1024,true],[390,844,true],[360,740,false]]) {
    const ctx = await b.newContext({ viewport:{width:w,height:h}, javaScriptEnabled: js });
    const p = await ctx.newPage();
    await p.goto(url); await p.waitForTimeout(2500);
    const m = await p.evaluate(() => {
      const r = s => { const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.left),Math.round(b.top),Math.round(b.width),Math.round(b.height)]; };
      const e=document.querySelector('.rh-hero__emblem');
      return { emblem:r('.rh-hero__emblem'), actions:r('.rh-hero__actions'), strip:r('.rh-hero__strip'), hero:r('.rh-hero'), op:getComputedStyle(e).opacity, sw:document.documentElement.scrollWidth };
    });
    console.log(w,h,js?'js':'nojs',JSON.stringify(m));
    await p.screenshot({ path: `.review/emblem-${w}${js?'':'-nojs'}.png`, fullPage:false, clip: {x:0,y:0,width:w,height: Math.min(m.hero[3], 1400)} });
    await ctx.close();
  }
  await b.close();
})().catch(e=>{console.error(e);process.exit(1)});
