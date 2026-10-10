import {syncAnySubscription} from '../_shared/orders.ts';
import {stripeLiveMode} from '../_shared/billing.ts';
import {syncSavedCard} from '../_shared/customers.ts';
import {verifySignature} from './signature.ts';
Deno.serve(async req=>{
  if(req.method!=='POST') return new Response('Method not allowed',{status:405});
  const secret=Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if(!secret) return new Response('Webhook not configured',{status:503});
  const body=await req.text();
  if(body.length>1000000 || !await verifySignature(body,req.headers.get('stripe-signature')||'',secret)) return new Response('Invalid signature',{status:400});
  try {
    const event=JSON.parse(body);
    if(event.livemode!==stripeLiveMode()) return Response.json({received:true});
    const object=event.data.object;
    if(event.type==='checkout.session.completed' && object.mode==='setup') await syncSavedCard(object);
    else if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type) && object.subscription) await syncAnySubscription(object.subscription,object);
    else if(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].includes(event.type)) await syncAnySubscription(object.id);
    else if(['invoice.paid','invoice.payment_failed'].includes(event.type) && object.subscription) await syncAnySubscription(object.subscription);
    return Response.json({received:true});
  } catch(e) {
    // Non-2xx causes Stripe to retry. Never acknowledge a failed database write.
    console.error('Subscription sync failed',e instanceof Error?e.message:'unknown');
    return new Response('Retry delivery',{status:500});
  }
});
