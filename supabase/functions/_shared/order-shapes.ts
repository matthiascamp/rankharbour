export function directSubscriptionParams(order:any) {
  const params=new URLSearchParams({customer:order.stripe_customer_id,
    default_payment_method:order.payment_method_id,collection_method:'charge_automatically',
    payment_behavior:'allow_incomplete','payment_settings[save_default_payment_method]':'on_subscription',
    'payment_settings[payment_method_types][0]':'card','metadata[rankharbour_order_id]':order.id,
    'expand[0]':'latest_invoice.payment_intent',discounts:''});
  order.items.forEach((item:any,index:number)=>{
    params.set(`items[${index}][price]`,item.priceId);params.set(`items[${index}][quantity]`,'1');
  });
  return params;
}
export function matchesDirectSubscription(sub:any,order:any) {
  if(!order?.confirmed_at || sub.metadata?.rankharbour_order_id!==order.id ||
    sub.customer!==order.stripe_customer_id || sub.livemode!==order.livemode ||
    (order.subscription_id && order.subscription_id!==sub.id) ||
    sub.items?.data?.length!==order.items.length) return false;
  return order.items.every((expected:any)=>{
    const item=sub.items.data.find((i:any)=>i.price.id===expected.priceId);
    return item?.quantity===1 && item.price.unit_amount===expected.amount && item.price.currency==='aud' &&
      item.price.recurring?.interval==='day' && item.price.recurring?.interval_count===28;
  });
}
export function orderSummary(order:any) {
  return {id:order.id,plan:order.plan,backlinks:order.backlinks,amount:order.amount,currency:'aud',
    items:order.items.map((item:any)=>({plan:item.plan,name:item.name,amount:item.amount})),expiresAt:order.expires_at};
}
export function paymentReceipt(order:any,sub:any) {
  const invoice=sub.latest_invoice;
  const paid=sub.status==='active' && invoice?.paid===true;
  const payment=invoice?.payment_intent;
  const next=sub.current_period_end || sub.items?.data?.[0]?.current_period_end;
  return {...orderSummary(order),subscriptionId:sub.id,status:paid?'paid':
    payment?.status==='requires_action'?'requires_action':payment?.status==='requires_payment_method'?'payment_failed':
    ['canceled','incomplete_expired'].includes(sub.status)?'closed':'pending',
    invoiceNumber:invoice?.number || null,amountPaid:paid?invoice.amount_paid:null,
    nextBillingDate:next?new Date(next*1000).toISOString():null,
    verificationUrl:!paid?invoice?.hosted_invoice_url || null:null,
    invoiceUrl:paid?invoice?.hosted_invoice_url || null:null};
}
