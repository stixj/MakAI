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
const ascii=s=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/ß/g,'ss');
export function canonicalId(company,title,location='') {
  const gender=/(?<!\w)(?:m\s*[/\\]\s*z|f\s*[/\\]\s*m|m\s*[/\\]\s*f|m\s*[/\\]\s*w\s*[/\\]\s*d)(?!\w)/g;
  const employment=/\b(?:full[\s-]*time|part[\s-]*time|(?:plny|plneho|zkraceny|zkraceneho|castecny|castecneho|polovicni|polovicniho)\s+uvaz(?:ek|ku)|hpp|vpp|dpp|dpc)\b/g;
  const c=ascii(company).replace(/(?<!\w)(?:spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.?\s*s\.?)(?!\w)/g,'').replace(/[^a-z0-9]/g,'');
  const t=ascii(title).replace(/\(([^()]*)\)/g,(_,inside)=>{const cleaned=inside.trim().replace(gender,'').replace(employment,'').replace(/\bico\b/g,'').replace(/\bvhodne\s+pro\s+absolventy\b/g,'');return !cleaned.replace(/[\s,;/+-]/g,'')?' ':'('+cleaned+')';}).replace(gender,'').replace(employment,'').replace(/[^a-z0-9+#]+/g,' ').trim();
  if(!c||!t)throw new UserError('Doplň firmu a název pozice.');
  const parts=[c,t,ascii(location).replace(/[^a-z0-9]+/g,' ').trim()]; return 'job-v1-'+createHash('sha256').update(JSON.stringify(parts)).digest('hex');
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
const decode=s=>String(s||'').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g,e=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'",'&nbsp;':' '})[e]).replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';});
const plain=s=>decode(String(s||'').replace(/<br\s*\/?s*>|<\/(?:p|div|li|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'')).trim();
export function parseOfferHtml(html,url) {
  const postings=[];
  const visit=value=>{if(!value||typeof value!=='object')return;if(Array.isArray(value)){value.forEach(visit);return;}if([value['@type']].flat().includes('JobPosting'))postings.push(value);else for(const key of ['@graph','mainEntity'])visit(value[key]);};
  for(const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(match[1]));}catch{}
  const job=postings[0];
  if(job){const address=[job.jobLocation].flat()[0]?.address;const salary=job.baseSalary?.value;return {url,title:plain(job.title).slice(0,300),company:plain(job.hiringOrganization?.name).slice(0,300),location:plain(typeof address==='string'?address:address?.addressLocality).slice(0,300),salary_raw:salary?plain([salary.minValue??salary.value,salary.maxValue,job.baseSalary.currency,salary.unitText].filter(v=>v!=null).join(' – ')).slice(0,300):'',raw_description:plain(job.description).slice(0,30000)};}
  return {url,title:plain(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]).slice(0,300),company:'',location:'',salary_raw:'',raw_description:''};
}
export async function previewOffer(value,{resolver=lookup,transport=download}={}) {
  let current=normalizedUrl(value);
  if (!current) throw new UserError('Vlož odkaz na nabídku.');
  try{
    for(let attempt=0;attempt<4;attempt++){
      const url=new URL(current);if(url.protocol!=='https:')throw new Error();
      const host=url.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await resolver(host,{all:true});
      if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new Error();
      const response=await transport(url,addresses[0]);
      if(response.redirect){current=normalizedUrl(new URL(response.redirect,url).href);continue;}
      return {offer:parseOfferHtml(response.html,normalizedUrl(value)),notice:'Údaje z odkazu zkontroluj a doplň před uložením.'};
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
    const candidates=[...(exists?(await db.execute('SELECT offer_id,offer FROM '+table)).rows:[]),...(await db.execute({sql:'SELECT offer_id,offer FROM makai_manual_offers WHERE profile_id=?',args:[input.profileId]})).rows];
    const edits=await offerEdits(db,input.profileId);
    const effectiveCandidates=candidates.flatMap(row=>[row,applyOfferEdit(row,edits)]);
    const duplicate=effectiveCandidates.find(row=>{const saved=JSON.parse(row.offer);return saved.canonical_id===canonical_id||canonicalId(saved.company,saved.title,saved.location||'')===canonical_id||url&&[saved.url,...getOfferSources(saved).map(s=>s.url)].some(link=>link&&normalizedUrl(link)===url);});
    if(duplicate)return {duplicate:true,offerId:duplicate.offer_id,offer:JSON.parse(duplicate.offer)};
    const id='manual-'+randomUUID();const payload={id,title:offer.title.trim(),company:offer.company.trim(),location:offer.location.trim()||null,salary_raw:offer.salary_raw.trim()||null,url,raw_description:offer.raw_description.trim(),published_at:null,canonical_id,sources:url?[{portal:new URL(url).hostname,url}]:[]};
    await db.execute({sql:'INSERT INTO makai_manual_offers(profile_id,offer_id,offer,created_at) VALUES(?,?,?,?)',args:[input.profileId,id,JSON.stringify(payload),store.now().toISOString()]});
    await db.execute({sql:'INSERT INTO makai_job_states(profile_id,offer_id,saved,applied,hidden,updated_at) VALUES(?,?,1,?,0,?)',args:[input.profileId,id,Number(input.applied),store.now().toISOString()]});
    if(input.applied){await db.execute({sql:'INSERT INTO makai_applications(profile_id,offer_id,payload) VALUES(?,?,?)',args:[input.profileId,id,JSON.stringify(application)]});await appendEvent(store,db,input.profileId,id,'applied',{appliedAt});}
    return {duplicate:false,offerId:id,offer:payload};
  });
}
