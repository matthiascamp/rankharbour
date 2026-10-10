// All subscription ownership and checkout references are issued by the server.
const ADDON='backlinks';
const isAddon=plan=>plan===ADDON||plan==='google-business-posts';
const NAMES = {starter:'Starter',growth:'Growth',pro:'Pro',enterprise:'Enterprise','enterprise-plus':'Enterprise Plus',[ADDON]:'Backlinks','google-business-posts':'Google Business Posts'};
export function initBilling(root) {
  const status=root.querySelector('#billing-status');
  const records=root.querySelector('#billing-records');
  const cards=root.querySelector('#payment-methods-list');
  const cardsStatus=root.querySelector('#payment-methods-status');
  const saveCard=root.querySelector('#save-payment-method');
  const messages=[...root.querySelectorAll('[data-billing-message]')];
  const buttons=[...root.querySelectorAll('[data-subscribe]')];
  const addonSwitch=root.querySelector('#backlinks-toggle');
  const addonStatus=root.querySelector('#backlinks-availability');
  const review=root.querySelector('#subscription-review');
  const summary=root.querySelector('#subscription-summary');
  const payment=root.querySelector('#subscription-payment');
  const cardSelect=root.querySelector('#subscription-card');
  const consent=root.querySelector('#subscription-consent');
  const confirm=root.querySelector('#subscription-confirm');
  const result=root.querySelector('#subscription-result');
  const receiptActions=root.querySelector('#subscription-receipt-actions');
  let order=null, receipt=null, pendingOrderId=null, selectedBacklinks=false, selectedPlan=null;
  const money=amount=>new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(amount/100)+' AUD';
  const activeBase=()=>!!preview||subscriptions.some(s=>!isAddon(s.plan)&&['active','trialing'].includes(s.status));
  const hasAddon=()=>subscriptions.some(s=>(s.plan===ADDON||s.addons?.includes(ADDON))&&!['canceled','incomplete_expired'].includes(s.status));
  let userId=null, generation=0, controller=null, loading=false, subscriptions=[], checked=false, preview=null, paymentMethods=[], testMode=false;
  const message=text=>messages.forEach(el=>{el.textContent=text;});
  const hasSubscription=()=>subscriptions.some(s=>!isAddon(s.plan)&&!['canceled','incomplete_expired'].includes(s.status));
  function renderButtons() {
    saveCard.disabled=loading||!checked||!userId;
    saveCard.textContent=paymentMethods.length?'Add another card':'Save a payment method';
    addonSwitch.checked=hasAddon()||selectedBacklinks;
    addonSwitch.disabled=loading||!checked||hasAddon()||!!receipt;
    addonStatus.textContent=hasAddon()?'Added. Manage in Account centre.':selectedBacklinks?'Selected: +A$29 every 28 days':'Optional: include with your plan';
    confirm.disabled=loading||!order||!!receipt||!consent.checked||!cardSelect.value;
    cardSelect.disabled=loading;consent.disabled=loading;
    root.querySelector('#subscription-dismiss').disabled=loading;
    buttons.forEach(b=>{
      if(b.dataset.subscribe===ADDON) {
        b.disabled=loading||!checked||hasAddon()||!activeBase();
        b.textContent=hasAddon()?'Manage in Account centre':!checked?'Loading account…':!activeBase()?'Choose an SEO plan first':'Add Backlinks';
      } else {
        b.disabled=loading||!checked||hasSubscription();
        b.textContent=hasSubscription()?'Manage in Account centre':preview?.plan===b.dataset.subscribe?'Current plan':`Choose ${NAMES[b.dataset.subscribe]}`;
      }
    });
  }
  async function request(body,signal) {
    const [{getSupabaseClient},{getAuthConfig}]=await Promise.all([import('./src/auth/client.js'),import('./src/auth/config.js')]);
    const {data:{session}}=await getSupabaseClient().auth.getSession();
    if(!session || session.user.id!==userId) throw new Error('Please sign in again to manage billing.');
    const {url,publishableKey}=getAuthConfig();
    const response=await fetch(url+'/functions/v1/billing',{method:'POST',signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),headers:{Authorization:`Bearer ${session.access_token}`,apikey:publishableKey,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error||'Billing is temporarily unavailable.');
    return data;
  }
  function render() {
    records.replaceChildren();
    cards.replaceChildren();
    cardsStatus.textContent=(testMode?'Test mode · ':'')+(paymentMethods.length?'Saved securely with Stripe. Select your card when confirming a subscription.':'No saved payment methods yet.');
    paymentMethods.forEach(card=>{
      const item=document.createElement('li');
      item.textContent=`${String(card.brand).toUpperCase()} ending ${card.last4} · Expires ${String(card.expMonth).padStart(2,'0')}/${card.expYear}`;
      cards.append(item);
    });
    status.textContent=subscriptions.length?'Your subscription details are synced from Stripe.':'No subscription yet. Choose a plan in Plans & Pricing to get started.';
    if(preview) {
      status.textContent=`Your ${NAMES[preview.plan]} plan is active.`;
      const box=document.createElement('div');box.className='dash-box';
      const title=document.createElement('h4');title.className='dash-h3';title.textContent=`${NAMES[preview.plan]} — active`;
      const tagline=document.createElement('p');tagline.className='dash-box__text';tagline.textContent=preview.plan==='pro'?'SEO + Content Growth':'';
      const price=document.createElement('p');price.className='dash-box__text';price.textContent=`Plan value: ${new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(preview.amount/100)} AUD every 28 days`;
      const website=document.createElement('p');website.className='dash-box__text';website.textContent=`Website: ${preview.website.replace(/^https:\/\//,'').replace(/\/$/,'')}`;
      const note=document.createElement('p');note.className='dash-box__text';note.textContent='Billing: $0';
      box.append(title,tagline,price,website,note);records.append(box);
    }
    subscriptions.forEach(sub=>{
      const box=document.createElement('div');box.className='dash-box';
      const title=document.createElement('h4');title.className='dash-h3';title.textContent=`${NAMES[sub.plan]||sub.plan}${sub.addons?.includes(ADDON)?' + Backlinks':''}${isAddon(sub.plan)?' (add-on)':''} — ${sub.status.replaceAll('_',' ')}`;
      const detail=document.createElement('p');detail.className='dash-box__text';
      detail.textContent=new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(sub.amount/100)+' AUD every 28 days';
      const date=document.createElement('p');date.className='dash-box__text';
      const end=sub.current_period_end?new Date(sub.current_period_end):null;
      const dateText=end&&!Number.isNaN(end.valueOf())?end.toLocaleDateString('en-AU',{day:'numeric',month:'long',year:'numeric'}):'not available';
      date.textContent=(sub.status==='canceled'?'Last billing period ended: ':sub.cancel_at_period_end?'Scheduled to end: ':['active','trialing'].includes(sub.status)?'Next billing date: ':'Current billing period ends: ')+dateText;
      const manage=document.createElement('button');manage.type='button';manage.className='btn-chalk';manage.textContent='Manage subscription';
      manage.addEventListener('click',()=>openBilling({action:'portal',subscriptionId:sub.stripe_subscription_id},manage));
      box.append(title,detail,date,manage);records.append(box);
    });
    if(pendingOrderId) {
      const resume=document.createElement('button');resume.type='button';resume.className='btn-brass';resume.textContent='Resume subscription confirmation';
      resume.addEventListener('click',()=>reviewOrder(pendingOrderId));records.prepend(resume);
    }
    if(order&&!receipt) renderReview();
    renderButtons();
  }
  async function refresh() {
    if(!userId||loading) return;
    const version=generation;controller=new AbortController();loading=true;renderButtons();
    try {
      const data=await request({action:'status'},controller.signal);
      if(version!==generation) return;
      pendingOrderId=data.pendingOrderId||null;subscriptions=data.subscriptions;preview=data.preview||null;paymentMethods=data.paymentMethods||[];testMode=!!data.testMode;checked=true;message('');render();
    } catch(error) {
      if(version===generation && error.name!=='AbortError') {status.textContent='Subscription details could not be loaded.';cardsStatus.textContent='Payment methods could not be loaded. Refresh status to try again.';message(error.message);}
    } finally {if(version===generation){loading=false;renderButtons();}}
  }
  async function openBilling(body,button) {
    if(!userId||loading) return;
    const version=generation;
    // Open synchronously to avoid popup blocking while the server checks ownership.
    const tab=window.open('about:blank','_blank');
    if(tab) {tab.opener=null;tab.document.title='Opening secure Stripe checkout';tab.document.body.textContent='Opening Stripe…';}
    loading=true;button.disabled=true;renderButtons();message('Opening Stripe securely…');controller=new AbortController();
    try {
      const data=await request(body,controller.signal);
      if(version!==generation) {tab?.close();return;}
      const url=new URL(data.url);
      if(url.protocol!=='https:'||!['buy.stripe.com','checkout.stripe.com','billing.stripe.com'].includes(url.hostname)) throw new Error('Unexpected checkout destination.');
      if(tab&&!tab.closed) tab.location.href=url.href;else window.location.assign(url.href);
      message(body.action==='save-payment-method'?'Save your card in Stripe, then return here and refresh status. You will not be charged.':'Complete the steps in Stripe, then return here and refresh status. Your subscription appears after Stripe confirms it.');
    } catch(error) {tab?.close();if(version===generation&&error.name!=='AbortError') message(error.message);}
    finally {if(version===generation){loading=false;button.disabled=false;renderButtons();}}
  }
  function safeInvoiceLink(url,label) {
    try {
      const parsed=new URL(url);
      if(parsed.protocol!=='https:'||!['invoice.stripe.com','pay.stripe.com'].includes(parsed.hostname)) return;
      const link=document.createElement('a');link.href=parsed.href;link.target='_blank';link.rel='noopener noreferrer';link.className='btn-chalk';link.textContent=label;receiptActions.append(link);
    } catch {}
  }
  function renderReview() {
    review.hidden=false;summary.replaceChildren();receiptActions.replaceChildren();
    root.querySelector('#subscription-review-title').textContent=receipt?.status==='paid'?'Subscription confirmed ? receipt':'Review your subscription';
    const data=receipt||order;
    data.items.forEach(item=>{const row=document.createElement('p');row.textContent=`${item.name}: ${money(item.amount)} every 28 days`;summary.append(row);});
    const total=document.createElement('p');total.className='subscription-total';total.textContent=`${money(data.amount)} every 28 days`;summary.append(total);
    payment.hidden=!!receipt;
    if(!receipt) {
      const previous=cardSelect.value;cardSelect.replaceChildren();
      paymentMethods.forEach(card=>{const option=document.createElement('option');option.value=card.id;option.textContent=`${String(card.brand).toUpperCase()} ending ${card.last4} ? ${card.expMonth}/${card.expYear}`;cardSelect.append(option);});
      if([...cardSelect.options].some(o=>o.value===previous))cardSelect.value=previous;
      cardSelect.hidden=!paymentMethods.length;
      root.querySelector('#subscription-save-card').hidden=!!paymentMethods.length;
      confirm.textContent=`Confirm subscription & pay ${money(data.amount)}`;
      result.textContent=paymentMethods.length?'You will be charged today. Your subscription renews every 28 days.':'Save a card securely with Stripe, return here, then refresh status to continue.';
    } else {
      if(receipt.status==='paid') {
        result.textContent=`Paid ${money(receipt.amountPaid)}. Receipt ${receipt.invoiceNumber||receipt.subscriptionId}. Next billing date: ${new Date(receipt.nextBillingDate).toLocaleDateString('en-AU')}. Your subscription is active.`;
        safeInvoiceLink(receipt.invoiceUrl,'View Stripe invoice');
      } else if(receipt.status==='closed')result.textContent='This subscription attempt is closed. You can choose a plan again.';
      else {
        result.textContent=receipt.status==='requires_action'?'Your bank requires verification. Complete verification to activate your subscription.':receipt.status==='payment_failed'?'The payment was declined. Update your payment details securely with Stripe to continue.':'Stripe has not confirmed payment yet. Check payment status before trying again.';
        safeInvoiceLink(receipt.verificationUrl,receipt.status==='requires_action'?'Verify payment with Stripe':'Complete payment with Stripe');
        const check=document.createElement('button');check.type='button';check.className='btn-brass';check.textContent='Check payment status';check.addEventListener('click',()=>reviewOrder(receipt.id));receiptActions.append(check);
        const cancel=document.createElement('button');cancel.type='button';cancel.className='btn-chalk';cancel.textContent='Cancel pending subscription';cancel.addEventListener('click',()=>orderAction({action:'cancel-order',orderId:receipt.id}));receiptActions.append(cancel);
      }
    }
    renderButtons();
  }
  async function orderAction(body) {
    if(!userId||loading)return;
    const version=generation;loading=true;renderButtons();controller=new AbortController();result.textContent='Checking securely with Stripe?';
    receiptActions.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const data=await request(body,controller.signal);if(version!==generation)return;
      if(data.canceled){order=null;receipt=null;pendingOrderId=null;review.hidden=true;message('Pending subscription canceled.');}
      else {
        order=data.quote||data.receipt;receipt=data.receipt||null;
        if(data.cards)paymentMethods=data.cards;
        if(receipt)pendingOrderId=['paid','closed'].includes(receipt.status)?null:receipt.id;
        renderReview();review.scrollIntoView({behavior:'smooth',block:'center'});root.querySelector('#subscription-review-title').focus({preventScroll:true});
      }
    } catch(error) {if(version===generation&&error.name!=='AbortError')result.textContent=error.message+' You can retry this confirmation safely.';}
    finally {if(version===generation){loading=false;renderButtons();receiptActions.querySelectorAll('button').forEach(b=>b.disabled=false);if(receipt||body.action==='cancel-order')refresh();}}
  }
  function reviewOrder(id){return orderAction({action:'order-status',orderId:id});}
  function quote(plan){selectedPlan=plan;consent.checked=false;receipt=null;order=null;review.hidden=false;return orderAction({action:'quote',plan,backlinks:plan===ADDON?false:selectedBacklinks});}
  confirm.addEventListener('click',()=>{if(order&&consent.checked&&cardSelect.value)orderAction({action:'confirm-subscription',orderId:order.id,paymentMethodId:cardSelect.value});});
  cardSelect.addEventListener('change',renderButtons);consent.addEventListener('change',renderButtons);
  root.querySelector('#subscription-save-card').addEventListener('click',()=>openBilling({action:'save-payment-method'},saveCard));
  root.querySelector('#subscription-dismiss').addEventListener('click',()=>{if(loading)return;order=null;receipt=null;selectedPlan=null;consent.checked=false;review.hidden=true;renderButtons();});
  buttons.forEach(b=>b.addEventListener('click',()=>{
    if(preview?.plan===b.dataset.subscribe) {
      document.getElementById('dash-tab-account').click();
      document.getElementById('dash-account-title').focus({preventScroll:true});
      return;
    }
    quote(b.dataset.subscribe);
  }));
  addonSwitch.addEventListener('change',()=>{
    selectedBacklinks=addonSwitch.checked;
    if(activeBase()&&selectedBacklinks)quote(ADDON);
    else if(selectedPlan&&!receipt)quote(selectedPlan);
    else renderButtons();
  });
  root.querySelector('#billing-refresh').addEventListener('click',refresh);
  saveCard.addEventListener('click',()=>openBilling({action:'save-payment-method'},saveCard));
  window.addEventListener('focus',()=>{if(userId) refresh();});
  return {
    setUser(id) {
      if(userId===id) return;
      generation++;controller?.abort();order=null;receipt=null;pendingOrderId=null;selectedPlan=null;selectedBacklinks=false;review.hidden=true;summary.replaceChildren();result.textContent="";receiptActions.replaceChildren();cardSelect.replaceChildren();consent.checked=false;userId=id;loading=false;subscriptions=[];preview=null;paymentMethods=[];testMode=false;checked=false;records.replaceChildren();cards.replaceChildren();message('');status.textContent=id?'Loading subscription details…':'';cardsStatus.textContent=id?'Loading payment methods…':'';renderButtons();
      // Auth event callbacks must finish before calling the SDK again.
      if(id) setTimeout(refresh,0);
    },
  };
}
