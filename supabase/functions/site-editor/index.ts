import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createGithub, editRepository, EditorError } from './github.js';
const headers = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store'};
const reply = (body:unknown,status=200) => Response.json(body,{status,headers});
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null,{headers});
  if (req.method !== 'POST') return reply({error:'Method not allowed'},405);
  const bearer = req.headers.get('Authorization')?.replace(/^Bearer /i,'');
  if (!bearer) return reply({error:'Sign in to edit a website.'},401);
  const client = createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{auth:{persistSession:false}});
  const {data:{user},error} = await client.auth.getUser(bearer);
  if (error || !user) return reply({error:'Your session has expired. Sign in again.'},401);
  try {
    // Bound the request before parsing. Credentials are never logged or stored.
    const reader = req.body?.getReader();
    if (!reader) return reply({error:'Missing request body.'},400);
    const chunks:Uint8Array[]=[]; let size=0;
    while (true) { const {done,value}=await reader.read(); if(done) break; size+=value.length; if(size>350000) {await reader.cancel();return reply({error:'Request too large.'},413);} chunks.push(value); }
    const bytes=new Uint8Array(size); let offset=0;
    for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const input=JSON.parse(new TextDecoder().decode(bytes));
    if (!input || typeof input.token !== 'string' || !/^(github_pat_|ghp_)[A-Za-z0-9_]+$/.test(input.token) || input.token.length > 300) return reply({error:'Enter a valid GitHub personal access token.'},400);
    return reply(await editRepository(input,createGithub(input.token)));
  } catch(e) {
    if(e instanceof EditorError) return reply({error:e.message},e.status);
    if(e instanceof SyntaxError) return reply({error:'Invalid request.'},400);
    return reply({error:'The site editor could not complete this request. Check GitHub for a saved branch before retrying.'},503);
  }
});
