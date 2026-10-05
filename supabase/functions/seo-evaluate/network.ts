import ipaddr from 'npm:ipaddr.js@2.2.0';

export function publicAddress(value: string): boolean {
  try { return ipaddr.parse(value).range() === 'unicast'; } catch { return false; }
}

export function targetUrl(input: string): URL {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Enter a public website URL of at most 2,048 characters.');
  const value = input.trim();
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : 'https://' + value);
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !host ||
      /(^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(host) ||
      (ipaddr.isValid(host) ? !publicAddress(host) : !host.includes('.'))) {
    throw new Error('Use a public HTTP or HTTPS website with a standard port and no credentials.');
  }
  url.hash = '';
  return url;
}

export async function publicIp(url: URL): Promise<string> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) {
    if (!publicAddress(host)) throw new Error('Private or reserved network addresses cannot be evaluated.');
    return host;
  }
  const answers = await Promise.allSettled([Deno.resolveDns(host, 'A'), Deno.resolveDns(host, 'AAAA')]);
  const addresses = answers.flatMap(r => r.status === 'fulfilled' ? r.value : []);
  if (!addresses.length) throw new Error('This domain could not be resolved. Check the address and try again.');
  if (addresses.some(ip => !publicAddress(ip))) throw new Error('This domain points to a private or reserved address.');
  return addresses.find(ip => !ip.includes(':')) || addresses[0];
}

// Connect to the validated address, not a second DNS lookup. Host and TLS SNI
// retain the original name, including certificate verification. Redirects go
// back through publicIp() before another connection is opened.
export async function pinnedRequest(url: URL, ip: string, timeout: number): Promise<{status:number; headers:Record<string,string>; html:string}> {
  let socket: Deno.Conn | Deno.TlsConn | undefined;
  let expired = false;
  const timer = setTimeout(() => { expired = true; try { socket?.close(); } catch {} }, timeout);
  try {
    const tcp = await Deno.connect({hostname:ip,port:url.protocol === 'https:' ? 443 : 80});
    socket = tcp;
    if(expired) throw new Error('The website took too long to respond.');
    if(url.protocol === 'https:') socket = await Deno.startTls(tcp,{hostname:url.hostname.replace(/^\[|\]$/g,''),alpnProtocols:['http/1.1']});
    const request = new TextEncoder().encode(`GET ${url.pathname + url.search} HTTP/1.1\r\nHost: ${url.host}\r\nUser-Agent: RankHarbourSEOChecker/1.0\r\nAccept: text/html,application/xhtml+xml\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`);
    let written=0;while(written<request.length)written+=await socket.write(request.subarray(written));
    const chunks: Uint8Array[]=[];let size=0;let headerEnd=-1;let status=0;const headers: Record<string,string>={};
    let combined=new Uint8Array(0);
    while(true){
      const buffer=new Uint8Array(32768);const n=await socket.read(buffer);if(n===null)break;
      size+=n;if(size>2_100_000)throw new Error('This page exceeds the 2 MB HTML evaluation limit.');
      chunks.push(buffer.slice(0,n));
      if(headerEnd<0){
        combined=new Uint8Array(size);let pos=0;for(const chunk of chunks){combined.set(chunk,pos);pos+=chunk.length;}
        for(let i=0;i<combined.length-3;i++)if(combined[i]===13&&combined[i+1]===10&&combined[i+2]===13&&combined[i+3]===10){headerEnd=i+4;break;}
        if(headerEnd<0){if(size>65536)throw new Error('Website response headers are too large.');continue;}
        const lines=new TextDecoder().decode(combined.subarray(0,headerEnd-4)).split('\r\n');
        status=Number(lines.shift()?.match(/^HTTP\/1\.[01] (\d{3})/)?.[1]||0);
        for(const line of lines){const split=line.indexOf(':');if(split>0){const key=line.slice(0,split).toLowerCase();const v=line.slice(split+1).trim();headers[key]=headers[key]?headers[key]+', '+v:v;}}
        if(status>=300&&status<400)return {status,headers,html:''};
        if(status<200||status>=300)throw new Error(`The website returned HTTP ${status}. It may block automated checks or require login.`);
        if(!/text\/html|application\/xhtml\+xml/i.test(headers['content-type']||''))throw new Error('The address must return an HTML webpage.');
        if(headers['content-encoding']&&headers['content-encoding']!=='identity')throw new Error('This website returned unsupported compression. Try another page.');
      }
    }
    if(headerEnd<0)throw new Error('The website returned an incomplete response.');
    combined=new Uint8Array(size);let pos=0;for(const chunk of chunks){combined.set(chunk,pos);pos+=chunk.length;}
    let body: Uint8Array=combined.subarray(headerEnd);
    if(/chunked/i.test(headers['transfer-encoding']||''))body=decodeChunks(body);
    else if(headers['content-length']&&Number(headers['content-length'])!==body.length)throw new Error('The website response was incomplete. Try again.');
    if(body.length>2_000_000)throw new Error('This page exceeds the 2 MB HTML evaluation limit.');
    const charset=headers['content-type'].match(/charset=["']?([^;\s"']+)/i)?.[1]||'utf-8';
    let html:string;try{html=new TextDecoder(charset).decode(body);}catch{html=new TextDecoder().decode(body);}
    return {status,headers,html};
  }catch(error){
    if(expired)throw new Error('The website took too long to respond. Try again later.');
    throw error;
  }finally{clearTimeout(timer);try{socket?.close();}catch{}}
}

export function decodeChunks(input:Uint8Array):Uint8Array {
  let offset=0,total=0;const chunks:Uint8Array[]=[];
  while(offset<input.length){
    let end=offset;while(end<input.length-1&&!(input[end]===13&&input[end+1]===10))end++;
    const sizeText=new TextDecoder().decode(input.subarray(offset,end)).split(';')[0];
    if(!/^[0-9a-f]+$/i.test(sizeText))throw new Error('Invalid chunked website response.');
    const size=parseInt(sizeText,16);offset=end+2;
    if(size===0){const result=new Uint8Array(total);let p=0;for(const chunk of chunks){result.set(chunk,p);p+=chunk.length;}return result;}
    if(offset+size+2>input.length||input[offset+size]!==13||input[offset+size+1]!==10)throw new Error('Incomplete chunked website response.');
    chunks.push(input.subarray(offset,offset+size));total+=size;offset+=size+2;
  }
  throw new Error('Incomplete website response.');
}

export async function fetchPage(input: string) {
  const original = targetUrl(input);
  let url = original;
  const deadline = Date.now() + 18000;
  for (let hop = 0; hop < 5; hop++) {
    const remaining = deadline - Date.now();
    if (remaining < 100) throw new Error('The website took too long to respond.');
    let timer: ReturnType<typeof setTimeout>;
    const ip = await Promise.race([publicIp(url), new Promise<never>((_,reject) => { timer=setTimeout(()=>reject(new Error('Domain lookup timed out.')),remaining); })]).finally(()=>clearTimeout(timer));
    const response = await pinnedRequest(url,ip,Math.max(100,deadline-Date.now()));
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (typeof location !== 'string') throw new Error('The website returned a redirect without a destination.');
      url = targetUrl(new URL(location,url).href); continue;
    }
    return {...response,url:original.href,finalUrl:url.href};
  }
  throw new Error('The website redirected too many times. Enter the final page address.');
}
