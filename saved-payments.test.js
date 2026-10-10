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

const {directSubscriptionParams,matchesDirectSubscription,paymentReceipt}=await import('./supabase/functions/_shared/order-shapes.ts');
const order={id:'order-1',confirmed_at:'2026-10-10T00:00:00Z',livemode:false,stripe_customer_id:'cus_owner',payment_method_id:'pm_owned',plan:'starter',backlinks:true,amount:12800,items:[{plan:'starter',name:'Starter',priceId:'price_base',amount:9900},{plan:'backlinks',name:'Backlinks',priceId:'price_addon',amount:2900}]};
const subscription={id:'sub_owned',customer:'cus_owner',livemode:false,metadata:{rankharbour_order_id:'order-1'},status:'active',items:{data:order.items.map(i=>({quantity:1,price:{id:i.priceId,unit_amount:i.amount,currency:'aud',recurring:{interval:'day',interval_count:28}}}))},latest_invoice:{paid:true,amount_paid:12800,number:'RH-1'}};
test('direct subscriptions charge the frozen saved card with both recurring prices',()=>{
  const params=directSubscriptionParams(order);
  assert.equal(params.get('default_payment_method'),'pm_owned');assert.equal(params.get('payment_behavior'),'allow_incomplete');
  assert.equal(params.get('items[1][price]'),'price_addon');assert.equal(params.get('metadata[rankharbour_order_id]'),'order-1');
  assert.ok(matchesDirectSubscription(subscription,order));
});
test('direct sync rejects unconfirmed, foreign and altered subscriptions',()=>{
  assert.equal(matchesDirectSubscription(subscription,{...order,confirmed_at:null}),false);
  for(const change of [{customer:'cus_other'},{livemode:true},{metadata:{}},{items:{data:[]}}])assert.equal(matchesDirectSubscription({...subscription,...change},order),false);
  assert.equal(matchesDirectSubscription(subscription,{...order,subscription_id:'sub_other'}),false);
  assert.equal(matchesDirectSubscription(subscription,{...order,items:[{...order.items[0],amount:1},order.items[1]]}),false);
});
test('receipts require both an active subscription and a paid invoice',()=>{
  assert.equal(paymentReceipt(order,subscription).amountPaid,12800);
  const pending={...subscription,status:'incomplete',latest_invoice:{paid:false,payment_intent:{status:'requires_action'},hosted_invoice_url:'https://invoice.stripe.com/i/fixture'}};
  assert.equal(paymentReceipt(order,pending).status,'requires_action');assert.equal(paymentReceipt(order,pending).amountPaid,null);
  assert.equal(paymentReceipt(order,{...subscription,latest_invoice:{paid:false}}).status,'pending');
  assert.equal(paymentReceipt(order,{...pending,latest_invoice:{payment_intent:{status:'requires_payment_method'}}}).status,'payment_failed');
});
