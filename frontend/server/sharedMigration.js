import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCloudProfile, profileTable } from './cloudProfile.js';
import { parseJobRow } from '../src/lib/jobs.js';

async function optional(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function localSnapshots(root) {
  const snapshots = [];
  const original = await optional(join(root, 'candidate_profile.md'));
  if (original) snapshots.push({ name: 'Tvůj profil z projektu', content: original, rows: [], legacy: true, selected: true });
  const directory = join(root, 'data', 'profiles');
  const activeRaw = await optional(join(directory, 'active.json'));
  const active = activeRaw ? JSON.parse(activeRaw).id : 'default';
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code !== 'ENOENT') throw error; entries = []; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
    const raw = await optional(join(directory, entry.name, 'profile.json'));
    if (!raw) continue;
    const profile = JSON.parse(raw);
    const history = await optional(join(directory, entry.name, 'results.json'));
    const data = history ? JSON.parse(history) : { results: [] };
    if (!Array.isArray(data.results)) throw new Error('Neplatná místní historie. Původní soubory zůstaly zachované.');
    snapshots.push({ ...profile, legacy: false, selected: active === entry.name,
      rows: data.results.map(item => ({ offer_id: item.offer.id, offer: JSON.stringify(item.offer),
        evaluation: JSON.stringify(item.evaluation), evaluated_at: item.evaluated_at || data.saved_at })) });
  }
  if (active !== 'default') for (const snapshot of snapshots) if (snapshot.legacy) snapshot.selected = false;
  return snapshots;
}

export async function importSnapshot(store, snapshot) {
  const profile = parseCloudProfile(snapshot.name, snapshot.content);
  const table = profileTable(profile.id);
  return store.transaction(async tx => {
    let rows = snapshot.rows || [];
    if (snapshot.legacy) {
      const exists = await tx.execute({ sql: "SELECT name FROM sqlite_master WHERE type='table' AND name=?", args: ['makai_job_evaluations'] });
      if (exists.rows.length) rows = [...rows, ...(await tx.execute('SELECT offer_id, offer, evaluation, evaluated_at FROM makai_job_evaluations ORDER BY evaluated_at, offer_id')).rows];
    }
    // Validate everything before writing. An invalid source does not become a silent omission.
    for (const row of rows) {
      parseJobRow(row);
      if (typeof row.evaluated_at !== 'string' || !Number.isFinite(Date.parse(row.evaluated_at.replace(' ', 'T'))))
        throw new Error('Neplatné datum místní historie. Původní data zůstala zachovaná.');
    }
    await tx.execute({ sql: 'INSERT OR IGNORE INTO makai_profiles(id,payload) VALUES(?,?)', args: [profile.id, JSON.stringify(profile)] });
    await tx.execute(`CREATE TABLE IF NOT EXISTS ${table} (offer_id TEXT PRIMARY KEY, offer TEXT NOT NULL, evaluation TEXT NOT NULL, evaluated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const statements = rows.map(row => {
      const offer = JSON.parse(row.offer);
      // Existing evaluations take precedence; importing never changes their score, text or date.
      return { sql: `INSERT OR IGNORE INTO ${table}(offer_id,offer,evaluation,evaluated_at)
        SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ${table}
          WHERE offer_id=? OR json_extract(offer,'$.url')=?
          OR (? IS NOT NULL AND json_extract(offer,'$.canonical_id')=?))`,
        args: [row.offer_id, row.offer, row.evaluation, row.evaluated_at, row.offer_id, offer.url, offer.canonical_id || null, offer.canonical_id || null] };
    });
    let inserted = 0;
    for (let offset = 0; offset < statements.length; offset += 100) {
      const results = await tx.batch(statements.slice(offset, offset + 100));
      inserted += results.reduce((sum, result) => sum + result.rowsAffected, 0);
    }
    // Existing online selection and automation are never overwritten by migration.
    if (snapshot.selected) await tx.execute({ sql: 'UPDATE makai_control SET profile_id=? WHERE id=1 AND profile_id IS NULL', args: [profile.id] });
    return { id: profile.id, inserted };
  });
}

export async function migrateLocalData(store, root) {
  const snapshots = await localSnapshots(root);
  // Import the selected local profile first, but only select it when the shared DB has no profile.
  snapshots.sort((a, b) => Number(b.selected) - Number(a.selected));
  const imported = [];
  for (const snapshot of snapshots) imported.push(await importSnapshot(store, snapshot));
  return imported;
}
