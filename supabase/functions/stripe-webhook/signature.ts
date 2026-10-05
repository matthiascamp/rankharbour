export async function verifySignature(body:string,header:string,secret:string,now=Date.now()) {
  const fields=header.split(',').map(s=>s.split('='));
  const timestamp=fields.find(([k])=>k==='t')?.[1];
  if(!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now/1000-Number(timestamp))>300) return false;
  const signatures=fields.filter(([k,v])=>k==='v1' && /^[a-f0-9]{64}$/.test(v)).map(([,v])=>v);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  for(const signature of signatures) {
    const bytes=Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16));
    if(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+body))) return true;
  }
  return false;
}
