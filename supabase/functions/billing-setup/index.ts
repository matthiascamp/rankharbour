// Temporary service-role-only provisioning helper. Remove deployed function after setup.
const urls = ['https://buy.stripe.com/7sYbJ07Yd8Hy0wKcprasg01','https://buy.stripe.com/6oU5kC7Yd6zq1AO3SVasg02','https://buy.stripe.com/bJe8wOguJcXOa7k4WZasg03','https://buy.stripe.com/4gMcN4a6l5vmfrE2ORasg04','https://buy.stripe.com/5kQ7sKbap3ne4N04WZasg00'];
async function stripe(path: string, body?: URLSearchParams) {
  const r = await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')?.trim()}`,'Stripe-Version':'2025-02-24.acacia',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body});
  const j=await r.json(); if(!r.ok) throw new Error(`Stripe ${r.status}: ${j.error?.code || j.error?.type}`); return j;
}
Deno.serve(async req=>{
  if(req.headers.get('Authorization')!==`Bearer ${Deno.env.get('BILLING_SETUP_TOKEN')}`) return new Response('Unauthorized',{status:401});
  try {
    const input=await req.json();
    if(input.action==='inspect') {
      let cursor='', found:any[]=[];
      for(let page=0;page<20;page++) {
        const links=await stripe('payment_links?limit=100'+(cursor?'&starting_after='+cursor:''));
        found.push(...links.data.filter((l:any)=>urls.includes(l.url)));
        if(!links.has_more||found.length===5) break; cursor=links.data.at(-1).id;
      }
      const result=[];
      for(const l of found) {const lines=await stripe(`payment_links/${l.id}/line_items`);result.push({id:l.id,url:l.url,active:l.active,livemode:l.livemode,lines:lines.data.map((x:any)=>({quantity:x.quantity,price:x.price}))});}
      return Response.json({links:result,keyMode:Deno.env.get('STRIPE_SECRET_KEY')?.includes('_test_')?'test':'live'});
    }
    if(input.action==='webhook') {
      const body=new URLSearchParams({url:Deno.env.get('SUPABASE_URL')+'/functions/v1/stripe-webhook',description:'RankHarbour account subscriptions',api_version:'2025-02-24.acacia'});
      ['checkout.session.completed','checkout.session.async_payment_succeeded','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','invoice.paid','invoice.payment_failed'].forEach((e,i)=>body.set(`enabled_events[${i}]`,e));
      const endpoint=await stripe('webhook_endpoints',body);
      return Response.json({id:endpoint.id,secret:endpoint.secret});
    }
    return new Response('Unknown action',{status:400});
  } catch(e) {return Response.json({error:e.message},{status:502});}
});
