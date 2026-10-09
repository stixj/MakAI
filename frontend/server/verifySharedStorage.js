import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadEnv } from 'vite';
import { createClient } from '@libsql/client/http';
import { CloudStore } from './cloudStore.js';
import { localSnapshots, migrateLocalData } from './sharedMigration.js';
import { parseCloudProfile, profileTable } from './cloudProfile.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const env = { ...loadEnv('development', root, ['DATABASE_URL', 'TURSO_AUTH_TOKEN']),
  ...Object.fromEntries(['DATABASE_URL','TURSO_AUTH_TOKEN'].filter(key=>process.env[key]).map(key=>[key,process.env[key]])) };
let client;
try {
  if (!env.DATABASE_URL || !env.TURSO_AUTH_TOKEN) throw new Error('configuration');
  const source = await localSnapshots(root);
  client = createClient({url:env.DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN});
  await client.execute('SELECT 1');
  const store = new CloudStore(client);
  let imported;
  if (process.argv.includes('--migrate')) {await store.initialize(); imported=await migrateLocalData(store,root);}
  const profiles=[];
  for (const snapshot of source) {
    const profile=parseCloudProfile(snapshot.name,snapshot.content),table=profileTable(profile.id);
    const exists=(await client.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length;
    const rows=exists?(await client.execute('SELECT COUNT(*) AS n FROM '+table)).rows[0].n:0;
    profiles.push({id:profile.id,localEvaluationCount:snapshot.rows.length,sharedEvaluationCount:Number(rows),localConfirmedApplications:(snapshot.applications||[]).filter(item=>item.reported_status==='applied').length});
  }
  const tables=(await client.execute("SELECT name FROM sqlite_master WHERE type='table'")).rows.map(row=>row.name);
  const applicationCount=tables.includes('makai_job_states')?Number((await client.execute('SELECT COUNT(*) AS n FROM makai_job_states WHERE applied=1')).rows[0].n):0;
  console.log(JSON.stringify({connected:true,databaseFingerprint:createHash('sha256').update(env.DATABASE_URL.replace(/^libsql:/,'https:').replace(/\/$/,'')).digest('hex').slice(0,12),profiles,applicationCount,imported},null,2));
} catch {
  console.error('Sdílené Turso nelze ověřit. Zkontroluj připojení a serverové DATABASE_URL / TURSO_AUTH_TOKEN. Žádná náhradní databáze nebyla použita.');
  process.exitCode=1;
} finally {client?.close();}
