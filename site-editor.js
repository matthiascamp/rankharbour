import { getSupabaseClient } from './src/auth/client.js';
import { getAuthConfig } from './src/auth/config.js';

export function initSiteEditor(root) {
  const $ = selector => root.querySelector(selector);
  const connect = $('#editor-connect'), workspace = $('#editor-workspace');
  const code = $('#editor-code'), status = $('#editor-status');
  let token='', connection=null, loaded=null, original='', controller=null, generation=0, busy=false;
  const say = message => { status.textContent=message; };
  function controls() {
    root.querySelectorAll('button,input,select,textarea').forEach(el=>{el.disabled=busy;});
    $('#editor-publish').disabled=busy || !loaded || code.value===original;
    $('#editor-apply-tags').disabled=busy || !loaded || !/\.html?$/i.test(loaded);
  }
  async function request(input) {
    const activeController=controller, activeToken=token;
    const {data,error}=await getSupabaseClient().auth.getSession();
    activeController.signal.throwIfAborted();
    if(error || !data.session) throw new Error('Sign in to edit a website.');
    const config=getAuthConfig();
    const response=await fetch(new URL('/functions/v1/site-editor',config.url),{
      method:'POST',signal:activeController.signal,
      headers:{Authorization:`Bearer ${data.session.access_token}`,apikey:config.publishableKey,'Content-Type':'application/json'},
      body:JSON.stringify({...input,token:activeToken}),
    });
    const result=await response.json();
    activeController.signal.throwIfAborted();
    if(!response.ok) throw new Error(result.error || 'The site editor is unavailable.');
    return result;
  }
  async function run(task) {
    if(busy) return;
    busy=true;controls();controller=new AbortController();
    const current=generation;
    try { await task(); } catch(error) { if(current===generation && error.name!=='AbortError') say(error.message); }
    finally { if(current===generation){busy=false;controls();} }
  }
  function readTags() {
    const html=/\.html?$/i.test(loaded || '');$('#editor-tags').hidden=!html;
    if(!html) return;
    const doc=new DOMParser().parseFromString(code.value,'text/html');
    $('#editor-title').value=doc.querySelector('title')?.textContent || '';
    $('#editor-description').value=doc.querySelector('meta[name="description" i]')?.getAttribute('content') || '';
  }
  connect.addEventListener('submit',event=>{
    event.preventDefault();
    if(loaded && code.value!==original && !window.confirm('Discard your unsaved edits and reconnect?')) return;
    run(async()=>{
      token=$('#editor-token').value.trim();connection=null;loaded=null;workspace.hidden=true;$('#editor-result').hidden=true;
      say('Connecting to GitHub…');
      try { connection=await request({action:'connect',repo:$('#editor-repo').value.trim()}); }
      catch(error){token='';throw error;}
      $('#editor-token').value='';
      const files=$('#editor-file');files.replaceChildren();
      for(const path of connection.files){const option=document.createElement('option');option.value=path;option.textContent=path;files.append(option);}
      code.value='';original='';$('#editor-tags').hidden=true;
      $('#editor-repository').textContent=`${connection.repo} · ${connection.branch}`;workspace.hidden=false;
      say(connection.files.length?'Connected. Choose a source file and load it.':'Connected, but no supported source files were found.');
    });
  });
  $('#editor-load').addEventListener('click',()=>{
    if(loaded && code.value!==original && !window.confirm('Discard unsaved edits and load this file?')) return;
    run(async()=>{
      const path=$('#editor-file').value;if(!path) throw new Error('Choose a file first.');
      say('Loading source…');const result=await request({action:'read',repo:connection.repo,headSha:connection.headSha,path});
      loaded=path;original=result.content;code.value=original;
      $('#editor-loaded').textContent=path;$('#editor-result').hidden=true;
      readTags();say('File loaded. Edit the source or update its HTML SEO tags.');
    });
  });
  $('#editor-apply-tags').addEventListener('click',()=>{
    const match=code.value.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
    if(!match){say('No explicit <head> section found. Edit the source directly for this file.');return;}
    const doc=new DOMParser().parseFromString(`<html><head>${match[1]}</head><body></body></html>`,'text/html');
    if(doc.body.innerHTML.trim()){say('The head contains unexpected markup. Edit the source directly.');return;}
    let title=doc.head.querySelector('title');
    if(!title){title=doc.createElement('title');doc.head.append(title);}
    title.textContent=$('#editor-title').value;
    let meta=doc.head.querySelector('meta[name="description" i]');
    if(!meta){meta=doc.createElement('meta');meta.setAttribute('name','description');doc.head.append(meta);}
    meta.setAttribute('content',$('#editor-description').value);
    doc.head.querySelectorAll('title').forEach(el=>{if(el!==title)el.remove();});
    doc.head.querySelectorAll('meta[name="description" i]').forEach(el=>{if(el!==meta)el.remove();});
    const start=match.index+match[0].indexOf('>')+1;
    code.value=code.value.slice(0,start)+doc.head.innerHTML+code.value.slice(start+match[1].length);
    controls();say('SEO tags updated in the source. Review the code before submitting.');
  });
  code.addEventListener('input',controls);
  $('#editor-publish-form').addEventListener('submit',event=>{
    event.preventDefault();if(!loaded || code.value===original) return;
    run(async()=>{
      say('Committing changes and opening a pull request…');
      const result=await request({action:'publish',repo:connection.repo,headSha:connection.headSha,path:loaded,content:code.value,message:$('#editor-summary').value});
      original=code.value;const link=$('#editor-result'),url=new URL(result.url);
      if(url.protocol!=='https:' || url.hostname!=='github.com') throw new Error('Unexpected GitHub response.');
      link.href=url.href;link.hidden=false;link.textContent='Review changes on GitHub ↗';say(result.message);
    });
  });
  function reset() {
    generation++;controller?.abort();controller=null;busy=false;token='';connection=null;loaded=null;original='';
    connect.reset();$('#editor-publish-form').reset();code.value='';workspace.hidden=true;$('#editor-result').hidden=true;
    $('#editor-file').replaceChildren();$('#editor-repository').textContent='';$('#editor-loaded').textContent='';say('');controls();
  }
  $('#editor-disconnect').addEventListener('click',()=>{
    if(code.value!==original && !window.confirm('Discard unsaved edits and disconnect?')) return;
    reset();say('Disconnected. Repository access has been cleared.');
  });
  window.addEventListener('beforeunload',event=>{if(loaded && code.value!==original){event.preventDefault();event.returnValue='';}});
  controls();return {reset,cancel:reset};
}
