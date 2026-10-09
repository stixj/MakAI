export const APPLICATION_STATUSES = { waiting: 'Čekám na odpověď', responded: 'Firma odpověděla', interview: 'Pohovor', offer: 'Nabídka spolupráce', accepted: 'Přijato', rejected: 'Zamítnuto', withdrawn: 'Staženo' };
export const CLOSED_STATUSES = ['accepted', 'rejected', 'withdrawn'];
export const today = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function applicationSummary(items, now = new Date()) {
  const active = items.filter(item => !CLOSED_STATUSES.includes(item.application.status));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { waiting: active.filter(item => item.application.status === 'waiting').length,
    tasks: active.flatMap(item => item.application.tasks.filter(task => !task.done).map(task => ({ ...task, offerId: item.id, title: item.offer.title, company: item.offer.company }))).sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999')),
    interviews: active.flatMap(item => item.application.interviews.filter(event => !event.cancelled && Date.parse(event.at) >= now.getTime()).map(event => ({ ...event, offerId: item.id, title: item.offer.title, company: item.offer.company }))).sort((a,b) => a.at.localeCompare(b.at)), day };
}
const escapeIcs = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/[,;]/g, value => '\\' + value);
export function interviewCalendar(interview, offer) {
  const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//MakAI//Interviews//CS','BEGIN:VEVENT', 'UID:' + escapeIcs(interview.id) + '@makai', 'DTSTAMP:' + stamp(new Date()), 'DTSTART:' + stamp(interview.at), 'DTEND:' + stamp(new Date(Date.parse(interview.at) + (interview.duration || 60) * 60000)), 'SUMMARY:' + escapeIcs('Pohovor: ' + offer.title + ' — ' + offer.company), 'LOCATION:' + escapeIcs(interview.place), 'DESCRIPTION:' + escapeIcs(interview.note), 'BEGIN:VALARM','TRIGGER:-PT30M','ACTION:DISPLAY','DESCRIPTION:Pohovor za 30 minut','END:VALARM','END:VEVENT','END:VCALENDAR'];
  const folded = lines.flatMap(line => {
    const parts = []; let part = '', bytes = 0;
    for (const char of line) {
      const length = new TextEncoder().encode(char).length;
      if (bytes + length > 75) { parts.push(part); part = ' '; bytes = 1; }
      part += char; bytes += length;
    }
    parts.push(part); return parts;
  });
  return folded.join('\r\n') + '\r\n';
}
