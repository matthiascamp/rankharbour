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
      let saved=false,malicious=false,outcome='paid';const calls=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
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
          if(input.action==='status')body={subscriptions:[],preview:null,testMode:true,paymentMethods:saved?[{id:'pm_saved',brand:'visa',last4:'4242',expMonth:12,expYear:2030}]:[]};
          else if(input.action==='quote')body={quote:{id:'fixture-order',plan:input.plan,backlinks:input.backlinks,amount:input.backlinks?12800:9900,items:[{name:'Starter',amount:9900},...(input.backlinks?[{name:'Backlinks',amount:2900}]:[])]}};
          else if(input.action==='confirm-subscription')body={receipt:{id:input.orderId,status:outcome,verificationUrl:'https://invoice.stripe.com/i/fixture',plan:'starter',backlinks:true,amount:12800,amountPaid:12800,items:[{name:'Starter',amount:9900},{name:'Backlinks',amount:2900}],invoiceNumber:'RH-TEST-1',nextBillingDate:'2026-11-07T00:00:00Z'}};
          else if(input.action==='order-status')body={receipt:{id:input.orderId,status:'paid',plan:'starter',amount:12800,amountPaid:12800,items:[{name:'Starter',amount:9900},{name:'Backlinks',amount:2900}],invoiceNumber:'RH-TEST-2',nextBillingDate:'2026-11-07T00:00:00Z'}};
          else if(input.action==='cancel-order')body={canceled:true};
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
      await page.click('#dash-tab-pricing');
      await page.check('#backlinks-toggle');assert.ok(!calls.some(c=>['quote','confirm-subscription'].includes(c.action)));
      await page.click('[data-subscribe=starter]');await page.waitForSelector('#subscription-review:not([hidden])');
      await page.waitForFunction(()=>document.querySelector('#subscription-summary').textContent.includes('128.00'));
      assert.deepEqual(calls.find(c=>c.action==='quote'),{action:'quote',plan:'starter',backlinks:true});
      assert.equal(await page.isDisabled('#subscription-confirm'),true);
      await page.click('#subscription-dismiss');assert.ok(!calls.some(c=>c.action==='confirm-subscription'));
      await page.click('[data-subscribe=starter]');await page.waitForFunction(()=>document.querySelector('#subscription-card').value==='pm_saved');
      await page.check('#subscription-consent');await page.click('#subscription-confirm');
      await page.waitForFunction(()=>document.querySelector('#subscription-result').textContent.includes('RH-TEST-1'));
      assert.match(await page.textContent('#subscription-result'),/Paid.*128.00/);
      assert.equal(calls.filter(c=>c.action==='confirm-subscription').length,1);
      assert.ok(!calls.some(c=>c.action==='checkout'));
      await page.screenshot({path:`.review/subscription-receipt-${width}.png`,fullPage:true});
      assert.ok(!await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));
      outcome='requires_action';await page.click('[data-subscribe=starter]');
      await page.waitForFunction(()=>!document.querySelector('#subscription-payment').hidden);
      await page.check('#subscription-consent');await page.click('#subscription-confirm');
      await page.waitForFunction(()=>document.querySelector('#subscription-result').textContent.includes('bank requires verification'));
      assert.equal(await page.getAttribute('#subscription-receipt-actions a','href'),'https://invoice.stripe.com/i/fixture');
      assert.ok(!(await page.textContent('#subscription-result')).includes('Paid'));
      await page.getByRole('button',{name:'Check payment status',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#subscription-result').textContent.includes('RH-TEST-2'));
      outcome='payment_failed';await page.click('[data-subscribe=starter]');
      await page.waitForFunction(()=>!document.querySelector('#subscription-payment').hidden);
      await page.check('#subscription-consent');await page.click('#subscription-confirm');
      await page.waitForFunction(()=>document.querySelector('#subscription-result').textContent.includes('declined'));
      await page.getByRole('button',{name:'Cancel pending subscription',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('#subscription-review').hidden);
      await page.click('#dash-tab-account');malicious=true;await page.click('#save-payment-method');
      await page.waitForFunction(()=>[...document.querySelectorAll('[data-billing-message]')].some(el=>el.textContent.includes('Unexpected checkout destination')));
      await page.evaluate(async()=>{const {getSupabaseClient}=await import('./src/auth/client.js');await getSupabaseClient().auth.signOut({scope:'local'});});
      await page.waitForSelector('[data-view=signin]:not([hidden])');assert.equal(await page.textContent('#payment-methods-list'),'');assert.equal(await page.textContent('#payment-methods-status'),'');assert.deepEqual(errors,[]);
      console.log(`PASS saved card, embedded confirmation/receipt, bank verification, declined-payment cancellation, unsafe redirect rejection, sign-out and layout at ${width}px`);
      await context.close();
    }
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
