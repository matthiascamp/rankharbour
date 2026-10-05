import { analyse } from './analyse.ts';
import { targetUrl, publicAddress, decodeChunks } from './network.ts';
import { strict as assert } from 'node:assert';

Deno.test('Reject private, alternate-scheme, credential and nonstandard-port URLs',()=>{
  for(const input of ['http://127.0.0.1','http://2130706433','http://0x7f000001','http://[::1]','http://[::ffff:127.0.0.1]','http://10.0.0.2','http://169.254.169.254','http://localhost','http://private.internal','file:///etc/passwd','https://name:pass@example.com','https://example.com:8443']) {
    assert.throws(()=>targetUrl(input),input);
  }
  for(const ip of ['192.168.0.1','172.16.1.1','100.64.0.1','0.0.0.0','224.0.0.1','fc00::1','fe80::1','2001:db8::1'])assert.equal(publicAddress(ip),false,ip);
  assert.equal(targetUrl('example.com/page#test').href,'https://example.com/page');
  assert.equal(publicAddress('1.1.1.1'),true);
});
Deno.test('Report concrete missing findings and header noindex',()=>{
  const r=analyse({url:'http://example.com',finalUrl:'http://example.com',status:200,headers:{'x-robots-tag':'noindex'},html:'<!doctype html><html><head><title>Short</title></head><body><h1>One</h1><h1>Two</h1><img src="x"><img alt="" src="y"><script type="application/ld+json">bad</script><a href="/about">About</a></body></html>'});
  assert.equal(r.metrics.missingAltCount,1);
  assert.equal(r.metrics.h1Count,2);
  assert.equal(r.metrics.internalLinks,1);
  assert.equal(r.checks.find(c=>c.id==='indexing')?.status,'fail');
  assert.equal(r.checks.find(c=>c.id==='structured')?.status,'fail');
  assert.equal(r.summary.passed+r.summary.warnings+r.summary.failed,r.checks.length);
  assert(r.score>=0&&r.score<=100);
});
Deno.test('Mixed-case metadata and source text are parsed; scripts excluded',()=>{
  const html='<html lang="en"><head><title>A useful and descriptive page title</title><meta name="DESCRIPTION" content="A helpful summary for visitors explaining the page and its particular topic in a clear and useful way."><meta name="viewport" content="width=device-width"><link rel="canonical" href="/page"></head><body><h1>Heading</h1><p>'+('Useful text '.repeat(60))+'</p><img alt="Description"><script type="application/ld+json">{"@type":"WebPage"}</script><a href="/other">Other</a></body></html>';
  const r=analyse({html,url:'https://example.com/page',finalUrl:'https://example.com/page',status:200,headers:{}});
  assert.equal(r.score,100);assert(r.metrics.wordCount<140);assert(r.metrics.description.startsWith('A helpful'));
});

Deno.test('Chunked HTTP responses decode extensions and reject truncation',()=>{
  const encode=(text:string)=>new TextEncoder().encode(text);
  assert.equal(new TextDecoder().decode(decodeChunks(encode('4;ext=1\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n'))),'Wikipedia');
  assert.throws(()=>decodeChunks(encode('5\r\nabc')));
  assert.throws(()=>decodeChunks(encode('bad-size\r\nabc\r\n')));
});
