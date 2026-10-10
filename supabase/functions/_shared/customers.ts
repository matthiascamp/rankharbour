import {db,stripe,stripeLiveMode,findLink,validPrice} from './billing.ts';
import {cardSummary,setupParams,subscriptionParams} from './checkout.ts';
const origin=()=>Deno.env.get('APP_URL') || 'https://rankharbour.com.au';

export async function customerFor(user:any,subs:any[],create=false) {
  const client=db(),livemode=stripeLiveMode();
  const {data:existing,error}=await client.from('billing_customers').select('stripe_customer_id').eq('user_id',user.id).eq('livemode',livemode).maybeSingle();
  if(error) throw error;
  if(existing) return existing.stripe_customer_id;
  // Existing subscriptions are trusted webhook records; email is never used to
  // discover ownership of somebody else's Stripe customer.
  let id=subs.find(s=>s.livemode===livemode)?.stripe_customer_id;
  if(!id && !create) return null;
  if(!id) {
    const customer=await stripe('customers',new URLSearchParams({email:user.email || '',
      'metadata[rankharbour_user_id]':user.id}),`rankharbour-customer-${livemode}-${user.id}`);
    if(customer.livemode!==livemode) throw new Error('Customer mode mismatch');
    id=customer.id;
  }
  const {error:insertError}=await client.from('billing_customers').insert({user_id:user.id,livemode,stripe_customer_id:id});
  if(insertError && insertError.code!=='23505') throw insertError;
  const {data:bound,error:readError}=await client.from('billing_customers').select('stripe_customer_id').eq('user_id',user.id).eq('livemode',livemode).single();
  if(readError) throw readError;
  return bound.stripe_customer_id;
}
export async function savedCards(customer:string|null) {
  if(!customer) return [];
  const methods=await stripe(`customers/${encodeURIComponent(customer)}/payment_methods?type=card&limit=100`);
  return methods.data.filter((method:any)=>cardSummary(method)).map((method:any)=>({id:method.id,...cardSummary(method)}));
}
export async function createSetup(customer:string,userId:string) {
  return stripe('checkout/sessions',setupParams(customer,userId,origin()));
}
export async function syncSavedCard(session:any) {
  if(session.mode!=='setup' || session.status!=='complete' || session.livemode!==stripeLiveMode() || !session.setup_intent || !session.customer) return;
  const client=db();
  const {data:owner,error}=await client.from('billing_customers').select('user_id').eq('stripe_customer_id',session.customer).eq('livemode',session.livemode).maybeSingle();
  if(error) throw error;
  if(!owner || session.client_reference_id!==owner.user_id) return;
  const setup=await stripe(`setup_intents/${encodeURIComponent(session.setup_intent)}`);
  if(setup.status!=='succeeded' || setup.customer!==session.customer || setup.metadata.rankharbour_user_id!==owner.user_id || setup.metadata.purpose!=='save_card') return;
  const method=await stripe(`payment_methods/${encodeURIComponent(setup.payment_method)}`);
  if(method.customer!==session.customer || method.type!=='card') return;
  // The setup page explicitly asks permission to save and reuse the card.
  await stripe(`payment_methods/${method.id}`,new URLSearchParams({allow_redisplay:'always'}));
  const customer=await stripe(`customers/${session.customer}`);
  if(!customer.invoice_settings?.default_payment_method) {
    await stripe(`customers/${session.customer}`,new URLSearchParams({'invoice_settings[default_payment_method]':method.id}));
  }
}
export async function priceFor(plan:string) {
  if(stripeLiveMode()) return (await findLink(plan)).price.id;
  const lookup=`rankharbour_${plan}_28d`;
  const prices=await stripe('prices?active=true&lookup_keys%5B%5D='+encodeURIComponent(lookup));
  const price=prices.data.find((p:any)=>!p.livemode && validPrice(p,plan));
  if(!price) throw new Error('Test price not configured');
  return price.id;
}
export async function subscriptionCheckout(user:any,customer:string,plan:string) {
  const client=db(),livemode=stripeLiveMode();
  const readOpen=()=>client.from('billing_checkout_intents').select('*').eq('user_id',user.id).eq('plan',plan).eq('livemode',livemode).is('payment_link_id',null).is('closed_at',null).maybeSingle();
  let {data:intent,error}=await readOpen();if(error) throw error;
  if(intent?.checkout_session_id) {
    const existing=await stripe(`checkout/sessions/${intent.checkout_session_id}`);
    if(existing.status==='open') return existing;
    if(existing.status==='complete') throw new Error('Checkout already completed; refresh subscription status.');
    if(existing.status==='expired') {
      const closed=await client.from('billing_checkout_intents').update({closed_at:new Date().toISOString()}).eq('id',intent.id);
      if(closed.error) throw closed.error;intent=null;
    }
  }
  if(intent && new Date(intent.expires_at).getTime()<Date.now()) {
    const closed=await client.from('billing_checkout_intents').update({closed_at:new Date().toISOString()}).eq('id',intent.id);
    if(closed.error) throw closed.error;intent=null;
  }
  if(!intent) {
    const price_id=await priceFor(plan);
    const inserted=await client.from('billing_checkout_intents').insert({user_id:user.id,plan,livemode,stripe_customer_id:customer,price_id,expires_at:new Date(Date.now()+35*60000).toISOString()}).select('*').single();
    if(inserted.error && inserted.error.code!=='23505') throw inserted.error;
    if(inserted.error){const current=await readOpen();if(current.error)throw current.error;intent=current.data;}
    else intent=inserted.data;
  }
  if(!intent || intent.stripe_customer_id!==customer) throw new Error('Checkout customer mismatch');
  const session=await stripe('checkout/sessions',subscriptionParams(customer,intent,origin()),`rankharbour-checkout-${intent.id}`);
  const saved=await client.from('billing_checkout_intents').update({checkout_session_id:session.id}).eq('id',intent.id);
  if(saved.error) throw saved.error;
  return session;
}
