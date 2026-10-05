// All subscription ownership and checkout references are issued by the server.
const NAMES = {starter:'Starter',growth:'Growth',pro:'Pro',enterprise:'Enterprise','enterprise-plus':'Enterprise Plus'};
export function initBilling(root) {
  const status=root.querySelector('#billing-status');
  const records=root.querySelector('#billing-records');
  const messages=[...root.querySelectorAll('[data-billing-message]')];
  const buttons=[...root.querySelectorAll('[data-subscribe]')];
  let userId=null, generation=0, controller=null, loading=false, subscriptions=[], checked=false, preview=null;
  const message=text=>messages.forEach(el=>{el.textContent=text;});
  const hasSubscription=()=>subscriptions.some(s=>!['canceled','incomplete_expired'].includes(s.status));
  function renderButtons() {buttons.forEach(b=>{b.disabled=loading||!checked||hasSubscription()||!!preview; b.textContent=preview?(preview.plan===b.dataset.subscribe?'Your plan · Free preview':'Preview account'):hasSubscription()?'Manage in Account centre':`Choose ${NAMES[b.dataset.subscribe]}`;});}
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
    status.textContent=subscriptions.length?'Your subscription details are synced from Stripe.':'No subscription yet. Choose a plan in Plans & Pricing to get started.';
    if(preview) {
      status.textContent='Your complimentary plan preview is active. No payment is due.';
      const box=document.createElement('div');box.className='dash-box';
      const title=document.createElement('h4');title.className='dash-h3';title.textContent=`${NAMES[preview.plan]} — active preview`;
      const tagline=document.createElement('p');tagline.className='dash-box__text';tagline.textContent=preview.plan==='pro'?'SEO + Content Growth':'';
      const price=document.createElement('p');price.className='dash-box__text';price.textContent=`Plan value: ${new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(preview.amount/100)} AUD every 28 days`;
      const website=document.createElement('p');website.className='dash-box__text';website.textContent=`Website: ${preview.website.replace(/^https:\/\//,'').replace(/\/$/,'')}`;
      const note=document.createElement('p');note.className='dash-box__text';note.textContent='Your cost: $0. No Stripe subscription, automatic renewal or scheduled charge. Paid checkout is disabled for this preview account.';
      box.append(title,tagline,price,website,note);records.append(box);
    }
    subscriptions.forEach(sub=>{
      const box=document.createElement('div');box.className='dash-box';
      const title=document.createElement('h4');title.className='dash-h3';title.textContent=`${NAMES[sub.plan]||sub.plan} — ${sub.status.replaceAll('_',' ')}`;
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
    renderButtons();
  }
  async function refresh() {
    if(!userId||loading) return;
    const version=generation;controller=new AbortController();loading=true;renderButtons();
    try {
      const data=await request({action:'status'},controller.signal);
      if(version!==generation) return;
      subscriptions=data.subscriptions;preview=data.preview||null;checked=true;message('');render();
    } catch(error) {
      if(version===generation && error.name!=='AbortError') {status.textContent='Subscription details could not be loaded.';message(error.message);}
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
      if(url.protocol!=='https:'||!['buy.stripe.com','billing.stripe.com'].includes(url.hostname)) throw new Error('Unexpected checkout destination.');
      if(tab&&!tab.closed) tab.location.href=url.href;else window.location.assign(url.href);
      message('Complete the steps in Stripe, then return here and refresh status. Your subscription appears after Stripe confirms it.');
    } catch(error) {tab?.close();if(version===generation&&error.name!=='AbortError') message(error.message);}
    finally {if(version===generation){loading=false;button.disabled=false;renderButtons();}}
  }
  buttons.forEach(b=>b.addEventListener('click',()=>openBilling({action:'checkout',plan:b.dataset.subscribe},b)));
  root.querySelector('#billing-refresh').addEventListener('click',refresh);
  window.addEventListener('focus',()=>{if(userId) refresh();});
  return {
    setUser(id) {
      if(userId===id) return;
      generation++;controller?.abort();userId=id;loading=false;subscriptions=[];preview=null;checked=false;records.replaceChildren();message('');status.textContent=id?'Loading subscription details…':'';renderButtons();
      // Auth event callbacks must finish before calling the SDK again.
      if(id) setTimeout(refresh,0);
    },
  };
}
