import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import {matchesCheckout} from './checkout.ts';
export const PLANS: Record<string,{name:string;amount:number;url:string}> = {
  starter:{name:'Starter',amount:9900,url:'https://buy.stripe.com/7sYbJ07Yd8Hy0wKcprasg01'},
  growth:{name:'Growth',amount:14900,url:'https://buy.stripe.com/6oU5kC7Yd6zq1AO3SVasg02'},
  pro:{name:'Pro',amount:24900,url:'https://buy.stripe.com/bJe8wOguJcXOa7k4WZasg03'},
  enterprise:{name:'Enterprise',amount:49900,url:'https://buy.stripe.com/4gMcN4a6l5vmfrE2ORasg04'},
  'enterprise-plus':{name:'Enterprise Plus',amount:79900,url:'https://buy.stripe.com/5kQ7sKbap3ne4N04WZasg00'},
  backlinks:{name:'Backlinks',amount:2900,url:'https://buy.stripe.com/3cIdR85Q58Hya7k0GJasg06'},
  'google-business-posts':{name:'Google Business Posts',amount:2900,url:'https://buy.stripe.com/aFacN47YdcXOenA757asg05'},
};
export const ADDON_PLAN='backlinks';
// Keep historical records manageable without selling the retired add-on.
export const isAddon=(plan:string)=>plan===ADDON_PLAN||plan==='google-business-posts';
export function checkoutError(plan:string,subs:Array<{plan:string;status:string;addons?:string[]}>,preview:unknown) {
  if(plan==='google-business-posts') return 'This add-on is no longer available. Choose Backlinks instead.';
  const current=subs.filter(s=>!['canceled','incomplete_expired'].includes(s.status));
  if(plan===ADDON_PLAN) {
    if(current.some(s=>s.plan===ADDON_PLAN||s.addons?.includes(ADDON_PLAN))) return 'You already have Backlinks. Manage it in Account centre.';
    if(!preview && !current.some(s=>!isAddon(s.plan) && ['active','trialing'].includes(s.status))) return 'An active SEO plan is required before adding Backlinks.';
  } else if(current.some(s=>!isAddon(s.plan))) return 'You already have an SEO subscription. Manage it before starting another plan.';
  return null;
}
export const db = () => createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
export const stripeLiveMode=()=>!/^(sk|rk)_test_/.test(Deno.env.get('STRIPE_SECRET_KEY')?.trim() || '');
export async function stripe(path:string, body?:URLSearchParams, idempotencyKey?:string) {
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')?.trim()}`,'Stripe-Version':'2025-02-24.acacia',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body});
  const result=await response.json();
  if(!response.ok) throw new Error('Stripe request failed: '+response.status);
  return result;
}
export function validPrice(price:any,plan:string) {
  const p=PLANS[plan]; return !!p && price.currency==='aud' && price.unit_amount===p.amount && price.recurring?.interval==='day' && price.recurring?.interval_count===28;
}
export async function findLink(plan:string) {
  let cursor='';
  for(let page=0;page<20;page++) {
    const list=await stripe('payment_links?limit=100'+(cursor?'&starting_after='+cursor:''));
    const link=list.data.find((l:any)=>l.url===PLANS[plan].url && l.active && l.livemode);
    if(link) {
      const items=await stripe(`payment_links/${link.id}/line_items`);
      if(items.data.length!==1 || items.data[0].quantity!==1 || !validPrice(items.data[0].price,plan)) throw new Error('Payment link price mismatch');
      return {...link,price:items.data[0].price};
    }
    if(!list.has_more) break; cursor=list.data.at(-1).id;
  }
  throw new Error('Payment link is unavailable in configured Stripe account');
}
export async function syncSubscription(id:string,checkout?:any) {
  const client=db();
  const {data:known,error}=await client.from('billing_checkout_intents').select('*').eq('subscription_id',id).maybeSingle();
  if(error) throw error;
  let intent=known;
  if(!intent) {
    const session=checkout || (await stripe('checkout/sessions?subscription='+encodeURIComponent(id)+'&limit=1')).data[0];
    if(!session?.client_reference_id || session.mode!=='subscription') return;
    if(!/^[0-9a-f-]{36}$/i.test(session.client_reference_id)) return;
    const found=await client.from('billing_checkout_intents').select('*').eq('id',session.client_reference_id).maybeSingle();
    if(found.error) throw found.error;
    intent=found.data;
    // A webhook can arrive between Checkout creation and persisting its ID.
    // Retry that delivery instead of acknowledging a session we cannot bind yet.
    if(intent && !intent.payment_link_id && !intent.checkout_session_id) throw new Error('Checkout session binding pending');
    if(!matchesCheckout(session,intent,id)) return;
  }
  const observed_at=new Date().toISOString();
  const sub=await stripe('subscriptions/'+encodeURIComponent(id));
  const item=sub.items?.data?.[0];
  if(sub.livemode!==stripeLiveMode() || sub.livemode!==intent.livemode || sub.items.data.length!==1 || item.quantity!==1 || !validPrice(item.price,intent.plan) || (intent.price_id && item.price.id!==intent.price_id) || (intent.stripe_customer_id && sub.customer!==intent.stripe_customer_id)) throw new Error('Subscription plan mismatch');
  const end=sub.current_period_end || item.current_period_end;
  const result=await client.rpc('sync_billing_subscription',{intent_id:intent.id,snapshot:{id:sub.id,customer:sub.customer,status:sub.status,amount:item.price.unit_amount,currency:item.price.currency,period_end:end?new Date(end*1000).toISOString():null,cancel_at_period_end:sub.cancel_at_period_end,observed_at,livemode:sub.livemode}});
  if(result.error) throw result.error;
  if(sub.livemode && !isAddon(intent.plan) && ['active','trialing'].includes(sub.status)) {
    const cleared=await client.from('account_plan_previews').delete().eq('user_id',intent.user_id);
    if(cleared.error) throw cleared.error;
  }
}
