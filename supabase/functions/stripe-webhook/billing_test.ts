import {verifySignature} from './signature.ts';
import {validPrice,PLANS,checkoutError,ADDON_PLAN} from '../_shared/billing.ts';
const assert=(value:unknown)=>{if(!value) throw new Error('Assertion failed');};
Deno.test('Stripe signature rejects tampering, missing signatures and replay',async()=>{
  const secret='test_webhook_secret',body='{"id":"evt_fixture"}',t=Math.floor(Date.now()/1000);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+body));
  const hex=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  const header=`t=${t},v1=${hex}`;
  assert(await verifySignature(body,header,secret,t*1000));
  assert(!await verifySignature(body+' ',header,secret,t*1000));
  assert(!await verifySignature(body,header,'wrong',t*1000));
  assert(!await verifySignature(body,header,secret,(t+301)*1000));
  assert(!await verifySignature(body,'',secret,t*1000));
});
Deno.test('All plans and add-ons require their exact AUD four-week recurring price',()=>{
  for(const [plan,details] of Object.entries(PLANS)) {
    const price={unit_amount:details.amount,currency:'aud',recurring:{interval:'day',interval_count:28}};
    assert(validPrice(price,plan));
    assert(!validPrice({...price,unit_amount:1},plan));
    assert(!validPrice({...price,currency:'usd'},plan));
    assert(!validPrice({...price,recurring:{interval:'month',interval_count:1}},plan));
  }
});
Deno.test('Add-on eligibility, duplicate prevention and preview protection',()=>{
  const base={plan:'pro',status:'active'},addon={plan:ADDON_PLAN,status:'active'};
  assert(checkoutError(ADDON_PLAN,[],null));
  assert(checkoutError(ADDON_PLAN,[{...base,status:'past_due'}],null));
  assert(checkoutError(ADDON_PLAN,[base],null)===null);
  assert(checkoutError(ADDON_PLAN,[base,addon],null));
  assert(checkoutError(ADDON_PLAN,[base,{...addon,status:'canceled'}],null)===null);
  assert(checkoutError(ADDON_PLAN,[base],{plan:'pro'}));
  assert(checkoutError('growth',[base,addon],null));
  assert(checkoutError('growth',[addon],null)===null);
});
