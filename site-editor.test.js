import test from 'node:test';
import assert from 'node:assert/strict';
import {editablePath,editRepository,createGithub} from './supabase/functions/site-editor/github.js';
const sha='a'.repeat(40);
const input={repo:'client/site',headSha:sha,path:'index.html',action:'publish',content:'<html>New</html>',message:'Improve page title'};
function mock({changed=false,writable=true,prFail=false,mode='100755',original='<html>Old</html>'}={}) {
  const calls=[];
  const github=async(path,method='GET',body)=>{
    calls.push({path,method,body});
    if(path==='/repos/client/site')return {full_name:'client/site',default_branch:'main',permissions:{push:writable}};
    if(path.includes('/git/ref/heads/'))return {object:{sha:changed?'b'.repeat(40):sha}};
    if(path.includes('/git/commits/') && method==='GET')return {tree:{sha:'tree-base'}};
    if(path.includes('/git/trees/') && method==='GET')return {tree:[{path:'index.html',type:'blob',mode,size:100},{path:'.env',type:'blob',mode:'100644',size:20}]};
    if(path.includes('/contents/'))return {type:'file',encoding:'base64',size:100,content:Buffer.from(original).toString('base64')};
    if(path.endsWith('/pulls')){if(prFail)throw new Error('permission');return {html_url:'https://github.com/client/site/pull/1'};}
    return {sha:'new-sha'};
  };
  return {github,calls};
}
test('rejects traversal, secrets, hidden files and generated source',()=>{
  for(const path of ['../index.html','.env','.github/workflows/build.json','src/.secret.json','node_modules/a.js','vendor/a.js','secrets.json','src/credentials.json','image.png','/index.html']) assert.equal(editablePath(path),false,path);
  for(const path of ['index.html','src/app/page.tsx','public/robots.txt','src/layout.astro'])assert.equal(editablePath(path),true,path);
});
test('connect excludes hidden files and symlinks',async()=>{
  const {github}=mock();assert.deepEqual((await editRepository({...input,action:'connect'},github)).files,['index.html']);
  const symlink=mock({mode:'120000'});assert.deepEqual((await editRepository({...input,action:'connect'},symlink.github)).files,[]);
});
test('requires repository write permission',async()=>{
  const {github,calls}=mock({writable:false});await assert.rejects(editRepository(input,github),/write access/);assert.equal(calls.length,1);
});
test('stale snapshot fails before any write',async()=>{
  const {github,calls}=mock({changed:true});await assert.rejects(editRepository(input,github),/changed since/);assert.ok(calls.every(c=>c.method==='GET'));
});
test('server refuses symlink reads and publishes',async()=>{
  const {github,calls}=mock({mode:'120000'});await assert.rejects(editRepository(input,github),/symbolic links/);assert.ok(calls.every(c=>c.method==='GET'));
});
test('publish preserves file mode and only creates a new branch',async()=>{
  const {github,calls}=mock();const result=await editRepository(input,github,()=> 'test-id');
  assert.equal(result.url,'https://github.com/client/site/pull/1');
  assert.equal(calls.find(c=>c.path.endsWith('/git/trees')&&c.method==='POST').body.tree[0].mode,'100755');
  assert.deepEqual(calls.filter(c=>c.path.endsWith('/git/refs')).map(c=>c.body.ref),['refs/heads/rankharbour/seo-test-id']);
  assert.ok(!calls.some(c=>['PATCH','PUT','DELETE'].includes(c.method)));
});
test('pull request failure returns recoverable committed branch',async()=>{
  const {github}=mock({prFail:true});const result=await editRepository(input,github,()=> 'test-id');
  assert.equal(result.url,'https://github.com/client/site/tree/rankharbour/seo-test-id');assert.match(result.message,/manually/);
});
test('unchanged and oversized source never writes',async()=>{
  for(const content of ['<html>Old</html>','a'.repeat(200001)]){
    const {github,calls}=mock();await assert.rejects(editRepository({...input,content},github));assert.ok(calls.every(c=>c.method==='GET'));
  }
});
test('GitHub transport uses fixed origin and does not expose token in errors',async()=>{
  const token='github_pat_test';let captured;
  const github=createGithub(token,async(url,options)=>{captured={url,options};return {ok:false,status:401};});
  await assert.rejects(github('/repos/client/site'),error=>!error.message.includes(token));
  assert.equal(captured.url,'https://api.github.com/repos/client/site');assert.equal(captured.options.redirect,'error');
});
