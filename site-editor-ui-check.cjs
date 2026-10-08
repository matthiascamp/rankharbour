// Run a local server on port 8765 before running this check. All backend calls
// are mocked: no client repository or real user account is changed.
const assert=require('node:assert/strict');
const playwright=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const exp=Math.floor(Date.now()/1000)+3600;
const user={id:'editor-test',aud:'authenticated',role:'authenticated',email:'editor@example.com',user_metadata:{},app_metadata:{},created_at:new Date().toISOString()};
const session={access_token:`${b64({alg:'HS256',typ:'JWT'})}.${b64({sub:user.id,exp,role:'authenticated',aud:'authenticated'})}.sig`,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'test-refresh',user};
const source='<!DOCTYPE html><html><head>\n<title>Old</title><meta name="description" content="Old description"><script>window.test = "unchanged";</script>\n</head><body><h1>Keep body exactly</h1></body></html>';
(async()=>{
  const browser=await playwright.chromium.launch();
  try {
    for(const width of [1440,390,320]){
      const context=await browser.newContext({viewport:{width,height:900}});
      await context.addInitScript(s=>localStorage.setItem('sb-gczopudgxfciatvtxhll-auth-token',JSON.stringify(s)),session);
      const calls=[],errors=[];let stale=false;
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await context.route('https://gczopudgxfciatvtxhll.supabase.co/**',async route=>{
        const req=route.request(),path=new URL(req.url()).pathname;
        let body={},status=200;
        if(path==='/auth/v1/user')body=user;
        else if(path.includes('/token'))body=session;
        else if(path.includes('user_roles'))body=[];
        else if(path.includes('profiles'))body={id:user.id,display_name:'Editor'};
        else if(path.endsWith('/billing'))body={subscriptions:[],preview:null};
        else if(path.endsWith('/site-editor')){
          const data=req.postDataJSON();calls.push(data);
          if(data.action==='connect')body={repo:'client/site',branch:'main',headSha:'a'.repeat(40),files:['index.html','src/page.tsx']};
          else if(data.action==='read')body={content:source,path:data.path};
          else if(stale){status=409;body={error:'The repository changed. Reconnect and reload.'};}
          else body={url:'https://github.com/client/site/pull/1',message:'Changes committed. Review your pull request on GitHub before merging.'};
        }
        await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      });
      await page.goto('http://127.0.0.1:8765/account.html?tab=editor');
      await page.waitForSelector('#dash-panel-editor:not([hidden])');
      for(const tab of ['overview','pricing','seo','account','editor']){
        await page.click(`#dash-tab-${tab}`);
        assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('[role=tabpanel]')].filter(el=>!el.hidden).map(el=>el.id)),[`dash-panel-${tab}`]);
      }
      await page.fill('#editor-repo','client/site');await page.fill('#editor-token','github_pat_test');
      await page.click('#editor-connect button[type=submit]');
      await page.waitForSelector('#editor-workspace:not([hidden])');
      assert.equal(await page.inputValue('#editor-token'),'');
      await page.click('#editor-load');await page.waitForFunction(()=>document.querySelector('#editor-code').value.includes('<title>Old</title>'));
      await page.fill('#editor-title','New & better <title>');await page.fill('#editor-description','Description with "quotes" & details');
      await page.click('#editor-apply-tags');
      const edited=await page.inputValue('#editor-code');
      assert.equal(edited.slice(edited.indexOf('</head>')),source.slice(source.indexOf('</head>')));
      assert.ok(edited.includes('window.test = "unchanged";'));
      const tags=await page.evaluate(text=>{
        const doc=new DOMParser().parseFromString(text,'text/html');return {title:doc.title,description:doc.querySelector('meta[name=description]').content};
      },edited);
      assert.deepEqual(tags,{title:'New & better <title>',description:'Description with "quotes" & details'});
      assert.equal(await page.evaluate(()=>window.test),undefined,'source scripts are never executed');
      await page.fill('#editor-summary','Improve title and description');
      await page.click('#editor-publish');await page.waitForSelector('#editor-result:not([hidden])');
      assert.equal(calls.find(c=>c.action==='publish').content,edited);
      assert.ok(calls.every(c=>c.token==='github_pat_test'));
      assert.equal(await page.getAttribute('#editor-result','href'),'https://github.com/client/site/pull/1');
      assert.ok(!await page.evaluate(()=>Object.values(localStorage).some(v=>v.includes('github_pat_test'))));
      assert.ok(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),`no overflow at ${width}`);
      await page.screenshot({path:`.review/site-editor-${width}.png`,fullPage:true});
      stale=true;await page.fill('#editor-code',edited+'\n<!-- next change -->');await page.click('#editor-publish');
      await page.waitForFunction(()=>document.querySelector('#editor-status').textContent.includes('repository changed'));
      assert.equal(await page.inputValue('#editor-code'),edited+'\n<!-- next change -->','failed publish preserves edits');
      await page.evaluate(async()=>{const {getSupabaseClient}=await import('./src/auth/client.js');await getSupabaseClient().auth.signOut({scope:'local'});});
      await page.waitForSelector('[data-view=signin]:not([hidden])');
      assert.equal(await page.inputValue('#editor-code'),'');assert.equal(await page.inputValue('#editor-token'),'');
      assert.equal(await page.textContent('#editor-repository'),'');assert.deepEqual(errors,[]);
      console.log(`PASS editor connect, tags, PR, conflict, token cleanup and layout at ${width}px`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
