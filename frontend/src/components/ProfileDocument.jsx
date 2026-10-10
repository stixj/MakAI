import { useState } from 'react';
import { Download, Eye, FileText, Loader2, Trash2, Upload, X } from 'lucide-react';
import { profileApi as api } from '../lib/profileApi.js';

const ACCEPTED = '.pdf,.docx,.txt,.md';

function fileType(name) {
  const extension = name.split('.').pop().toLowerCase();
  return ({ pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown' })[extension] || 'application/octet-stream';
}

async function fileBlob(cvDocument) {
  const raw = atob(cvDocument.base64);
  const bytes = Uint8Array.from(raw, char => char.charCodeAt(0));
  return new Blob([bytes], { type: cvDocument.contentType || fileType(cvDocument.name) });
}

async function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ProfileDocument({ cvDocument, cloud, profileId, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
  }

  async function upload(file) {
    if (!file) return;
    setError('');
    if (file.size > 2_000_000 || !/\.(pdf|docx|txt|md)$/i.test(file.name)) {
      setError('Vyber PDF, DOCX, TXT nebo Markdown do 2 MB.');
      return;
    }
    setBusy(true);
    try {
      const base64 = await encodeFile(file);
      const result = await api('/api/profile/document', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profileId, name: file.name, base64 }) }, 120000);
      closePreview();
      onChange(result.cvDocument);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function loadDocument() {
    const result = await api('/api/profile/document?download=1&profileId=' + encodeURIComponent(profileId));
    return result.cvDocument;
  }

  async function download() {
    setBusy(true); setError('');
    try {
      const cvFile = await loadDocument();
      const url = URL.createObjectURL(await fileBlob(cvFile));
      const anchor = window.document.createElement('a'); anchor.href = url; anchor.download = cvFile.name; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function showPreview() {
    setBusy(true); setError('');
    try {
      const cvFile = await loadDocument();
      const nextUrl = URL.createObjectURL(await fileBlob(cvFile));
      closePreview();
      setPreviewUrl(nextUrl);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm('Opravdu smazat uložený životopis z tohoto profilu?')) return;
    setBusy(true); setError('');
    try {
      closePreview();
      const result = await api('/api/profile/document?profileId=' + encodeURIComponent(profileId), { method: 'DELETE' });
      onChange(result.cvDocument);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <section aria-labelledby="cv-document-title" className="mt-5 rounded-2xl border border-border-subtle bg-surface-subtle p-4 sm:p-5">
    <div className="flex items-start gap-3">
      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h3 id="cv-document-title" className="font-display text-lg font-semibold">Životopis</h3>
        {cvDocument ? <>
          <p className="mt-1 break-all text-sm text-ink">{cvDocument.name}</p>
          <p className="mt-1 text-xs text-ink-secondary">Uloženo k aktivnímu profilu · {(cvDocument.size / 1024).toFixed(0)} kB{cvDocument.uploadedAt ? ' · ' + new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium' }).format(new Date(cvDocument.uploadedAt)) : ''}</p>
        </> : <p className="mt-1 text-sm leading-relaxed text-ink-secondary">Tento profil vznikl ještě před ukládáním souboru CV. Tehdy se použily jen údaje z životopisu, původní soubor se neuložil. Nahraj ho prosím znovu; potom ho zde půjde zobrazit nebo stáhnout.</p>}
      </div>
    </div>
    <div className="mt-4 flex flex-wrap gap-2">
      {cvDocument && <>
        {fileType(cvDocument.name) === 'application/pdf' && <button type="button" className="button-secondary" disabled={busy} onClick={previewUrl ? closePreview : showPreview}>{previewUrl ? <X className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}{previewUrl ? 'Zavřít náhled' : 'Zobrazit PDF'}</button>}
        <button type="button" className="button-secondary" disabled={busy} onClick={download}><Download className="h-4 w-4" aria-hidden="true" />Stáhnout</button>
        <button type="button" className="button-secondary text-danger" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" aria-hidden="true" />Smazat CV</button>
      </>}
      <label className="button-secondary cursor-pointer"><Upload className="h-4 w-4" aria-hidden="true" />{cvDocument ? 'Nahradit CV' : 'Nahrát CV'}<input type="file" accept={ACCEPTED} disabled={busy} className="sr-only" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; upload(file); }} /></label>
      {busy && <span role="status" className="inline-flex items-center gap-2 text-sm text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Zpracovávám CV…</span>}
    </div>
    {previewUrl && <div className="mt-4 overflow-hidden rounded-xl border border-border-subtle bg-white"><iframe title={'Náhled souboru ' + cvDocument.name} src={previewUrl} className="h-[min(70vh,720px)] w-full" /></div>}
    {cloud && <p className="mt-3 text-xs leading-relaxed text-fit-potential-text">Tato verze používá společné přihlášení a profily. Uložené CV proto zatím není soukromé vůči ostatním přihlášeným uživatelům.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
  </section>;
}
