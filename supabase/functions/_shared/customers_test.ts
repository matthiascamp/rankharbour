import {customerFor,syncSavedCard,subscriptionCheckout} from './customers.ts';
const assert=(condition:unknown,message='Assertion failed')=>{if(!condition)throw new Error(message);};
const originalFetch=globalThis.fetch;
function fixture() {
  Deno.env.set('SUPABASE_URL','https://fixture.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY','fixture-service-key');
  Deno.env.set('STRIPE_SECRET_KEY','sk_test_fixture');
  const customers:any[]=[],intents:any[]=[],calls:any[]=[];
  globalThis.fetch=async(input:any,options:any={})=>{
    const url=new URL(String(input)),method=options.method || 'GET';
    const body=options.body ? String(options.body) : '';
    calls.push({url,method,body,headers:options.headers});
    if(url.hostname==='fixture.supabase.co') {
      const table=url.pathname.split('/').at(-1), rows=table==='billing_customers'?customers:intents;
      const matches=(row:any)=>[...url.searchParams].every(([k,v])=>{
        if(v.startsWith('eq.'))return String(row[k])===v.slice(3);
        if(v==='is.null')return row[k]==null;return true;
      });
      if(method==='POST'){
        const row=JSON.parse(body);row.id ||= 'fixture-intent';rows.push(row);
        return options.headers.get('Prefer')?.includes('return=representation')?Response.json(row):new Response(null,{status:201});
      }
      if(method==='PATCH'){rows.filter(matches).forEach(row=>Object.assign(row,JSON.parse(body)));return new Response(null,{status:204});}
      const found=rows.filter(matches);
      return Response.json(options.headers.get('Accept')?.includes('vnd.pgrst.object')?found[0]:found);
    }
    const path=url.pathname;
    if(path==='/v1/customers' && method==='POST') return Response.json({id:'cus_created',livemode:false});
    if(path==='/v1/setup_intents/seti_owned')return Response.json({status:'succeeded',customer:'cus_created',payment_method:'pm_owned',metadata:{rankharbour_user_id:'owner',purpose:'save_card'}});
    if(path==='/v1/payment_methods/pm_owned')return Response.json({id:'pm_owned',type:'card',customer:'cus_created'});
    if(path==='/v1/customers/cus_created')return Response.json({invoice_settings:{}});
    if(path==='/v1/prices')return Response.json({data:[{id:'price_test',livemode:false,currency:'aud',unit_amount:9900,recurring:{interval:'day',interval_count:28}}]});
    if(path==='/v1/checkout/sessions')return Response.json({id:'cs_checkout',url:'https://checkout.stripe.com/c/test',status:'open'});
    if(path==='/v1/checkout/sessions/cs_checkout')return Response.json({id:'cs_checkout',url:'https://checkout.stripe.com/c/test',status:'open'});
    throw new Error('Unexpected fixture request: '+path);
  };
  return {customers,intents,calls,restore(){globalThis.fetch=originalFetch;}};
}
Deno.test('customers are bound by account and mode, never by matching email',async()=>{
  const f=fixture();try {
    f.customers.push({user_id:'other',livemode:false,stripe_customer_id:'cus_other'});
    f.customers.push({user_id:'owner',livemode:true,stripe_customer_id:'cus_live'});
    const id=await customerFor({id:'owner',email:'same@example.com'},[],true);
    assert(id==='cus_created');assert(f.customers.length===3);
    assert(await customerFor({id:'owner'},[],false)==='cus_created');
    assert(f.calls.filter(c=>c.url.pathname==='/v1/customers').length===1);
    assert(!f.calls.some(c=>c.url.searchParams.has('email')));
  }finally{f.restore();}
});
Deno.test('an account without saved cards does not create a customer on status',async()=>{
  const f=fixture();try{assert(await customerFor({id:'owner'},[],false)===null);assert(!f.calls.some(c=>c.url.hostname==='api.stripe.com'));}finally{f.restore();}
});
Deno.test('setup webhook ignores mismatched owners and mode before touching Stripe',async()=>{
  const f=fixture();try {
    f.customers.push({user_id:'owner',livemode:false,stripe_customer_id:'cus_created'});
    const session={mode:'setup',status:'complete',livemode:false,customer:'cus_created',setup_intent:'seti_owned',client_reference_id:'attacker'};
    await syncSavedCard(session);await syncSavedCard({...session,client_reference_id:'owner',livemode:true});
    assert(!f.calls.some(c=>c.url.hostname==='api.stripe.com'));
  }finally{f.restore();}
});
Deno.test('verified setup enables reuse and sets a default card without making a charge',async()=>{
  const f=fixture();try {
    f.customers.push({user_id:'owner',livemode:false,stripe_customer_id:'cus_created'});
    await syncSavedCard({mode:'setup',status:'complete',livemode:false,customer:'cus_created',setup_intent:'seti_owned',client_reference_id:'owner'});
    const writes=f.calls.filter(c=>c.url.hostname==='api.stripe.com' && c.method==='POST');
    assert(writes.length===2);assert(writes[0].body==='allow_redisplay=always');assert(writes[1].body.includes('pm_owned'));
    assert(!f.calls.some(c=>/payment_intents|charges|subscriptions/.test(c.url.pathname)));
  }finally{f.restore();}
});
Deno.test('reopening checkout returns one owned session rather than creating another subscription',async()=>{
  const f=fixture();try {
    const first=await subscriptionCheckout({id:'owner'},'cus_created','starter');
    const second=await subscriptionCheckout({id:'owner'},'cus_created','starter');
    assert(first.id===second.id);assert(f.intents.length===1);
    const created=f.calls.filter(c=>c.url.pathname==='/v1/checkout/sessions' && c.method==='POST');
    assert(created.length===1);assert(created[0].headers['Idempotency-Key']==='rankharbour-checkout-fixture-intent');
    const params=new URLSearchParams(created[0].body);assert(params.get('customer')==='cus_created');assert(params.get('line_items[0][price]')==='price_test');
  }finally{f.restore();}
});
