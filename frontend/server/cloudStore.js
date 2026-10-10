import { normalizeJobState } from '../src/lib/jobState.js';
import { applicationTables, offerRow, appliedStateChanged, assertActive, readOfferInterest, writeOfferInterest } from './applicationStore.js';
import { parseJobRow } from '../src/lib/jobs.js';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SCHEDULE, validateSchedule, validateHunt, nextOccurrence, clockParts } from '../src/lib/schedule.js';
import { parseCloudProfile, profileTable } from './cloudProfile.js';

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
      ...applicationTables,
      'CREATE TABLE IF NOT EXISTS makai_control (id INTEGER PRIMARY KEY CHECK(id=1), schedule TEXT NOT NULL, next_at TEXT, profile_id TEXT, revision INTEGER NOT NULL DEFAULT 0, worker_seen_at TEXT)',
      'CREATE TABLE IF NOT EXISTS makai_profiles (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS makai_profile_documents (profile_id TEXT PRIMARY KEY, name TEXT NOT NULL, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL, content BLOB NOT NULL, extracted_text TEXT NOT NULL, uploaded_at TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS makai_documents (id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL, content BLOB, text_content TEXT, extracted_text TEXT NOT NULL DEFAULT "", created_at TEXT NOT NULL, UNIQUE(profile_id,id))',
      'CREATE INDEX IF NOT EXISTS makai_documents_profile ON makai_documents(profile_id,created_at)',
      'CREATE TABLE IF NOT EXISTS makai_application_documents (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, document_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL, byte_length INTEGER NOT NULL, content BLOB, text_content TEXT, attached_at TEXT NOT NULL, PRIMARY KEY(profile_id,offer_id,document_id))',
      'CREATE INDEX IF NOT EXISTS makai_application_documents_lookup ON makai_application_documents(profile_id,offer_id)',
      'CREATE TABLE IF NOT EXISTS makai_runs (id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL, profile_id TEXT NOT NULL, options TEXT NOT NULL, created_at TEXT NOT NULL, scheduled_at TEXT, slot TEXT UNIQUE, started_at TEXT, finished_at TEXT, lease_until TEXT, lease_token TEXT, result TEXT, error TEXT)',
      "CREATE UNIQUE INDEX IF NOT EXISTS makai_single_active_run ON makai_runs ((1)) WHERE status IN ('queued','running','stopping')",
      'CREATE INDEX IF NOT EXISTS makai_runs_created ON makai_runs(created_at DESC)',
      'CREATE TABLE IF NOT EXISTS makai_job_states (profile_id TEXT NOT NULL, offer_id TEXT NOT NULL, saved INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, PRIMARY KEY(profile_id,offer_id))',
      'CREATE TABLE IF NOT EXISTS makai_auth (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL, version TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS makai_login_attempts (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL)',
      { sql: 'INSERT OR IGNORE INTO makai_control(id,schedule) VALUES(1,?)', args: [json(DEFAULT_SCHEDULE)] },
    ], 'write');
    await this.client.execute("INSERT OR IGNORE INTO makai_documents(id,profile_id,kind,name,content_type,byte_length,content,text_content,extracted_text,created_at) SELECT 'legacy-cv-'||profile_id,profile_id,'cv',name,content_type,byte_length,content,NULL,extracted_text,uploaded_at FROM makai_profile_documents");
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
  async auth(db = this.client) { return (await db.execute('SELECT password_hash, version FROM makai_auth WHERE id=1')).rows[0] || null; }
  async changePassword(passwordHash, expectedVersion) {
    return this.transaction(async tx => {
      const current = await this.auth(tx);
      if ((current?.version || null) !== expectedVersion) throw new UserError('Heslo se mezitím změnilo. Přihlas se znovu.', 409);
      const version = randomUUID();
      await tx.execute({ sql: 'INSERT INTO makai_auth(id,password_hash,version) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET password_hash=excluded.password_hash,version=excluded.version', args: [passwordHash, version] });
      return version;
    });
  }
  async control(db = this.client) { return (await db.execute('SELECT * FROM makai_control WHERE id=1')).rows[0]; }
  async profile(db = this.client) {
    const result = await db.execute('SELECT payload FROM makai_profiles WHERE id=(SELECT profile_id FROM makai_control WHERE id=1)');
    return result.rows.length ? JSON.parse(result.rows[0].payload) : null;
  }
  async profileView() {
    const profile = await this.profile();
    if (!profile) return null;
    const row = (await this.client.execute({ sql: 'SELECT name, byte_length, uploaded_at FROM makai_profile_documents WHERE profile_id=?', args: [profile.id] })).rows[0];
    return { ...profile, cvDocument: row ? { name: row.name, size: Number(row.byte_length), uploadedAt: row.uploaded_at } : null };
  }
  async currentProfileDocument({ download = false, profileId } = {}) {
    const control = await this.control();
    if (!control.profile_id) throw new UserError('Nejdřív vytvoř nebo vyber profil.', 404);
    if (profileId && profileId !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.', 409);
    const row = (await this.client.execute({ sql: 'SELECT name, content_type, byte_length, content, uploaded_at FROM makai_profile_documents WHERE profile_id=?', args: [control.profile_id] })).rows[0];
    if (!row) return { cvDocument: null };
    const cvDocument = { name: row.name, contentType: row.content_type, size: Number(row.byte_length), uploadedAt: row.uploaded_at };
    if (download) cvDocument.base64 = Buffer.from(row.content).toString('base64');
    return { cvDocument };
  }
  async saveCurrentProfileDocument(input) {
    const control = await this.control();
    if (!control.profile_id) throw new UserError('Nejdřív vytvoř nebo vyber profil.', 404);
    if (input.profileId && input.profileId !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.', 409);
    const doc = this.validateCvDocument(input);
    await this.transaction(async tx => {
      if ((await this.control(tx)).profile_id !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.', 409);
      await this.writeCvDocument(tx, control.profile_id, doc);
    });
    return { cvDocument: { name: doc.name, contentType: doc.contentType, size: doc.size, uploadedAt: doc.uploadedAt } };
  }
  async deleteCurrentProfileDocument(profileId) {
    const control = await this.control();
    if (!control.profile_id) throw new UserError('Nejdřív vytvoř nebo vyber profil.', 404);
    if (profileId && profileId !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.', 409);
    await this.transaction(async tx => {
      if ((await this.control(tx)).profile_id !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.', 409);
      await tx.execute({ sql: 'DELETE FROM makai_profile_documents WHERE profile_id=?', args: [control.profile_id] });
    });
    return { cvDocument: null };
  }
  validateCvDocument(input) {
    const extensions = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain', md: 'text/markdown' };
    if (!input || typeof input.name !== 'string' || input.name.length > 180 || typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || typeof input.extractedText !== 'string')
      throw new UserError('Zkontroluj nahrané CV.');
    const extension = input.name.split('.').pop().toLowerCase();
    const bytes = Buffer.from(input.base64, 'base64');
    if (!extensions[extension] || !bytes.length || bytes.length > 2000000 || input.extractedText.length < 40 || input.extractedText.length > 60000)
      throw new UserError('CV musí být čitelný PDF, DOCX, TXT nebo Markdown do 2 MB.');
    return { name: input.name.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 180), contentType: extensions[extension], size: bytes.length, bytes, extractedText: input.extractedText, uploadedAt: this.now().toISOString() };
  }
  async writeCvDocument(tx, profileId, doc) {
    await tx.execute({ sql: `INSERT INTO makai_profile_documents(profile_id,name,content_type,byte_length,content,extracted_text,uploaded_at)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET name=excluded.name,content_type=excluded.content_type,byte_length=excluded.byte_length,content=excluded.content,extracted_text=excluded.extracted_text,uploaded_at=excluded.uploaded_at`,
      args: [profileId, doc.name, doc.contentType, doc.size, doc.bytes, doc.extractedText, doc.uploadedAt] });
  }
  async addCvToLibrary(tx,profileId,doc){
    const id=randomUUID();
    await tx.execute({sql:'INSERT INTO makai_documents(id,profile_id,kind,name,content_type,byte_length,content,text_content,extracted_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[id,profileId,'cv',doc.name,doc.contentType,doc.size,doc.bytes,null,doc.extractedText,doc.uploadedAt]});
    return id;
  }
  async listDocuments(profileId) {
    const control = await this.control();
    if (!control.profile_id) throw new UserError('Nejdřív vytvoř nebo vyber profil.',404);
    if (profileId && profileId !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.',409);
    const rows = (await this.client.execute({sql:'SELECT id,kind,name,content_type,byte_length,created_at FROM makai_documents WHERE profile_id=? ORDER BY created_at DESC',args:[control.profile_id]})).rows;
    return { items: rows.map(row=>({id:row.id,kind:row.kind,name:row.name,contentType:row.content_type,size:Number(row.byte_length),createdAt:row.created_at})) };
  }
  async getDocument(id, profileId, download = false) {
    const control = await this.control();
    if (!control.profile_id) throw new UserError('Nejdřív vytvoř nebo vyber profil.',404);
    if (profileId && profileId !== control.profile_id) throw new UserError('Aktivní profil se změnil. Obnov stránku.',409);
    const row = (await this.client.execute({sql:'SELECT id,kind,name,content_type,byte_length,content,text_content,created_at FROM makai_documents WHERE profile_id=? AND id=?',args:[control.profile_id,id]})).rows[0];
    if (!row) throw new UserError('Dokument nebyl nalezen.',404);
    const item={id:row.id,kind:row.kind,name:row.name,contentType:row.content_type,size:Number(row.byte_length),textContent:row.text_content||'',createdAt:row.created_at};
    if (download && row.content) item.base64=Buffer.from(row.content).toString('base64');
    return {document:item};
  }
  async saveDocument(input) {
    const control=await this.control();
    if(!control.profile_id)throw new UserError('Nejdřív vytvoř nebo vyber profil.',404);
    if(input.profileId&&input.profileId!==control.profile_id)throw new UserError('Aktivní profil se změnil. Obnov stránku.',409);
    if(typeof input.name!=='string'||!input.name.trim()||input.name.length>180)throw new UserError('Zkontroluj název dokumentu.');
    const id=randomUUID(),createdAt=this.now().toISOString();
    let kind,contentType,size,bytes=null,textContent=null,extractedText='';
    if(input.kind==='cv'){
      const extensions={pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',txt:'text/plain',md:'text/markdown'};
      const extension=input.name.split('.').pop().toLowerCase();
      if(!extensions[extension]||typeof input.base64!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)||typeof input.extractedText!=='string')throw new UserError('Vyber čitelný PDF, DOCX, TXT nebo Markdown soubor.');
      bytes=Buffer.from(input.base64,'base64');
      if(!bytes.length||bytes.length>2000000||input.extractedText.length<40||input.extractedText.length>60000)throw new UserError('CV musí být čitelný soubor do 2 MB.');
      kind='cv';contentType=extensions[extension];size=bytes.length;extractedText=input.extractedText;
    }else if(input.kind==='letter'){
      if(typeof input.textContent!=='string'||!input.textContent.trim()||input.textContent.length>20000)throw new UserError('Doplň text motivačního dopisu (max. 20 000 znaků).');
      kind='letter';contentType='text/plain;charset=utf-8';textContent=input.textContent.trim();size=Buffer.byteLength(textContent);extractedText=textContent;
    }else throw new UserError('Vyber životopis nebo motivační dopis.');
    await this.client.execute({sql:'INSERT INTO makai_documents(id,profile_id,kind,name,content_type,byte_length,content,text_content,extracted_text,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[id,control.profile_id,kind,input.name.trim(),contentType,size,bytes,textContent,extractedText,createdAt]});
    return {document:{id,kind,name:input.name.trim(),contentType,size,textContent,createdAt}};
  }
  async deleteDocument(id, profileId) {
    const control=await this.control();
    if(!control.profile_id)throw new UserError('Nejdřív vytvoř nebo vyber profil.',404);
    if(profileId&&profileId!==control.profile_id)throw new UserError('Aktivní profil se změnil. Obnov stránku.',409);
    const result=await this.client.execute({sql:'DELETE FROM makai_documents WHERE profile_id=? AND id=?',args:[control.profile_id,id]});
    if(!Number(result.rowsAffected))throw new UserError('Dokument nebyl nalezen.',404);
    return {deleted:true};
  }
  async attachDocumentsToApplication(profileId, offerId, ids, db=this.client) {
    const attached=[];
    for(const id of ids){
      const row=(await db.execute({sql:'SELECT id,kind,name,content_type,byte_length,content,text_content FROM makai_documents WHERE profile_id=? AND id=?',args:[profileId,id]})).rows[0];
      if(!row)throw new UserError('Vybraný dokument už není v knihovně. Obnov stránku.',409);
      const attachedAt=this.now().toISOString();
      await db.execute({sql:'INSERT OR IGNORE INTO makai_application_documents(profile_id,offer_id,document_id,kind,name,content_type,byte_length,content,text_content,attached_at) VALUES(?,?,?,?,?,?,?,?,?,?)',args:[profileId,offerId,row.id,row.kind,row.name,row.content_type,Number(row.byte_length),row.content,row.text_content,attachedAt]});
      attached.push({id:row.id,kind:row.kind,name:row.name,contentType:row.content_type,size:Number(row.byte_length),attachedAt});
    }
    return attached;
  }
  async applicationDocuments(profileId,offerId,db=this.client){
    const rows=(await db.execute({sql:'SELECT document_id AS id,kind,name,content_type,byte_length,text_content,attached_at FROM makai_application_documents WHERE profile_id=? AND offer_id=? ORDER BY attached_at',args:[profileId,offerId]})).rows;
    return rows.map(row=>({id:row.id,kind:row.kind,name:row.name,contentType:row.content_type,size:Number(row.byte_length),textContent:row.text_content||'',attachedAt:row.attached_at}));
  }
  async getApplicationDocument(profileId,offerId,id){
    const control=await this.control();
    if(!control.profile_id)throw new UserError('Nejdřív vytvoř nebo vyber profil.',404);
    if(profileId&&profileId!==control.profile_id)throw new UserError('Aktivní profil se změnil. Obnov stránku.',409);
    const row=(await this.client.execute({sql:'SELECT document_id AS id,kind,name,content_type,byte_length,content,text_content,attached_at FROM makai_application_documents WHERE profile_id=? AND offer_id=? AND document_id=?',args:[control.profile_id,offerId,id]})).rows[0];
    if(!row)throw new UserError('Odeslaný dokument nebyl nalezen.',404);
    const document={id:row.id,kind:row.kind,name:row.name,contentType:row.content_type,size:Number(row.byte_length),textContent:row.text_content||'',attachedAt:row.attached_at};
    if(row.content)document.base64=Buffer.from(row.content).toString('base64');
    return {document};
  }
  async documentsForAllApplications(documentId) {
    const control=await this.control();
    if(!control.profile_id)throw new UserError('Nejdřív vytvoř nebo vyber profil.',404);
    const doc=(await this.client.execute({sql:'SELECT id,kind,name,content_type,byte_length,content,text_content FROM makai_documents WHERE profile_id=? AND id=?',args:[control.profile_id,documentId]})).rows[0];
    if(!doc||doc.kind!=='cv')throw new UserError('Vybraný životopis nebyl nalezen.',404);
    const rows=(await this.client.execute({sql:'SELECT offer_id FROM makai_job_states WHERE profile_id=? AND applied=1',args:[control.profile_id]})).rows;
    let count=0;
    for(const row of rows){await this.attachDocumentsToApplication(control.profile_id,row.offer_id,[documentId]);const app=(await this.client.execute({sql:'SELECT payload FROM makai_applications WHERE profile_id=? AND offer_id=?',args:[control.profile_id,row.offer_id]})).rows[0];if(app){const payload={...JSON.parse(app.payload)};payload.sentDocumentIds=[...new Set([...(payload.sentDocumentIds||[]),documentId])];await this.client.execute({sql:'UPDATE makai_applications SET payload=? WHERE profile_id=? AND offer_id=?',args:[JSON.stringify(payload),control.profile_id,row.offer_id]});}count++;}
    return {assigned:count};
  }
  async jobStates(profileId) {
    profileTable(profileId);
    return (await this.client.execute({ sql: 'SELECT s.offer_id,s.saved,s.applied,s.hidden,i.priority FROM makai_job_states s LEFT JOIN makai_offer_interest i ON i.profile_id=s.profile_id AND i.offer_id=s.offer_id WHERE s.profile_id=? UNION ALL SELECT i.offer_id,0,0,0,i.priority FROM makai_offer_interest i WHERE i.profile_id=? AND NOT EXISTS (SELECT 1 FROM makai_job_states s WHERE s.profile_id=i.profile_id AND s.offer_id=i.offer_id)', args: [profileId,profileId] })).rows;
  }
  async updateJobState(input) {
    const keys = Object.keys(input?.changes || {});
    if (typeof input?.profileId !== 'string' || !/^[a-f0-9]{64}$/.test(input.profileId) ||
        typeof input?.offerId !== 'string' || !input.offerId.trim() || input.offerId.length > 500 ||
        !keys.length || keys.some(key => !['saved','applied','hidden','priority'].includes(key) || typeof input.changes[key] !== 'boolean'))
      throw new UserError('Neplatná změna stavu nabídky.');
    return this.transaction(async tx => {
      const control = await this.control(tx);
      if (control.profile_id !== input.profileId) throw new UserError('Aktivní profil se změnil. Obnov přehled.', 409);
      await offerRow(tx, input.profileId, input.offerId);
      if (keys.includes('applied')) await appliedStateChanged(this, tx, input.profileId, input.offerId, input.changes.applied);
      if(keys.includes('priority'))await writeOfferInterest(tx,input.profileId,input.offerId,{priority:input.changes.priority});
      const stateKeys=keys.filter(key=>key!=='priority');
      if(stateKeys.length)await tx.execute({ sql: `INSERT INTO makai_job_states(profile_id,offer_id,saved,applied,hidden,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,offer_id) DO UPDATE SET ${stateKeys.map(key => key + '=excluded.' + key).join(',')}, updated_at=excluded.updated_at`,
        args: [input.profileId, input.offerId, Number(input.changes.saved || false), Number(input.changes.applied || false), Number(input.changes.hidden || false), this.now().toISOString()] });
      const row = (await tx.execute({ sql: 'SELECT saved,applied,hidden FROM makai_job_states WHERE profile_id=? AND offer_id=?', args: [input.profileId, input.offerId] })).rows[0];
      return { offerId: input.offerId, profileId: input.profileId, state: normalizeJobState({...row,priority:(await readOfferInterest(tx,input.profileId,input.offerId)).priority}) };
    });
  }
  async profiles(db = this.client) {
    return (await db.execute('SELECT payload FROM makai_profiles ORDER BY id')).rows
      .map(row => { const profile = JSON.parse(row.payload); return { id: profile.id, name: profile.name, revision: profile.revision || 0 }; });
  }
  async activateProfile(id) {
    // Validates the ID before any query or identifier interpolation.
    profileTable(id);
    return this.transaction(async tx => {
      await this.expire(tx);
      if ((await tx.execute("SELECT id FROM makai_runs WHERE status IN ('queued','running','stopping')")).rows.length)
        throw new UserError('Nejdřív dokonči nebo zastav hledání.', 409);
      const row = (await tx.execute({ sql: 'SELECT payload FROM makai_profiles WHERE id=?', args: [id] })).rows[0];
      if (!row) throw new UserError('Profil nebyl nalezen.', 404);
      const control = await this.control(tx);
      if (control.profile_id !== id) {
        await tx.execute({ sql: 'UPDATE makai_control SET profile_id=?, schedule=?, next_at=NULL, revision=revision+1 WHERE id=1',
          args: [id, json({ ...JSON.parse(control.schedule), enabled: false })] });
      }
      return JSON.parse(row.payload);
    });
  }
  async saveProfile(payload) {
    let profile = parseCloudProfile(payload.name, payload.content);
    await this.transaction(async tx => {
      await this.expire(tx);
      if ((await tx.execute("SELECT id FROM makai_runs WHERE status IN ('queued','running','stopping')")).rows.length)
        throw new UserError('Nejdřív dokonči nebo zastav hledání.', 409);
      const control = await this.control(tx);
      if (payload.replaceProfileId) {
        profileTable(payload.replaceProfileId);
        if (control.profile_id !== payload.replaceProfileId) throw new UserError('Aktivní profil se změnil. Načti profil znovu.', 409);
        const current = await this.profile(tx);
        if (!Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision !== (current.revision || 0)) throw new UserError('Profil se mezitím změnil. Načti aktuální verzi před uložením.', 409);
        const changed = current.content !== profile.content;
        profile = { ...profile, id: current.id, contentId: profile.id, revision: (current.revision || 0) + Number(changed), updatedAt: changed ? this.now().toISOString() : current.updatedAt };
      }

      const schedule = { ...JSON.parse(control.schedule), enabled: false };
      await tx.execute({ sql: 'INSERT INTO makai_profiles(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', args: [profile.id, json(profile)] });
      if (payload.cvDocument) { const doc=this.validateCvDocument(payload.cvDocument); await this.writeCvDocument(tx, profile.id, doc); await this.addCvToLibrary(tx,profile.id,doc); }
      await tx.execute({ sql: 'UPDATE makai_control SET profile_id=?, schedule=?, next_at=NULL, revision=revision+1 WHERE id=1', args: [profile.id, json(schedule)] });
      return profile;
    });
    return this.profileView();
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
  async queue(db, options, source, scheduledAt = null, slot = null, evaluationOffer = null, evaluationOfferRevision = 0) {
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
      args: [id, source, control.profile_id, json({ ...validateHunt(options), ...(evaluationOffer ? { evaluationOffer, evaluationOfferRevision } : {}) }), this.now().toISOString(), scheduledAt, slot] });
    return runView((await db.execute({ sql: 'SELECT * FROM makai_runs WHERE id=?', args: [id] })).rows[0]);
  }
  async evaluateOffer(input) {
    return this.transaction(async tx => {
      await assertActive(this, tx, input?.profileId); await this.expire(tx);
      const row = await offerRow(tx, input.profileId, input.offerId);
      // An explicit user request may refresh an existing evaluation after profile/offer changes.
      const edit = (await tx.execute({sql:'SELECT payload,revision FROM makai_offer_edits WHERE profile_id=? AND offer_id=?',args:[input.profileId,input.offerId]})).rows[0];
      const offer = {...JSON.parse(row.offer),...(edit?JSON.parse(edit.payload):{})};
      if (row.evaluation) {
        const profile = await this.profile(tx);
        const basis = (await tx.execute({sql:'SELECT offer_revision FROM makai_offer_evaluation_versions WHERE profile_id=? AND offer_id=?',args:[input.profileId,input.offerId]})).rows[0];
        const beforeProfile = profile.updatedAt && Date.parse(row.evaluated_at?.includes('T') ? row.evaluated_at : row.evaluated_at?.replace(' ','T')+'Z') < Date.parse(profile.updatedAt);
        if (!beforeProfile && Number(edit?.revision || 0) <= Number(basis?.offer_revision || 0)) throw new UserError('Hodnocení už odpovídá aktuálním údajům.',409);
      }
      if (!offer.raw_description.trim()) throw new UserError('Pro AI hodnocení doplň text inzerátu.');
      return this.queue(tx, { profileId: input.profileId, maxEvaluations: 1 }, 'evaluation', null, null, { ...offer, url: offer.url || 'https://makai.invalid/manual/' + offer.id },Number(edit?.revision||0));
    });
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
      return { id: run.id, token, profile: { id: profile.id, contentId: profile.contentId || profile.id, content: profile.content }, options: JSON.parse(run.options) };
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
    return this.transaction(async tx => {
      const run = (await tx.execute({sql:'SELECT * FROM makai_runs WHERE id=? AND lease_token=?',args:[id,token]})).rows[0];
      if (!run || !['running','stopping'].includes(run.status)) throw new UserError('Běh již skončil nebo jeho platnost vypršela.',409);
      const options=JSON.parse(run.options);
      if (options.evaluationOffer && status==='done' && run.status==='running') {
        const offer=options.evaluationOffer;
        parseJobRow({offer_id:offer.id,offer:JSON.stringify(offer),evaluation:JSON.stringify(result.evaluation),evaluated_at:this.now().toISOString()});
        const original = await offerRow(tx, run.profile_id, offer.id);
        const update = original.manual
          ? await tx.execute({sql:'UPDATE makai_manual_offers SET evaluation=?,evaluated_at=? WHERE profile_id=? AND offer_id=?',args:[JSON.stringify(result.evaluation),this.now().toISOString(),run.profile_id,offer.id]})
          : await tx.execute({sql:'UPDATE '+profileTable(run.profile_id)+' SET evaluation=?,evaluated_at=? WHERE offer_id=?',args:[JSON.stringify(result.evaluation),this.now().toISOString(),offer.id]});
        if (!update.rowsAffected) throw new UserError('Nabídka už byla změněna.',409);
        await tx.execute({sql:'INSERT INTO makai_offer_evaluation_versions(profile_id,offer_id,offer_revision) VALUES(?,?,?) ON CONFLICT(profile_id,offer_id) DO UPDATE SET offer_revision=excluded.offer_revision',args:[run.profile_id,offer.id,Number(options.evaluationOfferRevision||0)]});
      }
      await tx.execute({ sql: "UPDATE makai_runs SET status=CASE WHEN status='stopping' THEN 'cancelled' ELSE ? END, result=?, error=?, finished_at=? WHERE id=? AND lease_token=?",
        args: [status, result ? json(result) : null, status === 'error' ? 'Zpracování selhalo. Zkontroluj konfiguraci a stav zpracování.' : null, this.now().toISOString(), id, token] });
      return {saved:true};
    });
  }
}
