import { fetchPage } from './network.ts';
import { analyse } from './analyse.ts';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
// Best-effort per-worker burst guard; not an account-wide billing quota.
const recent=new Map<string,{time:number;count:number}>();
Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({error:'Use POST to evaluate a page.'},405);
  const authorization=req.headers.get('Authorization')||'';
  if(!/^Bearer \S+$/i.test(authorization))return reply({error:'Sign in to evaluate a website.'},401);
  try {
    // Verify through Auth, supporting both asymmetric and legacy user JWTs.
    // No secrets or user token are ever forwarded to the evaluated website.
    const response=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{Authorization:authorization,apikey:Deno.env.get('SUPABASE_ANON_KEY')!},signal:AbortSignal.timeout(8000)});
    if(!response.ok)return reply({error:'Your session has expired. Please sign in again.'},401);
    const user=await response.json();
    if(!user.id)return reply({error:'Sign in to evaluate a website.'},401);
    const now=Date.now();
    for(const [id,item]of recent)if(now-item.time>60000)recent.delete(id);
    if(recent.size>5000)return reply({error:'The evaluator is busy. Try again in a minute.'},429);
    const rate=recent.get(user.id)||{time:now,count:0};rate.count++;recent.set(user.id,rate);
    if(rate.count>6)return reply({error:'Please wait a minute before running another evaluation.'},429);
    if(Number(req.headers.get('content-length'))>4096)return reply({error:'Request is too large.'},413);
    const raw=await req.text();if(raw.length>4096)return reply({error:'Request is too large.'},413);
    let body;try{body=JSON.parse(raw);}catch{return reply({error:'Enter a valid website URL.'},400);}
    if(typeof body?.url!=='string')return reply({error:'Enter a website URL.'},400);
    try { return reply(analyse(await fetchPage(body.url))); }
    catch(error){return reply({error:error instanceof Error?error.message:'The website could not be evaluated.'},422);}
  } catch { return reply({error:'The evaluation service is temporarily unavailable. Please try again.'},503); }
});
