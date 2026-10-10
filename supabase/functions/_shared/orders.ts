import {db,stripe,stripeLiveMode,PLANS,checkoutError,isAddon,syncSubscription} from './billing.ts';
import {customerFor,priceFor,savedCards} from './customers.ts';
import {directSubscriptionParams,matchesDirectSubscription,orderSummary,paymentReceipt} from './order-shapes.ts';
export class OrderError extends Error {constructor(message:string,public status=400){super(message);}}
const NAMES:Record<string,string>={starter:'Starter',growth:'Growth',pro:'Pro',enterprise:'Enterprise','enterprise-plus':'Enterprise Plus',backlinks:'Backlinks'};
export async function ownedOrder(id:string,userId:string) {
  if(!/^[a-f0-9-]{36}$/i.test(id || '')) throw new OrderError('Choose a plan to review first.');
  const {data,error}=await db().from('billing_orders').select('*').eq('id',id).eq('user_id',userId).eq('livemode',stripeLiveMode()).maybeSingle();
  if(error) throw error;if(!data) throw new OrderError('Subscription confirmation not found.',404);return data;
}
export async function pendingOrder(userId:string) {
  const {data,error}=await db().from('billing_orders').select('id').eq('user_id',userId).eq('livemode',stripeLiveMode()).in('state',['processing','pending']).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw error;return data?.id || null;
}
export async function quoteOrder(user:any,subs:any[],preview:any,plan:string,backlinks:boolean) {
  if(!Object.hasOwn(NAMES,plan) || typeof backlinks!=='boolean' || (isAddon(plan) && backlinks)) throw new OrderError('Choose an available plan and optional backlinks.');
  const blocked=checkoutError(plan,subs,preview);if(blocked) throw new OrderError(blocked,409);
  if(backlinks && subs.some(s=>(s.plan==='backlinks'||s.addons?.includes('backlinks'))&&!['canceled','incomplete_expired'].includes(s.status))) throw new OrderError('You already have Backlinks.',409);
  const pending=await pendingOrder(user.id);if(pending) throw new OrderError('You have a pending subscription. Resume or cancel it before starting another.',409);
  const customer=await customerFor(user,subs,true);
  const plans=backlinks?[plan,'backlinks']:[plan];
  const items=await Promise.all(plans.map(async p=>({plan:p,name:NAMES[p],amount:PLANS[p].amount,priceId:await priceFor(p)})));
  const amount=items.reduce((sum,item)=>sum+item.amount,0);
  const {data:order,error}=await db().from('billing_orders').insert({user_id:user.id,livemode:stripeLiveMode(),kind:plan==='backlinks'?'backlinks':'seo',plan,backlinks,stripe_customer_id:customer,items,amount}).select('*').single();
  if(error) throw error;
  return {quote:orderSummary(order),cards:await savedCards(customer)};
}
export async function syncDirectSubscription(sub:any) {
  const id=sub.metadata?.rankharbour_order_id;
  if(!id || sub.livemode!==stripeLiveMode()) return;
  const {data:order,error}=await db().from('billing_orders').select('*').eq('id',id).eq('livemode',sub.livemode).maybeSingle();
  if(error) throw error;
  if(!matchesDirectSubscription(sub,order)) throw new Error('Direct subscription validation failed');
  const end=sub.current_period_end || sub.items.data[0]?.current_period_end;
  const result=await db().rpc('sync_direct_subscription',{order_id:id,snapshot:{id:sub.id,customer:sub.customer,
    livemode:sub.livemode,status:sub.status,period_end:end?new Date(end*1000).toISOString():null,
    cancel_at_period_end:sub.cancel_at_period_end,observed_at:new Date().toISOString()}});
  if(result.error) throw result.error;
  if(sub.livemode && !isAddon(order.plan) && sub.status==='active'){
    const cleared=await db().from('account_plan_previews').delete().eq('user_id',order.user_id);if(cleared.error)throw cleared.error;
  }
}
export async function syncAnySubscription(id:string,checkout?:any) {
  const sub=await stripe('subscriptions/'+encodeURIComponent(id));
  if(sub.metadata?.rankharbour_order_id) await syncDirectSubscription(sub);
  else await syncSubscription(id,checkout);
}
export async function confirmOrder(user:any,orderId:string,cardId:string,subs:any[],preview:any) {
  let order=await ownedOrder(orderId,user.id);
  if(order.state==='closed') throw new OrderError('This subscription attempt is closed. Review a new plan.',409);
  if(!order.confirmed_at) {
    const blocked=checkoutError(order.plan,subs,preview);if(blocked) throw new OrderError(blocked,409);
    if(new Date(order.expires_at).getTime()<Date.now()) throw new OrderError('Your confirmation has expired. Review the plan again.',409);
    if(!/^pm_[A-Za-z0-9]+$/.test(cardId || '')) throw new OrderError('Select a saved card.');
    const method=await stripe('payment_methods/'+encodeURIComponent(cardId));
    if(method.type!=='card' || method.customer!==order.stripe_customer_id || method.livemode!==order.livemode) throw new OrderError('That card does not belong to your account.',403);
    const claimed=await db().rpc('claim_billing_order',{order_id:order.id,owner_id:user.id,mode:order.livemode,card_id:cardId});
    if(claimed.error) throw new OrderError('Another subscription is pending or this confirmation expired. Refresh your account before continuing.',409);
    order=claimed.data;
  }
  if(!order.subscription_id) {
    // Expire older hosted sessions so they cannot be paid after this purchase.
    const old=await db().from('billing_checkout_intents').select('id,checkout_session_id').eq('user_id',user.id).eq('livemode',order.livemode).is('closed_at',null).not('checkout_session_id','is',null);
    if(old.error) throw old.error;
    for(const intent of old.data){
      const session=await stripe('checkout/sessions/'+intent.checkout_session_id);
      if(session.status==='complete') {
        if(session.subscription) await syncAnySubscription(session.subscription,session);
        const closed=await db().from('billing_orders').update({state:'closed'}).eq('id',order.id);if(closed.error)throw closed.error;
        throw new OrderError('An earlier checkout completed. Refresh subscription status.',409);
      }
      if(session.status==='open') await stripe(`checkout/sessions/${session.id}/expire`,new URLSearchParams());
      const closed=await db().from('billing_checkout_intents').update({closed_at:new Date().toISOString()}).eq('id',intent.id);if(closed.error)throw closed.error;
    }
  }
  // Stripe retains idempotency keys for at least 24 hours. Never recreate an
  // unresolved attempt after that window; recover its existing subscription.
  if(!order.subscription_id && Date.now()-new Date(order.confirmed_at).getTime()>23*60*60*1000) {
    let cursor='',found=null;
    for(let page=0;page<20;page++) {
      const list=await stripe(`subscriptions?customer=${encodeURIComponent(order.stripe_customer_id)}&status=all&limit=100${cursor?'&starting_after='+cursor:''}`);
      found=list.data.find((s:any)=>s.metadata?.rankharbour_order_id===order.id);
      if(found||!list.has_more)break;cursor=list.data.at(-1).id;
    }
    if(!found)throw new OrderError('This payment needs a status check by RankHarbour. Contact us before trying another subscription.',409);
    await syncDirectSubscription(found);order=await ownedOrder(orderId,user.id);
  }
  const sub=order.subscription_id
    ? await stripe(`subscriptions/${order.subscription_id}?expand%5B%5D=latest_invoice.payment_intent`)
    : await stripe('subscriptions',directSubscriptionParams(order),`rankharbour-order-${order.id}`);
  await syncDirectSubscription(sub);
  return {receipt:paymentReceipt(order,sub)};
}
export async function orderStatus(user:any,id:string) {
  const order=await ownedOrder(id,user.id);
  if(!order.confirmed_at) return {quote:orderSummary(order),cards:await savedCards(order.stripe_customer_id)};
  return confirmOrder(user,id,order.payment_method_id,[],null);
}
export async function cancelPendingOrder(user:any,id:string) {
  const order=await ownedOrder(id,user.id);
  if(!order.subscription_id) throw new OrderError('Payment status is still being checked. Resume this confirmation before canceling.',409);
  const sub=await stripe('subscriptions/'+order.subscription_id);
  if(!matchesDirectSubscription(sub,order) || sub.status!=='incomplete') throw new OrderError('This subscription cannot be canceled here. Manage active subscriptions in Account centre.',409);
  const response=await fetch('https://api.stripe.com/v1/subscriptions/'+sub.id,{method:'DELETE',headers:{Authorization:`Bearer ${Deno.env.get('STRIPE_SECRET_KEY')?.trim()}`,'Stripe-Version':'2025-02-24.acacia'},signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw new Error('Could not cancel pending subscription');
  await syncDirectSubscription(await response.json());return {canceled:true};
}
