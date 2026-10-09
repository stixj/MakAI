export const APPLICATION_STATUSES = { waiting: 'Čekám na odpověď', responded: 'Firma odpověděla', interview: 'Pohovor', offer: 'Nabídka spolupráce', accepted: 'Přijato', rejected: 'Zamítnuto', withdrawn: 'Staženo' };
export const CLOSED_STATUSES = ['accepted', 'rejected', 'withdrawn'];
export const today = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
export function applicationSummary(items, now = new Date()) {
  const active = items.filter(item => !CLOSED_STATUSES.includes(item.application.status));
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return { waiting: active.filter(item => item.application.status === 'waiting').length,
    tasks: active.flatMap(item => applicationTasks(item.application,day).map(task => ({ ...task, offerId: item.id, title: item.offer.title, company: item.offer.company }))).sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999')),
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

// Calendar dates are compared in Prague; elapsed days describe the sent reaction,
// not the (unknown) time of the latest status change.
export function applicationNextStep(application, now = new Date()) {
  const day = today(now);
  const applied = application.appliedAt;
  const elapsed = applied && /^\d{4}-\d{2}-\d{2}$/.test(applied)
    ? Math.floor((Date.parse(day + 'T00:00:00Z') - Date.parse(applied + 'T00:00:00Z')) / 86400000) : null;
  const daysSinceApplied = Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
  if (CLOSED_STATUSES.includes(application.status)) return { kind: 'closed', text: 'Přihláška je uzavřená.', daysSinceApplied };
  const tasks = applicationTasks(application,day).sort((a,b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const interview = application.interviews.filter(event => !event.cancelled && Date.parse(event.at) >= now.getTime()).sort((a,b) => Date.parse(a.at) - Date.parse(b.at))[0];
  const task = tasks[0];
  if (task && task.due && task.due < day) return { kind: task.kind||'task', text: task.text, due: task.due, overdue: true, daysSinceApplied, suggestFollowUp:task.kind==='response' };
  if (interview && (!task?.due || today(new Date(interview.at)) <= task.due)) return { kind: 'interview', text: 'Připrav se na pohovor', at: interview.at, daysSinceApplied };
  if (task) return { kind: task.kind||'task', text: task.text, due: task.due, overdue: false, daysSinceApplied };
  if (application.status === 'waiting' && application.responseExpectedAt) return {kind:'waiting',text:'Čekáš na slíbenou odpověď firmy.',due:application.responseExpectedAt,daysSinceApplied,suggestFollowUp:false};
  if (application.status === 'waiting') return { kind: 'waiting', text: daysSinceApplied !== null && daysSinceApplied >= 7 ? 'Zvaž krátké připomenutí firmě.' : 'Čekáš na odpověď firmy.', daysSinceApplied, suggestFollowUp: daysSinceApplied !== null && daysSinceApplied >= 7 };
  return { kind: 'plan', text: application.status === 'offer' ? 'Zvaž nabídku a naplánuj svou odpověď.' : 'Zapiš, na čem jste se s firmou domluvili.', daysSinceApplied };
}
export const formatInterviewDate = value => new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(value));

export function applicationTasks(application,day=today()) {
  const tasks=application.tasks.filter(task=>!task.done);
  if(application.assignment?.trim()&&!application.assignmentDone)tasks.push({id:'assignment',kind:'assignment',text:'Odevzdat zadání: '+application.assignment,due:application.assignmentDue||null,done:false});
  if(application.status==='waiting'&&application.responseExpectedAt&&application.responseExpectedAt<day)tasks.push({id:'promised-response',kind:'response',text:'Ověřit slíbenou odpověď firmy',due:application.responseExpectedAt,done:false});
  return tasks;
}
