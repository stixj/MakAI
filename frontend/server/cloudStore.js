import { randomUUID } from 'node:crypto';
import { DEFAULT_SCHEDULE, validateSchedule, validateHunt, nextOccurrence, clockParts } from '../src/lib/schedule.js';
import { parseCloudProfile } from './cloudProfile.js';

export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const live = ['queued', 'running', 'stopping'];
const json = value => JSON.stringify(value);
const runView = row => row ? { id: row.id, status: row.status, source: row.source, profileId: row.profile_id,
  startedAt: row.started_at || row.created_at, finishedAt: row.finished_at, scheduledAt: row.scheduled_at,
  result: row.result ? JSON.parse(row.result) : undefined, error: row.error || undefined } : { status: 'idle' };

export class CloudStore {
  constructor(client, { now = () => new Date() } = {}) { this.client = client; this.now = now; }
  async initialize() {
    await this.client.batch([
      'CREATE TABLE IF NOT EXISTS makai_control (id INTEGER PRIMARY KEY CHECK(id=1), schedule TEXT NOT NULL, next_at TEXT, profile_id TEXT, revision INTEGER NOT NULL DEFAULT 0, worker_seen_at TEXT)',
      'CREATE TABLE IF NOT EXISTS makai_profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS makai_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, profile_id TEXT NOT NULL, options TEXT NOT NULL, created_at TEXT NOT NULL, scheduled_at TEXT, slot TEXT UNIQUE, started_at TEXT, finished_at TEXT, lease_until TEXT, lease_token TEXT, result TEXT, error TEXT)',
      "CREATE UNIQUE INDEX IF NOT EXISTS makai_single_active_run ON makai_runs ((1)) WHERE status IN ('queued','running','stopping')",
      'CREATE INDEX IF NOT EXISTS makai_runs_created ON makai_runs(created_at DESC)',
      'CREATE TABLE IF NOT EXISTS makai_login_attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL)',
      { sql: 'INSERT OR IGNORE INTO makai_control(id,schedule) VALUES(1,?)', args: [json(DEFAULT_SCHEDULE)] },
    ], 'write');
  }
  async transaction(callback) {
    const tx = await this.client.transaction('write');
    try { const result = await callback(tx); await tx.commit(); return result; }
    catch (error) { await tx.rollback(); throw error; }
    finally { tx.close(); }
  }
  async expire(db) {
    const now = this.now().toISOString();
    await db.execute({ sql: "UPDATE makai_runs SET status=CASE WHEN status='stopping' THEN 'cancelled' ELSE 'error' END, finished_at=?, error='Zpracování se přerušilo nebo překročilo časový limit.' WHERE status IN ('running','stopping') AND lease_until<=?", args: [now, now] });
  }
  async control(db = this.client) { return (await db.execute('SELECT * FROM makai_control WHERE id=1')).rows[0]; }
  async profile(db = this.client) {
    const result = await db.execute('SELECT payload FROM makai_profiles WHERE id=(SELECT profile_id FROM makai_control WHERE id=1)');
    return result.rows.length ? JSON.parse(result.rows[0].payload) : null;
  }
  async saveProfile(payload) {
    const profile = parseCloudProfile(payload.name, payload.content);
    return this.transaction(async tx => {
      await this.expire(tx);
      if ((await tx.execute("SELECT id FROM makai_runs WHERE status IN ('queued','running','stopping')")).rows.length)
        throw new UserError('Nejdřív dokonči nebo zastav hledání.', 409);
      const control = await this.control(tx);
      const schedule = { ...JSON.parse(control.schedule), enabled: false };
      await tx.execute({ sql: 'INSERT INTO makai_profiles(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', args: [profile.id, json(profile)] });
      await tx.execute({ sql: 'UPDATE makai_control SET profile_id=?, schedule=?, next_at=NULL, revision=revision+1 WHERE id=1', args: [profile.id, json(schedule)] });
      return profile;
    });
  }
  async getSchedule() {
    const row = await this.control();
    return { ...JSON.parse(row.schedule), nextAt: row.next_at, revision: Number(row.revision), workerSeenAt: row.worker_seen_at };
  }
  async saveSchedule(input) {
    const schedule = validateSchedule(input);
    await this.transaction(async tx => {
      const row = await this.control(tx);
      if (input.revision !== Number(row.revision)) throw new UserError('Nastavení se mezitím změnilo. Načti jej znovu.', 409);
      if (schedule.enabled && !row.profile_id) throw new UserError('Nejdřív nahraj nebo vytvoř profil.');
      await tx.execute({ sql: 'UPDATE makai_control SET schedule=?, next_at=?, revision=revision+1 WHERE id=1', args: [json(schedule), nextOccurrence(schedule, this.now())] });
      // Switching automation off also cancels a scheduled run that has not started.
      if (!schedule.enabled) await tx.execute({ sql: "UPDATE makai_runs SET status='cancelled', finished_at=? WHERE source='scheduled' AND status='queued'", args: [this.now().toISOString()] });
    });
    return this.getSchedule();
  }
  async runs() {
    await this.expire(this.client);
    return (await this.client.execute('SELECT * FROM makai_runs ORDER BY created_at DESC, rowid DESC LIMIT 30')).rows.map(runView);
  }
  async queue(db, options, source, scheduledAt = null, slot = null) {
    const control = await this.control(db);
    if (!control.profile_id) throw new UserError('Nejdřív nahraj nebo vytvoř profil.');
    if (options.profileId && options.profileId !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.', 409);
    if ((await db.execute("SELECT id FROM makai_runs WHERE status IN ('queued','running','stopping')")).rows.length)
      throw new UserError('Hledání už čeká nebo probíhá.', 409);
    const schedule = JSON.parse(control.schedule), today = clockParts(this.now(), schedule.timezone).date;
    const recent = await db.execute({ sql: "SELECT created_at FROM makai_runs WHERE created_at>=? AND (status<>'cancelled' OR started_at IS NOT NULL)", args: [new Date(this.now().getTime() - 48 * 3600000).toISOString()] });
    if (recent.rows.filter(row => clockParts(new Date(row.created_at), schedule.timezone).date === today).length >= schedule.maxDailyRuns)
      throw new UserError('Dnešní limit spuštění je vyčerpaný. Uprav jej v nastavení automatiky.', 429);
    const id = randomUUID();
    await db.execute({ sql: "INSERT INTO makai_runs(id,status,source,profile_id,options,created_at,scheduled_at,slot) VALUES(?,'queued',?,?,?,?,?,?)",
      args: [id, source, control.profile_id, json(validateHunt(options)), this.now().toISOString(), scheduledAt, slot] });
    return runView((await db.execute({ sql: 'SELECT * FROM makai_runs WHERE id=?', args: [id] })).rows[0]);
  }
  async manual(input) { return this.transaction(async tx => { await this.expire(tx); return this.queue(tx, input, 'manual'); }); }
  async stop() {
    return this.transaction(async tx => {
      await this.expire(tx);
      await tx.execute({ sql: "UPDATE makai_runs SET status=CASE WHEN status='queued' THEN 'cancelled' ELSE 'stopping' END, finished_at=CASE WHEN status='queued' THEN ? ELSE finished_at END WHERE status IN ('queued','running')", args: [this.now().toISOString()] });
      return runView((await tx.execute('SELECT * FROM makai_runs ORDER BY created_at DESC, rowid DESC LIMIT 1')).rows[0]);
    });
  }
  async claim() {
    return this.transaction(async tx => {
      await this.expire(tx);
      const now = this.now(), control = await this.control(tx), schedule = JSON.parse(control.schedule);
      await tx.execute({ sql: 'UPDATE makai_control SET worker_seen_at=? WHERE id=1', args: [now.toISOString()] });
      if (schedule.enabled && control.next_at && control.next_at <= now.toISOString()) {
        const due = new Date(control.next_at), wall = clockParts(due, schedule.timezone);
        const slot = `${control.profile_id}:${wall.date}:${wall.time}`;
        const active = (await tx.execute("SELECT id FROM makai_runs WHERE status IN ('queued','running','stopping')")).rows.length;
        const consumed = (await tx.execute({ sql: 'SELECT id FROM makai_runs WHERE slot=?', args: [slot] })).rows.length;
        if (!active && !consumed && now - due <= 24 * 3600000) {
          try { await this.queue(tx, schedule, 'scheduled', control.next_at, slot); }
          catch (error) { if (!(error instanceof UserError) || error.status !== 429) throw error; }
        }
        // Coalesce missed slots to at most one run, never a backlog of paid searches.
        await tx.execute({ sql: 'UPDATE makai_control SET next_at=? WHERE id=1', args: [nextOccurrence(schedule, now)] });
      }
      const run = (await tx.execute("SELECT * FROM makai_runs WHERE status='queued' LIMIT 1")).rows[0];
      if (!run) return null;
      const token = randomUUID();
      await tx.execute({ sql: "UPDATE makai_runs SET status='running', started_at=?, lease_until=?, lease_token=? WHERE id=? AND status='queued'",
        args: [now.toISOString(), new Date(now.getTime() + 45 * 60000).toISOString(), token, run.id] });
      const profile = JSON.parse((await tx.execute({ sql: 'SELECT payload FROM makai_profiles WHERE id=?', args: [run.profile_id] })).rows[0].payload);
      return { id: run.id, token, profile: { id: profile.id, content: profile.content }, options: JSON.parse(run.options) };
    });
  }
  async workerStatus(id, token) {
    const row = (await this.client.execute({ sql: 'SELECT status FROM makai_runs WHERE id=? AND lease_token=?', args: [id, token] })).rows[0];
    if (!row) throw new UserError('Neplatný běh.', 409);
    return { status: row.status };
  }
  async finish(input) {
    const { id, token, status, result } = input;
    if (!['done', 'partial', 'blocked', 'error', 'cancelled'].includes(status) ||
        (['done', 'partial', 'blocked'].includes(status) && (!result || !Array.isArray(result.errors) ||
          ['found', 'evaluated', 'saved'].some(key => !Number.isInteger(result[key]) || result[key] < 0))))
      throw new UserError('Neplatný výsledek běhu.');
    const update = await this.client.execute({ sql: "UPDATE makai_runs SET status=CASE WHEN status='stopping' THEN 'cancelled' ELSE ? END, result=?, error=?, finished_at=? WHERE id=? AND lease_token=? AND status IN ('running','stopping')",
      args: [status, result ? json(result) : null, status === 'error' ? 'Hledání selhalo. Zkontroluj konfiguraci a stav zpracování.' : null, this.now().toISOString(), id, token] });
    if (!update.rowsAffected) throw new UserError('Běh již skončil nebo jeho platnost vypršela.', 409);
    return { saved: true };
  }
}
