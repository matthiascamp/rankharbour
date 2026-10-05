/// <reference lib="dom" />
import { parseHTML } from 'npm:linkedom@0.18.12';

export function analyse(page: {html:string;url:string;finalUrl:string;status:number;headers:Record<string,unknown>}) {
  const { document } = parseHTML(page.html);
  const clean = (s: string | null | undefined) => (s || '').replace(/\s+/g,' ').trim();
  const clip = (s: string) => s.slice(0,1000);
  const metas = [...document.querySelectorAll('meta')];
  const meta = (name: string) => clean(metas.find(e=>(e.getAttribute('name') || '').toLowerCase()===name)?.getAttribute('content'));
  const title = clean(document.querySelector('title')?.textContent);
  const description = meta('description');
  const h1s = [...document.querySelectorAll('h1')].filter(e=>clean(e.textContent));
  const images = [...document.querySelectorAll('img')];
  const missingAlt = images.filter(e=>!e.hasAttribute('alt')).length;
  const emptyAlt = images.filter(e=>e.hasAttribute('alt')&&!clean(e.getAttribute('alt'))).length;
  const canonical = [...document.querySelectorAll('link')].find(e=>(e.getAttribute('rel')||'').toLowerCase().split(/\s+/).includes('canonical'))?.getAttribute('href') || '';
  let canonicalUrl = '';
  try { if(canonical) { const c=new URL(canonical,page.finalUrl);if(['http:','https:'].includes(c.protocol))canonicalUrl=c.href; } } catch { /* invalid URL reported */ }
  const directives = [meta('robots'),meta('googlebot'),String(page.headers['x-robots-tag']||'')].join(' ').toLowerCase();
  const noindex = /\b(noindex|none)\b/.test(directives);
  const viewport = meta('viewport');
  const lang = clean(document.documentElement.getAttribute('lang'));
  const scripts = [...document.querySelectorAll('script')].filter(e=>(e.getAttribute('type')||'').toLowerCase()==='application/ld+json');
  let invalidJson = 0;
  for (const script of scripts) { try { JSON.parse(script.textContent || ''); } catch { invalidJson++; } }
  let internalLinks=0,externalLinks=0;
  for(const a of document.querySelectorAll('a[href]')) {
    try { const u=new URL(a.getAttribute('href')!,page.finalUrl);if(!['http:','https:'].includes(u.protocol))continue;
      if(u.origin===new URL(page.finalUrl).origin)internalLinks++;else externalLinks++;
    } catch { /* skip malformed links */ }
  }
  document.querySelectorAll('script,style,noscript,template').forEach(e=>e.remove());
  const words=clean(document.body?.textContent || document.documentElement.textContent).split(/\s+/).filter(Boolean).length;
  const checks: {id:string;label:string;status:'pass'|'warn'|'fail';detail:string;recommendation:string}[]=[];
  const add=(id:string,label:string,status:'pass'|'warn'|'fail',detail:string,recommendation:string)=>checks.push({id,label,status,detail:clip(detail),recommendation});
  add('https','HTTPS',page.finalUrl.startsWith('https:')?'pass':'fail',`Final URL: ${page.finalUrl}`,'Use HTTPS with a valid certificate and redirect HTTP visitors to HTTPS.');
  add('title','Page title',!title?'fail':title.length<20||title.length>65?'warn':'pass',title?`${title.length} characters: ${title}`:'No non-empty title element found.','Use a unique, descriptive title. Around 20–65 characters is a review guideline, not a Google limit.');
  add('description','Meta description',!description?'warn':description.length<70||description.length>170?'warn':'pass',description?`${description.length} characters: ${description}`:'No meta description found.','Write a useful page summary. 70–170 characters is a review guideline; Google may generate a different snippet.');
  add('h1','Main heading',h1s.length===1?'pass':!h1s.length?'fail':'warn',`${h1s.length} non-empty H1 heading(s). ${h1s.map(e=>clean(e.textContent)).join(' / ')}`,'Make the main subject clear with a descriptive main heading. Multiple H1s are a review prompt, not an automatic ranking penalty.');
  add('canonical','Canonical URL',!canonical?'warn':!canonicalUrl?'fail':canonicalUrl===page.finalUrl?'pass':'warn',canonicalUrl?`Canonical: ${canonicalUrl}`:canonical?'Invalid canonical URL.':'No canonical link found.','Specify the preferred indexable URL. Review canonicals pointing at another page; this can be intentional.');
  add('indexing','Page indexing directives',noindex?'fail':'pass',noindex?`Indexing restriction found: ${directives}`:'No noindex directive found in robots/googlebot metadata or X-Robots-Tag.','If this page should appear in search, remove unintended noindex directives. Absence does not prove Google has indexed the page.');
  add('viewport','Mobile viewport',/width\s*=\s*device-width/i.test(viewport)?'pass':'warn',viewport||'No viewport meta tag found.','Include width=device-width and verify the rendered mobile layout separately.');
  add('language','Document language',lang?'pass':'warn',lang?`HTML language: ${lang}`:'No HTML lang attribute found.','Declare the correct language on the HTML element for accessibility and language handling.');
  add('alt','Image alt attributes',missingAlt?'warn':'pass',`${images.length} images; ${missingAlt} missing alt attributes; ${emptyAlt} empty alt attributes.`,'Give meaningful images descriptive alt text. An empty alt is appropriate for decorative images.');
  add('structured','Structured data JSON',invalidJson?'fail':scripts.length?'pass':'warn',`${scripts.length} JSON-LD blocks; ${invalidJson} invalid JSON blocks.`,'Use applicable structured data and validate with Google Rich Results Test. Valid JSON alone does not establish schema validity or eligibility.');
  add('content','HTML text content',words>=100?'pass':'warn',`${words} approximate words in the source HTML, including navigation and footer.`,'Review whether the page answers its audience’s needs. Word count is context only, not a ranking target; JavaScript-only text is not counted.');
  add('links','Internal links',internalLinks?'pass':'warn',`${internalLinks} internal and ${externalLinks} external HTTP(S) links found.`,'Link to relevant pages with useful anchor text. Destinations and broken links are not crawled in this check.');
  const summary={passed:checks.filter(c=>c.status==='pass').length,warnings:checks.filter(c=>c.status==='warn').length,failed:checks.filter(c=>c.status==='fail').length};
  return {url:page.url,finalUrl:page.finalUrl,status:page.status,checkedAt:new Date().toISOString(),
    score:Math.round((summary.passed+summary.warnings*0.5)/checks.length*100),summary,checks,
    metrics:{title:clip(title),description:clip(description),h1Count:h1s.length,wordCount:words,imageCount:images.length,missingAltCount:missingAlt,internalLinks,externalLinks},
    limitations:['Single public page, server HTML only; JavaScript is not executed and other pages are not crawled.',
      'Checklist score: equal-weight checks, pass = 1, review = 0.5, issue = 0. It is not a Google score, ranking prediction, or complete SEO audit.',
      'No Search Console/Analytics data, search rankings, backlinks, Core Web Vitals, robots.txt or sitemap validation is included.',
      'Bot protections, redirects and server-rendered content can differ from what a visitor or Google receives. Findings require human review.']};
}
