import {directSubscriptionParams,matchesDirectSubscription,paymentReceipt} from '../supabase/functions/_shared/order-shapes.ts';
// Sandbox-only integration check. Creates temporary Stripe fixtures and cleans
// them up. Never accepts a live key; never logs keys or Checkout session URLs.
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {setupParams,cardSummary} from '../supabase/functions/_shared/checkout.ts';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/Matthias/AppData/Local/npm-cache/_npx/420ff84f11983ee5/node_modules/playwright');
const contents=readFileSync('.env.local','utf8');
const key=contents.split(/\r?\n/).find(line=>line.startsWith('STRIPE_SECRET_KEY='))?.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
assert.ok(key?.startsWith('sk_test_'),'This test requires a Stripe test secret key.');
async function stripe(path,body,method=body?'POST':'GET',idempotencyKey){
  const response=await fetch('https://api.stripe.com/v1/'+path,{method,headers:{Authorization:`Bearer ${key}`,'Stripe-Version':'2025-02-24.acacia',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{}),...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body,signal:AbortSignal.timeout(20000)});
  const data=await response.json();
  if(!response.ok)throw new Error(`Stripe ${response.status}: ${data.error?.code || data.error?.param || 'request failed'}`);
  return data;
}
let customer,product,price,addonPrice,setupSession,checkout,subscription,browser,page;
try {
  customer=await stripe('customers',new URLSearchParams({email:'rankharbour-test@example.invalid','metadata[purpose]':'saved-payment-integration-test'}));
  assert.equal(customer.livemode,false);
  setupSession=await stripe('checkout/sessions',setupParams(customer.id,'sandbox-user','http://127.0.0.1:8765'));
  assert.equal(setupSession.mode,'setup');assert.equal(setupSession.amount_total,null);
  console.log('PASS setup Checkout created without a charge');
  browser=await chromium.launch();
  page=await browser.newPage({viewport:{width:1280,height:1000}});
  await page.goto(setupSession.url);
  await page.locator('#cardNumber').fill('4242424242424242',{timeout:45000});
  await page.locator('#cardExpiry').fill('1230');await page.locator('#cardCvc').fill('123');
  await page.locator('#billingName').fill('RankHarbour Sandbox');
  const country=page.locator('#billingCountry');if(await country.count())await country.selectOption('AU');
  const postcode=page.locator('#billingPostalCode');if(await postcode.isVisible())await postcode.fill('4000');
  const linkOptIn=page.getByRole('checkbox',{name:/Save my information for faster checkout/i});
  if(await linkOptIn.count())await linkOptIn.uncheck();
  await page.locator('[data-testid=hosted-payment-submit-button]').click();
  await page.waitForURL(url=>url.hostname==='127.0.0.1',{timeout:30000,waitUntil:'commit'});
  const completed=await stripe(`checkout/sessions/${setupSession.id}`);
  assert.equal(completed.status,'complete');
  const setup=await stripe(`setup_intents/${completed.setup_intent}`);
  assert.equal(setup.status,'succeeded');assert.equal(setup.customer,customer.id);
  const method=await stripe(`payment_methods/${setup.payment_method}`);
  assert.equal(method.customer,customer.id);assert.equal(cardSummary(method).last4,'4242');
  await stripe(`payment_methods/${method.id}`,new URLSearchParams({allow_redisplay:'always'}));
  await stripe(`customers/${customer.id}`,new URLSearchParams({'invoice_settings[default_payment_method]':method.id}));
  console.log('PASS card saved through Stripe-hosted setup and attached to the same customer');
  product=await stripe('products',new URLSearchParams({name:'RankHarbour sandbox verification'}));
  price=await stripe('prices',new URLSearchParams({product:product.id,currency:'aud',unit_amount:'9900','recurring[interval]':'day','recurring[interval_count]':'28'}));
  addonPrice=await stripe('prices',new URLSearchParams({product:product.id,currency:'aud',unit_amount:'2900','recurring[interval]':'day','recurring[interval_count]':'28'}));
  const order={id:crypto.randomUUID(),plan:'starter',backlinks:true,amount:12800,livemode:false,confirmed_at:new Date().toISOString(),stripe_customer_id:customer.id,payment_method_id:method.id,items:[{plan:'starter',name:'Starter',priceId:price.id,amount:9900},{plan:'backlinks',name:'Backlinks',priceId:addonPrice.id,amount:2900}]};
  const sub=await stripe('subscriptions',directSubscriptionParams(order),'POST',`rankharbour-order-${order.id}`);
  subscription=sub.id;
  assert.equal(sub.status,'active');assert.equal(sub.default_payment_method,method.id);assert.equal(sub.latest_invoice.amount_paid,12800);assert.ok(matchesDirectSubscription(sub,order));
  assert.equal(paymentReceipt(order,sub).status,'paid');assert.equal(paymentReceipt(order,sub).amountPaid,12800);
  const retry=await stripe('subscriptions',directSubscriptionParams(order),'POST',`rankharbour-order-${order.id}`);assert.equal(retry.id,sub.id);
  console.log('PASS saved card directly charged A$128 for Starter + Backlinks; embedded receipt verified; retry returns same subscription');
  for(const [testMethod,expected] of [['pm_card_authenticationRequired','requires_action'],['pm_card_chargeCustomerFail','payment_failed']]) {
    const attached=await stripe(`payment_methods/${testMethod}/attach`,new URLSearchParams({customer:customer.id}));
    const attempt={...order,id:crypto.randomUUID(),payment_method_id:attached.id};
    let pending;
    try {
      pending=await stripe('subscriptions',directSubscriptionParams(attempt),'POST',`rankharbour-order-${attempt.id}`);
      assert.equal(pending.status,'incomplete');assert.equal(paymentReceipt(attempt,pending).status,expected);assert.equal(paymentReceipt(attempt,pending).amountPaid,null);assert.ok(pending.latest_invoice.hosted_invoice_url);
      console.log(`PASS ${expected} remains unpaid with a secure invoice recovery link`);
    } finally {if(pending)await stripe(`subscriptions/${pending.id}`,undefined,'DELETE');}
  }

} catch(error) {
  if(page){await page.screenshot({path:'.review/stripe-sandbox-error.png',fullPage:true}).catch(()=>{});console.log('Checkout validation:',await page.locator('[role=alert],.FieldError,.FieldError-container').allTextContents().catch(()=>[]));}
  throw error;
} finally {
  // Retrieve a completed subscription even if a browser assertion timed out.
  if(checkout && !subscription){const result=await stripe(`checkout/sessions/${checkout.id}`).catch(()=>null);subscription=result?.subscription;}
  if(subscription)await stripe(`subscriptions/${subscription}`,undefined,'DELETE');
  for(const session of [setupSession,checkout])if(session){const current=await stripe(`checkout/sessions/${session.id}`).catch(()=>null);if(current?.status==='open')await stripe(`checkout/sessions/${session.id}/expire`,new URLSearchParams());}
  if(addonPrice)await stripe(`prices/${addonPrice.id}`,new URLSearchParams({active:'false'}));
  if(price)await stripe(`prices/${price.id}`,new URLSearchParams({active:'false'}));
  if(product)await stripe(`products/${product.id}`,new URLSearchParams({active:'false'}));
  if(customer)await stripe(`customers/${customer.id}`,undefined,'DELETE');
  await browser?.close();
  console.log('Sandbox cleanup completed.');
}
