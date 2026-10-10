import {Star} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { profileApi } from '../lib/profileApi.js';
import { APPLICATION_STATUSES, CLOSED_STATUSES, applicationSummary, applicationNextStep, formatInterviewDate } from '../lib/applications.js';
import { formatDate } from '../lib/jobs.js';
import ApplicationDetail from './ApplicationDetail.jsx';
import SelectMenu from './SelectMenu.jsx';
export default function ApplicationsPanel({profileId,reloadKey,selectedOffer,onSelected,onChanged}) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState('active'),[priorityFirst,setPriorityFirst]=useState(false),[priorityBusy,setPriorityBusy]=useState(null),[statusBusy,setStatusBusy]=useState(null),[statusSaved,setStatusSaved]=useState(null);
  useEffect(()=>{let alive=true;setItems([]);setLoading(true);setError('');profileApi('/api/applications').then(result=>{if(alive){setItems(result.items);setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});return()=>{alive=false;};},[profileId,reloadKey]);
  const summary=useMemo(()=>applicationSummary(items),[items]);
  const visible=items.filter(item=>{
    const closed=CLOSED_STATUSES.includes(item.application.status);
    if (filter==='priority') return !!item.interest?.priority;
    if (filter==='all') return true;
    if (filter==='closed') return closed;
    if (closed) return false;
    if (filter==='waiting') return item.application.status==='waiting';
    if (filter==='tasks') return summary.tasks.some(task=>task.offerId===item.id);
    if (filter==='interviews') return summary.interviews.some(event=>event.offerId===item.id);
    return true;
  }).sort((a,b)=>priorityFirst?Number(!!b.interest?.priority)-Number(!!a.interest?.priority):0);
  const offers=items.filter(item=>['offer','accepted'].includes(item.application.status));
  async function changeStatus(item,status){
    if(status===item.application.status)return;
    setStatusBusy(item.id);setStatusSaved(null);setError('');
    try{
      const result=await profileApi('/api/applications',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId,offerId:item.id,revision:item.revision,application:{...item.application,status}})});
      setItems(previous=>previous.map(current=>current.id===item.id?{...current,application:result.application,revision:result.revision}:current));
      setStatusSaved(item.id);onChanged();setTimeout(()=>setStatusSaved(current=>current===item.id?null:current),2500);
    }catch(e){setError(e.message||'Stav se nepodařilo uložit. Zkus to znovu.');}
    finally{setStatusBusy(null);}
  }
  async function togglePriority(item){setPriorityBusy(item.id);setError('');try{await profileApi('/api/jobs',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({profileId,offerId:item.id,changes:{priority:!item.interest?.priority}})});onChanged();}catch(e){setError(e.message);}finally{setPriorityBusy(null);}}
  if (selectedOffer) return <ApplicationDetail key={profileId+':'+selectedOffer} profileId={profileId} offerId={selectedOffer} onClose={() => onSelected(null)} onChanged={onChanged} />;
  return <section aria-label="Moje přihlášky" className="mt-6">
    <p className="mt-2 text-sm text-ink-secondary">Měj přehled, kde čekáš na odpověď a co tě čeká dál. Odpovědi firem sem zapisuješ ručně.</p>
    <div className="mt-5 flex flex-wrap gap-2" aria-label="Rychlý přehled">{[['waiting','Čekám na odpověď',summary.waiting],['tasks','Otevřené kroky',summary.tasks.length],['interviews','Pohovory',summary.interviews.length]].map(([key,label,count])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(filter===key?'active':key)} className={'filter-chip ' + (filter===key?'filter-chip-active':'')}><span>{label}</span><strong className="ml-2">{count}</strong></button>)}</div>
    {(summary.tasks.length>0||summary.interviews.length>0)&&<div className="mt-4 grid gap-3 sm:grid-cols-2">
      {summary.tasks.length>0&&<div className="rounded-xl border border-border-subtle p-4"><h3 className="text-sm font-semibold">Co udělat dál</h3><ul className="mt-2 space-y-2">{summary.tasks.slice(0,3).map(t=><li key={t.offerId+t.id}><button type="button" onClick={()=>onSelected(t.offerId)} className="w-full text-left text-sm text-brand">{t.text}<span className="mt-1 block text-xs text-ink-secondary">{t.company} · {t.due?formatDate(t.due):'Bez termínu'}{t.due&&t.due<summary.day?' · Po termínu':''}</span></button></li>)}</ul></div>}
      {summary.interviews.length>0&&<div className="rounded-xl border border-border-subtle p-4"><h3 className="text-sm font-semibold">Nejbližší pohovory</h3><ul className="mt-2 space-y-2">{summary.interviews.slice(0,3).map(i=><li key={i.offerId+i.id}><button type="button" onClick={()=>onSelected(i.offerId)} className="w-full text-left text-sm text-brand">{i.company} · {i.title}<span className="mt-1 block text-xs text-ink-secondary">{new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Prague'}).format(new Date(i.at))}</span></button></li>)}</ul></div>}
    </div>}
    <div className="mt-5 flex flex-wrap gap-2">{[['active','Probíhající'],['closed','Uzavřené'],['all','Všechny'],['priority','★ Moje priority']].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} className={'filter-chip ' + (filter===key?'filter-chip-active':'')} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-ink-secondary"><input type="checkbox" checked={priorityFirst} onChange={e=>setPriorityFirst(e.target.checked)} />Moje priority první</label>
    {offers.length>0&&<details className="mt-4 rounded-xl border border-border-subtle p-4"><summary className="cursor-pointer text-sm font-semibold text-brand">Porovnat nabídky spolupráce ({offers.length})</summary>
      <div className="mt-3 space-y-3 sm:hidden">{offers.map(item=><article key={item.id} className="rounded-xl border border-border-subtle bg-white p-4">
        <button type="button" className="min-h-11 text-left font-semibold text-brand" onClick={()=>onSelected(item.id)}>{item.offer.title}<span className="mt-1 block text-sm font-normal text-ink-secondary">{item.offer.company}{item.interest?.priority?' · ★ Moje priorita':''}</span></button>
        {[['Co firma nabídla',item.application.offeredConditions],['Co jsi požadoval/a',item.application.salaryExpectation],['Co chceš ověřit',item.application.questions]].map(([label,value])=><div key={label} className="mt-3 border-t border-border-subtle pt-3"><p className="text-xs font-semibold text-ink-secondary">{label}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{value||'Zatím nedoplněno'}</p></div>)}
      </article>)}</div>
      <div className="mt-3 hidden overflow-x-auto sm:block"><table className="w-full text-left text-sm"><caption className="sr-only">Nabídnuté podmínky a otázky před rozhodnutím</caption><thead><tr>{['Pozice a firma','Co firma nabídla','Co jsem požadoval','Co chci ověřit'].map(label=><th key={label} scope="col" className="border-b border-border-subtle p-3">{label}</th>)}</tr></thead><tbody>{offers.map(item=><tr key={item.id}><th scope="row" className="border-b border-border-subtle p-3 font-medium"><button type="button" className="min-h-11 text-left text-brand" onClick={()=>onSelected(item.id)}>{item.offer.title}<span className="block text-xs">{item.offer.company}{item.interest?.priority?' · ★ Moje priorita':''}</span></button></th>{[item.application.offeredConditions,item.application.salaryExpectation,item.application.questions].map((value,index)=><td key={index} className="max-w-xs whitespace-pre-wrap break-words border-b border-border-subtle p-3 align-top">{value||'Není doplněné'}</td>)}</tr>)}</tbody></table></div>
    </details>}
    {loading&&<p role="status" className="mt-4 text-sm">Načítám přihlášky…</p>}{error&&<p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
    {!loading&&!error&&<div className="mt-5 grid gap-3 sm:grid-cols-2">{visible.map(item=>{
      const next=applicationNextStep(item.application);
      return <article key={item.id} className="flex flex-col rounded-2xl border border-border-subtle bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2 text-xs font-medium text-ink-secondary"><span>Stav</span><SelectMenu ariaLabel={'Změnit stav přihlášky: '+item.offer.title} value={item.application.status} options={Object.entries(APPLICATION_STATUSES).map(([value,label])=>({value,label}))} onChange={value=>changeStatus(item,value)} disabled={statusBusy===item.id} variant="pill" containerClassName="inline-block" />{statusSaved===item.id&&<span role="status" className="text-xs font-normal text-brand">Změna uložena</span>}</div><button type="button" disabled={priorityBusy===item.id} aria-pressed={!!item.interest?.priority} aria-label={(item.interest?.priority?'Zrušit prioritu: ':'Označit prioritu: ')+item.offer.title} onClick={()=>togglePriority(item)} className={'inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-xs '+(item.interest?.priority?'font-semibold text-brand':'text-ink-secondary')}><Star className="h-4 w-4" fill={item.interest?.priority?'currentColor':'none'} aria-hidden="true" />{item.interest?.priority?'Moje priorita':'Priorita'}</button></div>
        <h3 className="mt-2 text-lg font-semibold">{item.offer.title}</h3><p className="mt-1 text-sm text-ink-secondary">{item.offer.company}</p>
        <p className="mt-3 text-xs text-ink-secondary">{item.application.appliedAt?'Odesláno '+formatDate(item.application.appliedAt):'Datum odeslání není doplněné'}{next.daysSinceApplied!==null&&' · '+next.daysSinceApplied+' dní od odeslání'}</p>
        <div className="mt-4 flex-1 rounded-xl border border-border-subtle bg-white p-3"><p className="text-xs text-ink-secondary">{next.kind==='closed'?'Výsledek':'Další krok'}</p><p className="mt-1 text-sm font-medium">{next.text}</p>{next.at&&<p className="mt-1 text-sm text-brand">{formatInterviewDate(next.at)}</p>}{next.due&&<p className={'mt-1 text-xs '+(next.overdue?'text-danger':'text-ink-secondary')}>{next.overdue?'Po termínu · ':'Do '}{formatDate(next.due)}</p>}</div>
        <button type="button" className="button-secondary mt-4 self-start" onClick={()=>onSelected(item.id)}>Detail přihlášky</button>
      </article>;
    })}</div>}
    {!loading&&!error&&!visible.length&&<p className="mt-5 rounded-2xl border border-border-subtle p-6 text-sm text-ink-secondary">{items.length?'V tomto přehledu nejsou žádné přihlášky.':'Zatím nemáš žádné přihlášky. U nabídky označ Reagoval jsem, nebo přidej nabídku s již odeslanou reakcí.'}</p>}
    <p className="mt-5 text-xs text-ink-secondary">Pohovor si můžeš z detailu přidat do kalendáře s připomínkou 30 minut předem. Automatická upozornění MakAI při zavřené aplikaci zatím nejsou zapnutá.</p>
  </section>;
}
