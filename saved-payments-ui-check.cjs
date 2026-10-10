// Serve the project on localhost:8765. Backend/Stripe calls are mocked.
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const exp=Math.floor(Date.now()/1000)+3600,b64=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
const user={id:'payment-test',aud:'authenticated',role:'authenticated',email:'payment-test@example.invalid',user_metadata:{},app_metadata:{}};
const session={access_token:`${b64({alg:'HS256'})}.${b64({sub:user.id,exp,role:'authenticated',aud:'authenticated'})}.sig`,token_type:'bearer',expires_in:3600,expires_at:exp,refresh_token:'fixture-refresh',user};
(async()=>{
  const browser=await chromium.launch();
  try {
    for(const width of [1440,390,320]){
      const context=await browser.newContext({viewport:{width,height:1000}}),page=await context.newPage();
      let saved=false,malicious=false;const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
      await context.addInitScript(s=>localStorage.setItem('sb-gczopudgxfciatvtxhll-auth-token',JSON.stringify(s)),session);
      await context.route('https://checkout.stripe.com/**',route=>route.fulfill({contentType:'text/html',body:'<title>Mock Stripe</title><p>Stripe sandbox checkout</p>'}));
      await context.route('https://gczopudgxfciatvtxhll.supabase.co/**',route=>{
        const req=route.request(),path=new URL(req.url()).pathname;let body={};
        if(path==='/auth/v1/user')body=user;
        else if(path.includes('/token'))body=session;
        else if(path.includes('user_roles'))body=[];
        else if(path.includes('profiles'))body={id:user.id};
        else if(path.endsWith('/billing')){
          const input=req.postDataJSON();calls.push(input);
          if(input.action==='status')body={subscriptions:[],preview:null,testMode:true,paymentMethods:saved?[{brand:'visa',last4:'4242',expMonth:12,expYear:2030}]:[]};
          else body={url:malicious?'https://attacker.invalid/':'https://checkout.stripe.com/c/test-fixture'};
        }
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      });
      await page.goto('http://127.0.0.1:8765/account.html?tab=account&billing=card-saved');
      await page.waitForSelector('#dash-panel-account:not([hidden])');
      await page.waitForFunction(()=>!document.querySelector('#save-payment-method').disabled);
      assert.match(await page.textContent('#payment-methods-status'),/No saved payment methods/);
      const popupPromise=page.waitForEvent('popup');await page.click('#save-payment-method');const popup=await popupPromise;
      await popup.waitForURL('https://checkout.stripe.com/**');
      assert.deepEqual(calls.find(c=>c.action==='save-payment-method'),{action:'save-payment-method'});
      await popup.close();saved=true;await page.click('#billing-refresh');
      await page.waitForFunction(()=>document.querySelector('#payment-methods-list').textContent.includes('4242'));
      assert.match(await page.textContent('#payment-methods-list'),/VISA ending 4242/);
      assert.equal(await page.textContent('#save-payment-method'),'Add another card');
      await page.screenshot({path:`.review/saved-payments-${width}.png`,fullPage:true});
      assert.ok(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
      await page.click('#dash-tab-pricing');const checkoutPromise=page.waitForEvent('popup');
      await page.click('[data-subscribe=starter]');const checkout=await checkoutPromise;await checkout.waitForURL('https://checkout.stripe.com/**');
      assert.deepEqual(calls.find(c=>c.action==='checkout'),{action:'checkout',plan:'starter'});await checkout.close();
      await page.click('#dash-tab-account');malicious=true;await page.click('#save-payment-method');
      await page.waitForFunction(()=>[...document.querySelectorAll('[data-billing-message]')].some(el=>el.textContent.includes('Unexpected checkout destination')));
      await page.evaluate(async()=>{const {getSupabaseClient}=await import('./src/auth/client.js');await getSupabaseClient().auth.signOut({scope:'local'});});
      await page.waitForSelector('[data-view=signin]:not([hidden])');assert.equal(await page.textContent('#payment-methods-list'),'');assert.equal(await page.textContent('#payment-methods-status'),'');assert.deepEqual(errors,[]);
      console.log(`PASS saved card, checkout, unsafe redirect rejection, sign-out and layout at ${width}px`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
