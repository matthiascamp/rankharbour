"""Temporary synthetic users; no Stripe purchases or emails. Always cleans up."""
import subprocess,json,urllib.request,urllib.error,secrets,uuid
URL='https://gczopudgxfciatvtxhll.supabase.co'
PUB='sb_publishable_FEmC6glyIu92uhTjih7J5g_SJPi79pz'
r=subprocess.run([r'node_modules\.bin\supabase.cmd','projects','api-keys','--project-ref','gczopudgxfciatvtxhll','--reveal','--output','json'],capture_output=True,text=True,check=True)
KEY=next(k['api_key'] for k in json.loads(r.stdout) if k['name']=='service_role')
def request(path,method='GET',data=None,token=KEY,admin=True):
    headers={'apikey':KEY if admin else PUB,'Authorization':'Bearer '+token,'Content-Type':'application/json','Prefer':'return=representation'}
    req=urllib.request.Request(URL+path,method=method,data=json.dumps(data).encode() if data is not None else None,headers=headers)
    try:
        with urllib.request.urlopen(req) as res:
            raw=res.read();return res.status,json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code,json.loads(e.read())
users=[]
try:
    for i in range(2):
        email='billing-qa-'+uuid.uuid4().hex+'@example.invalid';password=secrets.token_urlsafe(30)
        code,user=request('/auth/v1/admin/users','POST',{'email':email,'password':password,'email_confirm':True})
        assert code==200,('create fixture',code)
        users.append({'id':user['id']})
        code,session=request('/auth/v1/token?grant_type=password','POST',{'email':email,'password':password},token=PUB,admin=False)
        assert code==200,('fixture login',code)
        users[-1]['token']=session['access_token']
    intent=str(uuid.uuid4());sub='sub_qa_'+uuid.uuid4().hex
    code,_=request('/rest/v1/billing_checkout_intents','POST',{'id':intent,'user_id':users[0]['id'],'plan':'starter','payment_link_id':'plink_qa_fixture'})
    assert code==201,('insert intent',code)
    snapshot={'id':sub,'customer':'cus_qa_fixture','status':'active','amount':9900,'currency':'aud','period_end':'2026-11-02T00:00:00Z','cancel_at_period_end':False,'observed_at':'2026-10-05T12:00:00Z'}
    code,_=request('/rest/v1/rpc/sync_billing_subscription','POST',{'intent_id':intent,'snapshot':snapshot})
    assert code in (200,204),('sync',code)
    path='/rest/v1/billing_subscriptions?stripe_subscription_id=eq.'+sub
    code,rows=request(path,token=users[0]['token'],admin=False);assert code==200 and len(rows)==1
    code,rows=request(path,token=users[1]['token'],admin=False);assert code==200 and rows==[]
    code,_=request('/rest/v1/rpc/sync_billing_subscription','POST',{'intent_id':intent,'snapshot':snapshot},token=users[0]['token'],admin=False);assert code in (401,403)
    code,_=request(path,'PATCH',{'status':'active'},token=users[0]['token'],admin=False);assert code in (401,403)
    code,_=request('/rest/v1/billing_checkout_intents','POST',{'user_id':users[0]['id'],'plan':'pro','payment_link_id':'fake'},token=users[0]['token'],admin=False);assert code in (401,403)
    newer={**snapshot,'status':'canceled','observed_at':'2026-10-05T13:00:00Z'}
    for value in [newer,snapshot,snapshot]:
        code,_=request('/rest/v1/rpc/sync_billing_subscription','POST',{'intent_id':intent,'snapshot':value});assert code in (200,204)
    code,rows=request(path);assert rows[0]['status']=='canceled'
    # Repeated checkout on the same Payment Link must still associate the purchase.
    code,_=request('/rest/v1/rpc/sync_billing_subscription','POST',{'intent_id':intent,'snapshot':{**snapshot,'id':sub+'_second'}});assert code in (200,204)
    code,rows=request('/rest/v1/billing_subscriptions?user_id=eq.'+users[0]['id']);assert len(rows)==2
    print('PASS: own-account reads, cross-account isolation, browser write denial, duplicate/stale events, repeated-link ownership')
finally:
    for user in users:
        code,_=request('/auth/v1/admin/users/'+user['id'],'DELETE');assert code in (200,204),('fixture cleanup',code)
    print('Synthetic users and billing records removed')
