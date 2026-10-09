import { useEffect, useMemo, useState } from 'react';
import { profileApi } from '../lib/profileApi.js';
import { APPLICATION_STATUSES, CLOSED_STATUSES, applicationSummary } from '../lib/applications.js';
import { formatDate } from '../lib/jobs.js';
import ApplicationDetail from './ApplicationDetail.jsx';
export default function ApplicationsPanel({profileId,reloadKey,selectedOffer,onSelected,onChanged}) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[filter,setFilter]=useState('active');
  useEffect(()=>{let alive=true;setItems([]);setLoading(true);setError('');profileApi('/api/applications').then(result=>{if(alive){setItems(result.items);setLoading(false);}}).catch(e=>{if(alive){setError(e.message);setLoading(false);}});return()=>{alive=false;};},[profileId,reloadKey]);
  const summary=useMemo(()=>applicationSummary(items),[items]);
  const visible=items.filter(item=>{
    const closed=CLOSED_STATUSES.includes(item.application.status);
    if (filter==='all') return true;
    if (filter==='closed') return closed;
    if (closed) return false;
    if (filter==='waiting') return item.application.status==='waiting';
    if (filter==='tasks') return item.application.tasks.some(task=>!task.done);
    if (filter==='interviews') return summary.interviews.some(event=>event.offerId===item.id);
    return true;
  });
  return <section aria-label="Moje přihlášky" className="mt-6">
    <h2 className="font-display text-2xl font-semibold">Moje přihlášky</h2><p className="mt-2 text-sm text-muted-foreground">Odpovědi firem eviduj ručně. Vyber přihlášku a zapiš další krok.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">{[['waiting','Čekám na odpověď',summary.waiting],['tasks','Otevřené úkoly',summary.tasks.length],['interviews','Nadcházející pohovory',summary.interviews.length]].map(([key,label,count])=><button type="button" key={key} aria-pressed={filter===key} onClick={()=>setFilter(filter===key?'active':key)} className="rounded-2xl border border-viatix-line bg-viatix-sand2 p-4 text-left"><span className="text-sm text-muted-foreground">{label}</span><strong className="mt-2 block text-2xl text-viatix-teal">{count}</strong></button>)}</div>
    {!selectedOffer&&(summary.tasks.length>0||summary.interviews.length>0)&&<div className="mt-4 grid gap-3 sm:grid-cols-2">
      {summary.tasks.length>0&&<div className="rounded-xl border border-viatix-line p-4"><h3 className="text-sm font-semibold">Co udělat dál</h3><ul className="mt-2 space-y-2">{summary.tasks.slice(0,5).map(t=><li key={t.offerId+t.id}><button type="button" onClick={()=>onSelected(t.offerId)} className="w-full text-left text-sm text-viatix-teal">{t.text}<span className="mt-1 block text-xs text-muted-foreground">{t.company} · {t.due?formatDate(t.due):'Bez termínu'}{t.due&&t.due<summary.day?' · Po termínu':''}</span></button></li>)}</ul></div>}
      {summary.interviews.length>0&&<div className="rounded-xl border border-viatix-line p-4"><h3 className="text-sm font-semibold">Nejbližší pohovory</h3><ul className="mt-2 space-y-2">{summary.interviews.slice(0,5).map(i=><li key={i.offerId+i.id}><button type="button" onClick={()=>onSelected(i.offerId)} className="w-full text-left text-sm text-viatix-teal">{i.company} · {i.title}<span className="mt-1 block text-xs text-muted-foreground">{new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Prague'}).format(new Date(i.at))}</span></button></li>)}</ul></div>}
    </div>}
    {selectedOffer&&<ApplicationDetail key={profileId+':'+selectedOffer} profileId={profileId} offerId={selectedOffer} onClose={()=>onSelected(null)} onChanged={onChanged} />}
    <div className="mt-5 flex flex-wrap gap-2">{[['active','Probíhající'],['closed','Uzavřené'],['all','Všechny']].map(([key,label])=><button type="button" key={key} aria-pressed={filter===key} className={filter===key?'button-primary':'button-secondary'} onClick={()=>setFilter(key)}>{label}</button>)}</div>
    {loading&&<p role="status" className="mt-4 text-sm">Načítám přihlášky…</p>}{error&&<p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    {!loading&&!error&&<div className="mt-5 grid gap-3 sm:grid-cols-2">{visible.map(item=><article key={item.id} className="rounded-2xl border border-viatix-line bg-viatix-sand2 p-4"><p className="text-xs font-medium text-viatix-teal">{APPLICATION_STATUSES[item.application.status]}</p><h3 className="mt-2 font-semibold">{item.offer.title}</h3><p className="mt-1 text-sm text-muted-foreground">{item.offer.company}</p><p className="mt-3 text-xs text-muted-foreground">Reakce: {item.application.appliedAt?formatDate(item.application.appliedAt):'datum neznámé'}</p>{item.application.salaryExpectation&&<p className="mt-2 text-sm text-viatix-teal">Firmě uvedeno: {item.application.salaryExpectation}</p>}<button type="button" className="button-secondary mt-4" onClick={()=>onSelected(item.id)}>Detail přihlášky</button></article>)}</div>}
    {!loading&&!error&&!visible.length&&<p className="mt-5 rounded-2xl border border-viatix-line p-6 text-sm text-muted-foreground">{items.length?'V tomto přehledu nejsou žádné přihlášky.':'Zatím nemáš žádné přihlášky. U nabídky označ Reagoval jsem, nebo přidej nabídku s již odeslanou reakcí.'}</p>}
    <p className="mt-5 text-xs text-muted-foreground">Pohovor si můžeš z detailu přidat do kalendáře s připomínkou 30 minut předem. Automatická upozornění MakAI při zavřené aplikaci zatím nejsou zapnutá.</p>
  </section>;
}
