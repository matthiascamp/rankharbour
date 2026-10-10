import test from 'node:test';
import assert from 'node:assert/strict';
import {setupParams,subscriptionParams,matchesCheckout,cardSummary,accountUrl} from './supabase/functions/_shared/checkout.ts';
const intent={id:'intent-1',livemode:false,stripe_customer_id:'cus_owner',price_id:'price_plan',checkout_session_id:'cs_owned',expires_at:new Date(Date.now()+35*60000).toISOString()};
const session={id:'cs_owned',mode:'subscription',client_reference_id:'intent-1',subscription:'sub_owned',customer:'cus_owner',livemode:false};
test('saving a card uses a setup checkout without a price or payment',()=>{
  const params=setupParams('cus_owner','owner','https://rankharbour.com.au');
  assert.equal(params.get('mode'),'setup');assert.equal(params.get('customer'),'cus_owner');
  assert.equal(params.get('line_items[0][price]'),null);assert.equal(params.get('setup_intent_data[metadata][rankharbour_user_id]'),'owner');
  assert.match(params.get('custom_text[submit][message]'),/No payment is taken now/);
});
test('subscription checkout reuses the trusted customer and server price',()=>{
  const params=subscriptionParams('cus_owner',intent,'https://rankharbour.com.au');
  assert.equal(params.get('mode'),'subscription');assert.equal(params.get('customer'),'cus_owner');
  assert.equal(params.get('line_items[0][price]'),'price_plan');assert.equal(params.get('line_items[0][quantity]'),'1');
  assert.equal(params.get('saved_payment_method_options[allow_redisplay_filters][2]'),'unspecified');
});
test('webhook binding rejects another customer, session, mode or reference',()=>{
  assert.equal(matchesCheckout(session,intent,'sub_owned'),true);
  for(const patch of [{customer:'cus_other'},{id:'cs_other'},{livemode:true},{client_reference_id:'other'},{subscription:'sub_other'},{mode:'setup'}]){
    assert.equal(matchesCheckout({...session,...patch},intent,'sub_owned'),false,JSON.stringify(patch));
  }
  assert.equal(matchesCheckout(session,null,'sub_owned'),false);
});
test('legacy Payment Link purchases remain bound to the right reference and link',()=>{
  const legacy={...intent,payment_link_id:'plink_owned',checkout_session_id:null};
  assert.equal(matchesCheckout({...session,payment_link:'plink_owned'},legacy,'sub_owned'),true);
  assert.equal(matchesCheckout({...session,payment_link:'plink_other'},legacy,'sub_owned'),false);
});
test('card summaries expose only display data, never Stripe identifiers or billing details',()=>{
  assert.deepEqual(cardSummary({id:'pm_private',customer:'cus_private',type:'card',billing_details:{email:'private@example.com'},card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030,fingerprint:'private'}}),{brand:'visa',last4:'4242',expMonth:12,expYear:2030});
  assert.equal(cardSummary({type:'bank_account'}),null);
});
test('return URL stays on the configured app origin and refuses remote HTTP',()=>{
  assert.equal(new URL(accountUrl('https://rankharbour.com.au','card-saved')).hostname,'rankharbour.com.au');
  assert.throws(()=>accountUrl('http://attacker.example','card-saved'));
});
