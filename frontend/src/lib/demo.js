// Fictional visual fixtures. Never stored in Turso.
const entries = [
  { id: 'demo-automation', title: 'Specialista automatizace a AI', company: 'Ukázková společnost', score: 92, verdict: 'STRONG_FIT',
    reasons: ['Ukázka: role propojuje procesní analýzu s praktickou automatizací.', 'Ukázka: zkušenosti s digitalizací jsou relevantní pro náplň pozice.'],
    gaps: ['Ukázka: ověřit očekávanou úroveň technické samostatnosti.'] },
  { id: 'demo-analyst', title: 'Business analytik pro digitální produkty', company: 'Ukázkový produktový tým', score: 67, verdict: 'POTENTIAL_FIT',
    reasons: ['Ukázka: analytická práce a komunikace s týmem navazují na zkušenosti.', 'Ukázka: pozice nabízí prostor pro další odborný rozvoj.'],
    gaps: ['Ukázka: znalost konkrétních nástrojů není doložena.', 'Ukázka: mzda a pracovní jazyk vyžadují ověření.'] },
  { id: 'demo-engineer', title: 'Senior machine learning engineer', company: 'Ukázkový technický tým', score: 28, verdict: 'NO_GO',
    reasons: ['Ukázka: role vyžaduje hlubokou zkušenost s produkčním ML.', 'Ukázka: hlavní náplň nenavazuje na doložené procesní kompetence.'],
    gaps: ['Ukázka: chybí doložené zkušenosti s provozem ML systémů.'] },
];
export const demoJobs = entries.map(entry => ({
  id: entry.id,
  offer: { id: entry.id, title: entry.title, company: entry.company, url: 'https://example.com/', published_at: '2026-01-01T09:00:00Z', raw_description: 'Toto je smyšlená nabídka pro kontrolu vzhledu komponenty. Nepředstavuje skutečný inzerát ani ověřené pracovní podmínky.' },
  evaluation: { score: entry.score, verdict: entry.verdict, fit_reasons: entry.reasons, gap_analysis: entry.gaps, tailored_cv_highlights: [] },
  evaluatedAt: '2026-01-02T09:00:00Z', demo: true,
}));
