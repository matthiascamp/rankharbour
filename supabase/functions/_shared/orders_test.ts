import {confirmOrder,ownedOrder,OrderError} from './orders.ts';
const assert=(value:unknown,message='Assertion failed')=>{if(!value)throw new Error(message);};
const id='11111111-1111-4111-8111-111111111111';
function fixture() {
  Deno.env.set('SUPABASE_URL','https://fixture.supabase.co');Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','fixture');Deno.env.set('STRIPE_SECRET_KEY','sk_test_fixture');
  const original=globalThis.fetch,calls:any[]=[];
  const order:any={id,user_id:'owner',livemode:false,kind:'seo',plan:'starter',backlinks:true,stripe_customer_id:'cus_owner',payment_method_id:null,amount:12800,state:'quoted',confirmed_at:null,subscription_id:null,expires_at:new Date(Date.now()+600000).toISOString(),items:[{plan:'starter',name:'Starter',priceId:'price_base',amount:9900},{plan:'backlinks',name:'Backlinks',priceId:'price_addon',amount:2900}]};
  let failSync=true,createCount=0;
  const subscription={id:'sub_owned',customer:'cus_owner',livemode:false,status:'active',metadata:{rankharbour_order_id:id},items:{data:order.items.map((i:any)=>({quantity:1,price:{id:i.priceId,unit_amount:i.amount,currency:'aud',recurring:{interval:'day',interval_count:28}}}))},latest_invoice:{paid:true,amount_paid:12800},current_period_end:1800000000,cancel_at_period_end:false};
  globalThis.fetch=async(input:any,options:any={})=>{
    const url=new URL(String(input)),body=String(options.body||''),method=options.method||'GET';calls.push({url,body,method,headers:options.headers});
    if(url.hostname==='fixture.supabase.co') {
      if(url.pathname.endsWith('/billing_orders'))return Response.json((!url.searchParams.has('user_id')||url.searchParams.get('user_id')==='eq.owner')?order:null);
      if(url.pathname.endsWith('/claim_billing_order')){Object.assign(order,{confirmed_at:new Date().toISOString(),state:'processing',payment_method_id:JSON.parse(body).card_id});return Response.json(order);}
      if(url.pathname.endsWith('/billing_checkout_intents'))return Response.json([]);
      if(url.pathname.endsWith('/sync_direct_subscription')){
        if(failSync){failSync=false;return Response.json({message:'simulated database outage'},{status:500});}
        Object.assign(order,{subscription_id:subscription.id,state:'complete'});return new Response(null,{status:204});
      }
    }
    if(url.pathname==='/v1/payment_methods/pm_foreign')return Response.json({type:'card',customer:'cus_attacker',livemode:false});
    if(url.pathname==='/v1/payment_methods/pm_owned')return Response.json({type:'card',customer:'cus_owner',livemode:false});
    if(url.pathname==='/v1/subscriptions' && method==='POST'){createCount++;return Response.json(subscription);}
    if(url.pathname==='/v1/subscriptions/sub_owned')return Response.json(subscription);
    throw new Error('Unexpected request: '+url.pathname);
  };
  return {order,calls,get createCount(){return createCount;},restore(){globalThis.fetch=original;}};
}
Deno.test('direct order ownership and foreign cards are rejected before subscription creation',async()=>{
  const f=fixture();try {
    for(const action of [()=>ownedOrder(id,'attacker'),()=>confirmOrder({id:'owner'},id,'pm_foreign',[],null)]){
      let rejected=false;try{await action();}catch(e){rejected=e instanceof OrderError;}assert(rejected);
    }
    assert(f.createCount===0);assert(f.order.confirmed_at===null);
  }finally{f.restore();}
});
Deno.test('a database failure after Stripe creates a subscription retries with identical card and idempotency key',async()=>{
  const f=fixture();try {
    let failed=false;try{await confirmOrder({id:'owner'},id,'pm_owned',[],null);}catch{failed=true;}assert(failed);assert(f.order.confirmed_at);
    const result=await confirmOrder({id:'owner'},id,'pm_foreign',[],null);assert(result.receipt.status==='paid');
    const creates=f.calls.filter(c=>c.url.pathname==='/v1/subscriptions'&&c.method==='POST');assert(creates.length===2);
    assert(creates[0].body===creates[1].body);assert(creates[0].headers['Idempotency-Key']===creates[1].headers['Idempotency-Key']);
    assert(new URLSearchParams(creates[1].body).get('default_payment_method')==='pm_owned');
    await confirmOrder({id:'owner'},id,'pm_foreign',[],null);assert(f.createCount===2,'Bound retries must retrieve, never create');
  }finally{f.restore();}
});
