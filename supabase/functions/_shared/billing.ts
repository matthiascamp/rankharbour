import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
export const PLANS: Record<string,{name:string;amount:number;url:string}> = {
  starter:{name:'Starter',amount:9900,url:'https://buy.stripe.com/7sYbJ07Yd8Hy0wKcprasg01'},
  growth:{name:'Growth',amount:14900,url:'https://buy.stripe.com/6oU5kC7Yd6zq1AO3SVasg02'},
  pro:{name:'Pro',amount:24900,url:'https://buy.stripe.com/bJe8wOguJcXOa7k4WZasg03'},
  enterprise:{name:'Enterprise',amount:49900,url:'https://buy.stripe.com/4gMcN4a6l5vmfrE2ORasg04'},
  'enterprise-plus':{name:'Enterprise Plus',amount:79900,url:'https://buy.stripe.com/5kQ7sKbap3ne4N04WZasg00'},
};
export const db = () => createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
export async function stripe(path:string, body?:URLSearchParams) {
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:body?'POST':'GET',signal:AbortSignal.timeout(12000),headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')?.trim()}`,'Stripe-Version':'2025-02-24.acacia',...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body});
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
      return link;
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
    if(!session?.client_reference_id || !session.payment_link || session.mode!=='subscription') return;
    if(!/^[0-9a-f-]{36}$/i.test(session.client_reference_id)) return;
    const found=await client.from('billing_checkout_intents').select('*').eq('id',session.client_reference_id).maybeSingle();
    if(found.error) throw found.error;
    intent=found.data;
    if(!intent || intent.payment_link_id!==session.payment_link || session.subscription!==id || !session.livemode) return;
  }
  const observed_at=new Date().toISOString();
  const sub=await stripe('subscriptions/'+encodeURIComponent(id));
  const item=sub.items?.data?.[0];
  if(!sub.livemode || sub.items.data.length!==1 || item.quantity!==1 || !validPrice(item.price,intent.plan)) throw new Error('Subscription plan mismatch');
  const end=sub.current_period_end || item.current_period_end;
  const result=await client.rpc('sync_billing_subscription',{intent_id:intent.id,snapshot:{id:sub.id,customer:sub.customer,status:sub.status,amount:item.price.unit_amount,currency:item.price.currency,period_end:end?new Date(end*1000).toISOString():null,cancel_at_period_end:sub.cancel_at_period_end,observed_at}});
  if(result.error) throw result.error;
}
