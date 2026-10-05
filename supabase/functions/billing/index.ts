import {db,PLANS,findLink,stripe} from '../_shared/billing.ts';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response(null,{headers:cors});
  if(req.method!=='POST') return reply({error:'Method not allowed'},405);
  const bearer=req.headers.get('Authorization')?.replace(/^Bearer /i,'');
  if(!bearer) return reply({error:'Sign in to manage your subscription.'},401);
  const client=db();
  const {data:{user},error:authError}=await client.auth.getUser(bearer);
  if(authError||!user) return reply({error:'Your session has expired. Please sign in again.'},401);
  try {
    const input=await req.json();
    const {data:subs,error}=await client.from('billing_subscriptions').select('stripe_subscription_id,stripe_customer_id,plan,status,amount,currency,current_period_end,cancel_at_period_end,updated_at').eq('user_id',user.id).order('updated_at',{ascending:false});
    if(error) throw error;
    const {data:preview,error:previewError}=await client.from('account_plan_previews').select('plan,website').eq('user_id',user.id).maybeSingle();
    if(previewError) throw previewError;
    if(input.action==='status') return reply({subscriptions:subs.map(({stripe_customer_id,...s})=>s),preview:preview?{...preview,amount:PLANS[preview.plan].amount}:null});
    if(input.action==='checkout') {
      if(preview) return reply({error:'Your account has a complimentary plan preview. Paid checkout is disabled while this preview is enabled.'},409);
      if(!Object.hasOwn(PLANS,input.plan)) return reply({error:'Choose one of the available plans.'},400);
      if(subs.some(s=>!['canceled','incomplete_expired'].includes(s.status))) return reply({error:'You already have a subscription. Manage it before starting another plan.'},409);
      const since=new Date(Date.now()-60000).toISOString();
      const {count,error:rateError}=await client.from('billing_checkout_intents').select('id',{count:'exact',head:true}).eq('user_id',user.id).gte('created_at',since);
      if(rateError) throw rateError;
      if((count||0)>=5) return reply({error:'Please wait a minute before opening checkout again.'},429);
      if(!Deno.env.get('STRIPE_WEBHOOK_SECRET')) return reply({error:'Checkout is being connected. Please try again shortly or contact RankHarbour.'},503);
      const link=await findLink(input.plan);
      const {data:intent,error:insertError}=await client.from('billing_checkout_intents').insert({user_id:user.id,plan:input.plan,payment_link_id:link.id}).select('id').single();
      if(insertError) throw insertError;
      const url=new URL(link.url);url.searchParams.set('client_reference_id',intent.id);
      if(user.email) url.searchParams.set('prefilled_email',user.email);
      return reply({url:url.href});
    }
    if(input.action==='portal') {
      // Customer ownership is read from trusted records, never from browser input.
      const sub=subs.find(s=>s.stripe_subscription_id===input.subscriptionId);
      if(!sub) return reply({error:'No subscription found for this account.'},404);
      const configuration=Deno.env.get('STRIPE_PORTAL_CONFIGURATION_ID');
      if(!configuration) throw new Error('Portal not configured');
      const session=await stripe('billing_portal/sessions',new URLSearchParams({customer:sub.stripe_customer_id,configuration}));
      return reply({url:session.url});
    }
    return reply({error:'Unknown billing action.'},400);
  } catch(e) {
    console.error('Billing operation failed',e instanceof Error?e.message:'unknown');
    return reply({error:'Billing is temporarily unavailable. Please try again shortly or contact RankHarbour.'},503);
  }
});
