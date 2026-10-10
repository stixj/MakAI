import {offerEdits,applyOfferEdit} from './offerEditing.js';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { getOfferSources } from '../src/lib/jobs.js';
import { UserError } from './cloudStore.js';
import { assertActive, offerRow, manualRows, appendEvent, blankApplication, validateApplication } from './applicationStore.js';
import { profileTable } from './cloudProfile.js';

export function normalizedUrl(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2000) throw new UserError('Odkaz může mít nejvýše 2000 znaků.');
  let url; try {url=new URL(value);}catch{throw new UserError('Vlož platný odkaz na nabídku.');}
  if (!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&!['80','443'].includes(url.port)) throw new UserError('Použij veřejný HTTP nebo HTTPS odkaz.');
  url.hash=''; for(const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key))url.searchParams.delete(key);
  url.searchParams.sort(); url.pathname=url.pathname.replace(/\/+$/,'')||'/'; return url.href;
}
const ascii=s=>s.normalize('NFKD').toLowerCase().replace(/\u00df/g,'ss').replace(/[\u0300-\u036f]/g,'');
export function canonicalId(company,title,location='') {
  const gender=/(?<!\w)(?:m\s*[\/\\]\s*z|f\s*[\/\\]\s*m|m\s*[\/\\]\s*f|m\s*[\/\\]\s*w\s*[\/\\]\s*d)(?!\w)/g;
  const employment=/\b(?:full[\s-]*time|part[\s-]*time|(?:plny|plneho|zkraceny|zkraceneho|castecny|castecneho|polovicni|polovicniho)\s+uvaz(?:ek|ku)|hpp|vpp|dpp|dpc)\b/g;
  const admin=new RegExp(`(?:${employment.source}|\\bico\\b)`,'g');
  const graduates=/\bvhodne\s+pro\s+absolventy\b/g;
  const c=ascii(company).replace(/(?<!\w)(?:spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?)(?!\w)/g,'').replace(/[^a-z0-9]/g,'');
  const t=ascii(title).replace(/\(([^()]*)\)/g,(_,inside)=>{const cleaned=inside.trim().replace(gender,'').replace(admin,'').replace(graduates,'');return !cleaned.replace(/[\s,;\/+\-]/g,'')?' ':'('+cleaned+')';}).replace(gender,'').replace(employment,'');
  const normalizedTitle=t.replace(/[^a-z0-9+#]+/g,' ').trim().replace(/\s+/g,' ');
  if(!c||!normalizedTitle)throw new UserError('Dopl\u0148 firmu a n\u00e1zev pozice.');
  const normalizedLocation=ascii(location).replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  return 'job-v1-'+createHash('sha256').update(JSON.stringify([c,normalizedTitle,normalizedLocation])).digest('hex');
}
export function publicAddress(address) {
  if(isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a>=224||a===198&&(b===18||b===19));}
  // Allow global unicast IPv6 only; mapped, local, multicast and transition ranges stay blocked.
  return isIP(address)===6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^(2001:(?:db8|0|10|20):|2002:)/i.test(address);
}
async function download(url,address) {
  return new Promise((resolve,reject)=>{
    const req=https.get(url,{lookup:(_host,options,callback)=>options.all ? callback(null,[address]) : callback(null,address.address,address.family),headers:{'User-Agent':'MakAI/1.0 (job offer import)','Accept':'text/html'},timeout:8000},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){response.resume();return resolve({redirect:response.headers.location});}
      if(response.statusCode!==200||!/^text\/html(?:;|$)/i.test(response.headers['content-type']||'')){response.resume();return reject(new Error('Unavailable'));}
      const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>1000000){req.destroy(new Error('Too large'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve({html:Buffer.concat(chunks).toString('utf8')}));
    }); req.on('timeout',()=>req.destroy(new Error('Timeout')));req.on('error',reject);
  });
}
async function resourceRequest(url,address,{method='GET',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const req=https.request(url,{method,lookup:(_host,options,callback)=>options.all?callback(null,[address]):callback(null,address.address,address.family),headers:{'User-Agent':'MakAI/1.0 (job offer import)','Accept':'*/*',...headers},timeout:8000},response=>{
      if([301,302,303,307,308].includes(response.statusCode)){response.resume();return resolve({redirect:response.headers.location,statusCode:response.statusCode});}
      const chunks=[];let size=0;response.on('data',chunk=>{size+=chunk.length;if(size>2000000){req.destroy(new Error('Too large'));return;}chunks.push(chunk);});response.on('error',reject);response.on('end',()=>resolve({statusCode:response.statusCode,body:Buffer.concat(chunks).toString('utf8')}));
    });req.on('timeout',()=>req.destroy(new Error('Timeout')));req.on('error',reject);req.end(body);
  });
}
async function fetchPublicResource(value,options={},resolver=lookup,request=resourceRequest) {
  let current=normalizedUrl(value);
  for(let attempt=0;attempt<4;attempt++){
    const url=new URL(current);if(url.protocol!=='https:')throw new Error('HTTPS required');
    const host=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true});
    if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('Unsafe address');
    const response=await request(url,addresses[0],options);
    if(response.redirect){if(options.method&&options.method!=='GET')throw new Error('Unexpected redirect');current=normalizedUrl(new URL(response.redirect,url).href);continue;}
    if(response.statusCode!==200)throw new Error('Resource unavailable');
    return response.body;
  }
  throw new Error('Too many redirects');
}
const LMC_DETAIL_QUERY=`query GetOffer($widgetId: ID!, $jobAdId: ID!, $rps: Int) {
  widget(id: $widgetId) {
    jobAd(id: $jobAdId, rps: $rps) {
      id title content { htmlContent }
      employer { companyName }
      locations { city region country }
      salary { min max period currency }
    }
  }
}`;
async function lmcJobPosting(html,pageUrl,{resolver=lookup,fetchResource=fetchPublicResource}={}) {
  const page=new URL(pageUrl);
  if(!/(?:^|\.)jobs\.cz$/i.test(page.hostname))return null;
  const id=page.searchParams.get('id');if(!id||!/^\d+$/.test(id))return null;
  const scriptPath=[...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi)].map(match=>match[2]).find(src=>/\/assets\/js\/script\.min\.js(?:\?|$)/.test(src));
  if(!scriptPath)return null;
  const scriptUrl=new URL(scriptPath,page).href;
  const script=await fetchResource(scriptUrl,{},resolver);
  const widget=script.match(/"main-(?:cs|en)"\s*:\s*\{"id":"([^"]+)"\s*,\s*"apiKey":"([a-f\d]+)"/i);
  if(!widget)return null;
  const rps=Number(page.searchParams.get('rps'));
  const payload=JSON.stringify({query:LMC_DETAIL_QUERY,variables:{widgetId:widget[1],jobAdId:id,...(Number.isInteger(rps)&&rps>0?{rps}:{})}});
  const result=await fetchResource('https://api.capybara.lmc.cz/api/graphql/widget',{method:'POST',headers:{'Content-Type':'application/json','X-API-KEY':widget[2]},body:payload},resolver);
  const job=JSON.parse(result).data?.widget?.jobAd;
  if(!job?.title||!job?.content?.htmlContent)return null;
  const description=plain(withoutNoise(job.content.htmlContent)).slice(0,30000);
  const location=(job.locations||[]).map(item=>[item.city,item.region,item.country].filter(Boolean).join(', ')).filter(Boolean).join(' / ');
  const salary=job.salary||{};
  const salaryRaw=[salary.min,salary.max].filter(value=>value!=null&&value!=='').join(' - ')+(salary.currency?' '+salary.currency:'')+(salary.period?' / '+salary.period:'');
  return {title:plain(job.title).slice(0,300),company:plain(job.employer?.companyName||'').slice(0,300),location:plain(location).slice(0,300),salary_raw:plain(salaryRaw).slice(0,300),raw_description:description};
}
const decode=s=>String(s||'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[e]).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';});
const plain=s=>decode(String(s||'').replace(/<br\s*\/?s*>|<\/(?:p|div|li|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'')).trim();
const withoutNoise=html=>String(html||'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'');
function elementContents(html,tags){
  const found=[];
  const opening=new RegExp(`<(${tags})\\b([^>]*)>`,'gi');let match;
  while((match=opening.exec(html))){const tag=match[1], start=opening.lastIndex, token=new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi');token.lastIndex=start;let depth=1,end=-1,next;
    while((next=token.exec(html))){if(next[0][1]==='/')depth--;else if(!next[0].endsWith('/>'))depth++;if(depth===0){end=next.index;break;}}
    if(end>=0){found.push({tag,attrs:match[2],html:html.slice(start,end)});opening.lastIndex=token.lastIndex;}
  }
  return found;
}
function metaContent(html,key){
  for(const tag of html.matchAll(/<meta\b[^>]*>/gi)){const attrs=Object.fromEntries([...tag[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)].map(m=>[m[1].toLowerCase(),m[3]]));if((attrs.property||attrs.name||'').toLowerCase()===key)return plain(attrs.content||'');}
  return '';
}
function fallbackPosting(html,url){
  const clean=withoutNoise(html);const blocks=elementContents(clean,'main|article');
  let description=blocks.map(item=>plain(item.html)).filter(text=>text.length>80).sort((a,b)=>b.length-a.length)[0]||'';
  if(!description){const candidates=elementContents(clean,'div|section').filter(item=>/(?:job[-_ ]?(?:description|content|detail)|offer[-_ ]?(?:content|detail)|career[-_ ]?(?:description|detail))/i.test(item.attrs));description=candidates.map(item=>plain(item.html)).filter(Boolean).sort((a,b)=>b.length-a.length)[0]||'';}
  if(!description)description=plain(clean.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]||'');
  const pageTitle=metaContent(clean,'og:title')||plain(clean.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  let title=pageTitle,company='';
  const at=pageTitle.match(/^(.+?)\s+\bat\s+(.+)$/i);
  const parts=pageTitle.split(/\s+(?:\||\u2013|\u2014|-)\s+/).map(part=>part.trim()).filter(Boolean);
  if(at){title=at[1];company=at[2];}
  else if(parts.length>=2){title=parts[0];company=parts[1];}
  const genericTitle=/^(?:detail pozice|position detail|job details?|career|careers|volne pozice|jobs)(?:\s*[|–—-].*)?$/i;
  const heading=elementContents(clean,'h1').map(item=>plain(item.html)).find(text=>text&&!genericTitle.test(text));
  if(genericTitle.test(title))title=heading||'';
  if(!company)company=metaContent(clean,'og:site_name');
  if(!company){const parts=new URL(url).hostname.split('.');const brand=parts[0];if(parts.length>2&&brand&&!new Set(['www','jobs','prace','jenprace','pracezarohem','job','career']).has(brand.toLowerCase()))company=brand.charAt(0).toUpperCase()+brand.slice(1);}
  const shellText=description.replace(/\s+/g,' ').trim();
  const portalChrome=/^(?:pro\u010d\s+notino\b.*\bvoln\u00e9 pozice\b.*\bkontakty\b.*\ben\b)/i.test(shellText)&&!heading;
  const meaningfulDescription=description.length>=80&&!portalChrome;
  if(!meaningfulDescription)description='';
  const locationNode=elementContents(clean,'div|span|p|li').filter(item=>/(?:job[-_ ]?location|workplace|lokalita|misto-pracoviste)/i.test(item.attrs)).map(item=>plain(item.html)).find(Boolean)||'';
  const location=metaContent(clean,'job:location:locality')||metaContent(clean,'og:locality')||(meaningfulDescription?locationNode||description.match(/\b(?:Brno|Praha|Ostrava|Plze\u0148|Liberec|Olomouc|Pardubice|Zl\u00edn|Remote|Home office|\u010cesk\u00e1 republika|cel\u00e1 \u010cR)\b/i)?.[0]||'':'');
  const salary=description.match(/(?:\d[\d\s\u00a0]*(?:\s*(?:-|\u2013|\u2014|a\u017e|to)\s*\d[\d\s\u00a0]*)?\s*(?:K\u010d|CZK|EUR|\u20ac|USD|\$)(?:\s*(?:\/|m\u011bs\u00ed\u010dn\u011b|m\u011bs\u00edc|ro\u010dn\u011b|rok|hod\.))?)/i)?.[0]||'';
  return {title:title.slice(0,300),company:company.slice(0,300),location:location.slice(0,300),salary_raw:(meaningfulDescription?salary:'').trim().slice(0,300),raw_description:description.slice(0,30000)};
}
export function parseOfferHtml(html,url) {
  const postings=[];
  const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}if([value['@type']].flat().includes('JobPosting'))postings.push(value);else for(const key of ['@graph','mainEntity'])visit(value[key]);};
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(match[1]));}catch{}
  const job=postings[0];
  if(job){const addresses=[job.jobLocation].flat().map(place=>place?.address).filter(Boolean);const location=addresses.map(address=>typeof address==='string'?address:[address.addressLocality,address.addressRegion,address.addressCountry?.name||address.addressCountry].filter(Boolean).join(', ')).filter(Boolean).join(' / ')||(job.jobLocationType==='TELECOMMUTE'?'Remote':'');const salary=job.baseSalary?.value;const salaryText=typeof salary==='object'&&salary? [salary.minValue??salary.value,salary.maxValue,job.baseSalary.currency,salary.unitText].filter(v=>v!=null).join(' - '):[salary,job.baseSalary?.currency,job.baseSalary?.unitText].filter(v=>v!=null).join(' ');return {url,title:plain(job.title).slice(0,300),company:plain(job.hiringOrganization?.name).slice(0,300),location:plain(location).slice(0,300),salary_raw:plain(salaryText).slice(0,300),raw_description:plain(withoutNoise(job.description)).slice(0,30000)};}
  const fallback=fallbackPosting(html,url);
  return {url,title:fallback.title,company:fallback.company,location:fallback.location,salary_raw:fallback.salary_raw,raw_description:fallback.raw_description};
}
export async function previewOffer(value,{resolver=lookup,transport=download,fetchResource=fetchPublicResource}={}) {
  let current=normalizedUrl(value);
  if (!current) throw new UserError('Vlož odkaz na nabídku.');
  try{
    for(let attempt=0;attempt<4;attempt++){
      const url=new URL(current);if(url.protocol!=='https:')throw new Error();
      const host=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true});
      if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error();
      const response=await transport(url,addresses[0]);
      if(response.redirect){current=normalizedUrl(new URL(response.redirect,url).href);continue;}
      const offer=parseOfferHtml(response.html,normalizedUrl(value));
      if(!offer.raw_description.trim())try{const posting=await lmcJobPosting(response.html,url.href,{resolver,fetchResource});if(posting)Object.assign(offer,posting,{url:normalizedUrl(value)});}catch{}
      const incomplete=!offer.raw_description.trim();
      return {offer,notice:incomplete?'Str\u00e1nka na\u010d\u00edt\u00e1 obsah a\u017e po spu\u0161t\u011bn\u00ed JavaScriptu. Nab\u00eddka zat\u00edm nebyla ulo\u017eena; dopl\u0148 n\u00e1zev a text inzer\u00e1tu ru\u010dn\u011b.':offer.company?'\u00dadaje z odkazu zkontroluj a dopl\u0148 p\u0159ed ulo\u017een\u00edm.':'Firma nebyla rozpozn\u00e1na. Dopl\u0148 ji ru\u010dn\u011b; text inzer\u00e1tu z\u016fstal na\u010dten\u00fd.'};
    }
  }catch{}
  return {offer:{url:normalizedUrl(value),title:'',company:'',location:'',salary_raw:'',raw_description:''},notice:'Údaje se nepodařilo načíst. Nabídku můžeš doplnit ručně.'};
}
export async function addOffer(store,input) {
  const offer=input?.offer;
  if(!offer||['title','company','location','salary_raw','raw_description'].some(key=>typeof offer[key]!=='string'||offer[key].length>(key==='raw_description'?30000:300))||!offer.title.trim()||!offer.company.trim())throw new UserError('Doplň název pozice a firmu.');
  const url=normalizedUrl(offer.url);
  const appliedAt=input.appliedAt==null?null:validateApplication({...blankApplication(),appliedAt:input.appliedAt}).appliedAt;
  if(typeof input.applied!=='boolean')throw new UserError('Neplatný stav reakce.');
  const application=validateApplication({...blankApplication(),appliedAt,salaryExpectation:input.salaryExpectation??'',reactionDetails:input.reactionDetails??''});
  const canonical_id=canonicalId(offer.company,offer.title,offer.location);
  return store.transaction(async db=>{
    await assertActive(store,db,input.profileId);
    const table=profileTable(input.profileId),exists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length;
    const candidates=[...(exists?(await db.execute('SELECT offer_id,offer,evaluation FROM '+table)).rows:[]),...(await db.execute({sql:'SELECT offer_id,offer,evaluation FROM makai_manual_offers WHERE profile_id=?',args:[input.profileId]})).rows.map(row=>({...row,manual:true}))];
    const edits=await offerEdits(db,input.profileId);
    const effectiveCandidates=candidates.flatMap(row=>[row,applyOfferEdit(row,edits)]);
    const duplicate=effectiveCandidates.find(row=>{const saved=JSON.parse(row.offer);return saved.canonical_id===canonical_id||canonicalId(saved.company,saved.title,saved.location||'')===canonical_id||url&&[saved.url,...getOfferSources(saved).map(s=>s.url)].some(link=>link&&normalizedUrl(link)===url);});
    if(duplicate){
      const existing=JSON.parse(duplicate.offer),sameUrl=url&&[existing.url,...getOfferSources(existing).map(source=>source.url)].some(link=>link&&normalizedUrl(link)===url);
      if(duplicate.manual&&duplicate.evaluation==null&&!duplicate.offerEdited&&sameUrl&&offer.raw_description.trim().length>(existing.raw_description||'').length){
        const refreshed={...existing,title:offer.title.trim(),company:offer.company.trim(),location:offer.location.trim()||null,salary_raw:offer.salary_raw.trim()||null,url,raw_description:offer.raw_description.trim(),canonical_id,sources:[{portal:new URL(url).hostname,url}]};
        await db.execute({sql:'UPDATE makai_manual_offers SET offer=? WHERE profile_id=? AND offer_id=?',args:[JSON.stringify(refreshed),input.profileId,duplicate.offer_id]});
        return {duplicate:false,updated:true,offerId:duplicate.offer_id,offer:refreshed};
      }
      return {duplicate:true,offerId:duplicate.offer_id,offer:existing};
    }
    const id='manual-'+randomUUID();const payload={id,title:offer.title.trim(),company:offer.company.trim(),location:offer.location.trim()||null,salary_raw:offer.salary_raw.trim()||null,url,raw_description:offer.raw_description.trim(),published_at:null,canonical_id,sources:url?[{portal:new URL(url).hostname,url}]:[]};
    await db.execute({sql:'INSERT INTO makai_manual_offers(profile_id,offer_id,offer,created_at) VALUES(?,?,?,?)',args:[input.profileId,id,JSON.stringify(payload),store.now().toISOString()]});
    await db.execute({sql:'INSERT INTO makai_job_states(profile_id,offer_id,saved,applied,hidden,updated_at) VALUES(?,?,1,?,0,?)',args:[input.profileId,id,Number(input.applied),store.now().toISOString()]});
    if(input.applied){await db.execute({sql:'INSERT INTO makai_applications(profile_id,offer_id,payload) VALUES(?,?,?)',args:[input.profileId,id,JSON.stringify(application)]});await appendEvent(store,db,input.profileId,id,'applied',{appliedAt});}
    return {duplicate:false,offerId:id,offer:payload};
  });
}
