export const VERDICTS = {
  STRONG_FIT: { label: 'STRONG FIT', title: 'Silná shoda', color: 'bg-viatix-mint/20 text-viatix-teal', dot: 'bg-viatix-teal' },
  POTENTIAL_FIT: { label: 'POTENTIAL FIT', title: 'Potenciální shoda', color: 'bg-viatix-amber/20 text-[#9a4b12]', dot: 'bg-viatix-amber-hot' },
  NO_GO: { label: 'NO GO', title: 'Nízká shoda', color: 'bg-rose-500/10 text-rose-700', dot: 'bg-rose-500' },
};
export function safeOfferUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const text = value => typeof value === 'string' && value.trim().length > 0;
const textList = value => Array.isArray(value) && value.every(text);
export function parseJobRow(row) {
  const offer = JSON.parse(row.offer);
  const evaluation = JSON.parse(row.evaluation);
  if (!offer || !evaluation || !text(row.offer_id) || row.offer_id !== offer.id ||
      !text(offer.title) || !text(offer.company) || !text(offer.raw_description) ||
      !safeOfferUrl(offer.url) || !text(offer.published_at) || !Number.isFinite(Date.parse(offer.published_at)) ||
      !Number.isInteger(evaluation.score) || evaluation.score < 0 || evaluation.score > 100 ||
      !textList(evaluation.fit_reasons) || evaluation.fit_reasons.length < 2 || evaluation.fit_reasons.length > 3 ||
      !textList(evaluation.gap_analysis) || !textList(evaluation.tailored_cv_highlights)) {
    throw new Error('Neplatný záznam nabídky.');
  }
  const expected = evaluation.score >= 80 ? 'STRONG_FIT' : evaluation.score >= 50 ? 'POTENTIAL_FIT' : 'NO_GO';
  if (evaluation.verdict !== expected) throw new Error('Verdikt neodpovídá skóre.');
  return { id: row.offer_id, offer, evaluation, evaluatedAt: row.evaluated_at };
}
export function decodeJobRows(rows) {
  const jobs = [];
  let invalidCount = 0;
  for (const row of rows) {
    try { jobs.push(parseJobRow(row)); } catch { invalidCount += 1; }
  }
  return { jobs, invalidCount };
}
export function filterJobs(jobs, { search = '', verdict = 'all', sort = 'score' } = {}) {
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
  const needle = normalize(search.trim());
  return jobs.filter(job =>
    (verdict === 'all' || job.evaluation.verdict === verdict) &&
    normalize(job.offer.title + ' ' + job.offer.company).includes(needle)
  ).sort((a, b) => sort === 'newest'
    ? (parseTimestamp(b.evaluatedAt) || 0) - (parseTimestamp(a.evaluatedAt) || 0)
    : b.evaluation.score - a.evaluation.score || a.offer.title.localeCompare(b.offer.title, 'cs'));
}
function parseTimestamp(value) {
  if (!value) return NaN;
  // SQLite CURRENT_TIMESTAMP is UTC despite lacking a timezone suffix.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  return Date.parse(normalized);
}
export function formatDate(value) {
  const date = new Date(parseTimestamp(value));
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Prague' }).format(date)
    : 'Datum neuvedeno';
}
