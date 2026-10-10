// Pure builders/guards shared by the Edge Functions and Stripe sandbox checks.
export function accountUrl(origin:string, result:string) {
  const url=new URL('account.html',origin);
  if(url.protocol!=='https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('Invalid app origin');
  url.searchParams.set('tab','account');url.searchParams.set('billing',result);
  return url.href;
}
export function setupParams(customer:string,userId:string,origin:string) {
  return new URLSearchParams({mode:'setup',customer,'payment_method_types[0]':'card',
    'client_reference_id':userId,'setup_intent_data[metadata][rankharbour_user_id]':userId,
    'setup_intent_data[metadata][purpose]':'save_card',
    'custom_text[submit][message]':'Save this card to your RankHarbour account for future plan purchases and recurring subscription payments. No payment is taken now.',
    success_url:accountUrl(origin,'card-saved'),cancel_url:accountUrl(origin,'cancelled')});
}
export function subscriptionParams(customer:string,intent:any,origin:string) {
  return new URLSearchParams({mode:'subscription',customer,'client_reference_id':intent.id,
    'line_items[0][price]':intent.price_id,'line_items[0][quantity]':'1',
    'payment_method_types[0]':'card',
    'saved_payment_method_options[allow_redisplay_filters][0]':'always',
    'saved_payment_method_options[allow_redisplay_filters][1]':'limited',
    'saved_payment_method_options[allow_redisplay_filters][2]':'unspecified',
    'subscription_data[metadata][rankharbour_checkout_intent]':intent.id,
    success_url:accountUrl(origin,'subscribed'),cancel_url:accountUrl(origin,'cancelled'),
    expires_at:String(Math.floor(new Date(intent.expires_at).getTime()/1000))});
}
export function matchesCheckout(session:any,intent:any,subscriptionId:string) {
  if(!intent || session.mode!=='subscription' || session.client_reference_id!==intent.id ||
    session.subscription!==subscriptionId || session.livemode!==intent.livemode) return false;
  if(intent.payment_link_id) return session.payment_link===intent.payment_link_id;
  return session.id===intent.checkout_session_id && session.customer===intent.stripe_customer_id;
}
export function cardSummary(method:any) {
  if(method.type!=='card' || !method.card) return null;
  return {brand:method.card.brand,last4:method.card.last4,expMonth:method.card.exp_month,expYear:method.card.exp_year};
}
