import {createClient} from '@vercel/postgres';
import {PGlite} from '@electric-sql/pglite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {foundationBackup,foundationReport,legacySnapshot,migratedBooth} from '../api/lib/boothFoundation.js';
import {initContractRetirement,retirementReport,changeLegacyContracts} from '../api/lib/contractRetirement.js';
import {otherDataFingerprints} from './migrateLegacyBooth.mjs';

const sources={projects:'pos_projects',inventory:'pos_inventory',products:'pos_products',bundles:'pos_bundles',sales:'pos_sales',links:'pos_inventory_links',receipts:'pos_sale_receipts',settlements:'pos_settlements',closures:'pos_event_settlements',adjustments:'pos_inventory_adjustments',transfers:'pos_inventory_transfers',movements:'pos_stock_movements',numbers:'pos_inventory_numbers',restoreReceipts:'pos_account_restores',settlementCommands:'pos_settlement_commands',archives:'pos_event_archives'};
const relations=['pos_booths','pos_booth_members','pos_inventory_owners','pos_stock_owners','pos_artist_profiles','pos_owner_members','pos_booth_artists','pos_event_booths','pos_recipients','pos_event_recipients','pos_event_product_identities','pos_inventory_openings','pos_booth_migrations','pos_booth_sale_history','pos_owner_commands','pos_artist_invitations','pos_artist_link_audit','pos_event_stock_policy','pos_shared_stock_commands','pos_shared_stock_items','pos_booth_contract_policy','pos_booth_contract_commands'];
const allowed=new Set([...Object.values(sources),...relations]);
const sqlFor=db=>(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const id=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))fail('INVALID_SCHEMA_IDENTIFIER');return '"'+value+'"';};
const withoutPolicy=foundation=>Object.fromEntries(Object.entries(foundation.tables).filter(([table])=>!['pos_booth_contract_policy','pos_booth_contract_commands'].includes(table)));
const saveNew=(path,value)=>writeFile(path,JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const backupHash=backup=>digest({...backup,fingerprint:undefined});

// Administrative, explicit DB migration tooling; never exposed as a public API.
// The real database is only read during prepare. Rehearsal writes use PGlite.
export async function prepareContractRetirement(db,{adminId,directory}) {
  if(!adminId||!directory)fail('EXPLICIT_ACCOUNT_AND_DIRECTORY_REQUIRED');
  await mkdir(resolve(directory),{recursive:true});
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let backup;
  try {
    const sql=sqlFor(db),booth=await migratedBooth(sql,adminId);
    if(!booth)fail('MIGRATED_BOOTH_REQUIRED');
    const member=(await db.query("SELECT user_id FROM pos_booth_members WHERE booth_id=$1 AND user_id=$2 AND role='owner' AND status='active'",[booth.id,adminId])).rows[0];
    if(!member)fail('ACTIVE_BOOTH_OWNER_REQUIRED');
    const foundation=await foundationBackup(sql,adminId),source=await legacySnapshot(sql,adminId),tables={};
    for(const [key,table] of Object.entries(sources))tables[table]=source[key];
    for(const [table,rows] of Object.entries(foundation.tables))if(allowed.has(table))tables[table]=rows;
    const schema={};
    for(const table of Object.keys(tables)) {
      const columns=(await db.query('SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required FROM pg_attribute a WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum',[table])).rows;
      // Optional source tables can be absent on older installations.
      if(!columns.length){if(tables[table].length)fail('MISSING_SOURCE_SCHEMA');delete tables[table];continue;}
      const primaryKey=(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass($1) AND contype='p'",[table])).rows[0]?.definition;
      schema[table]={columns,primaryKey};
    }
    backup={format:'withbooth-contract-retirement',version:1,adminId,boothId:booth.id,createdAt:new Date().toISOString(),sourceReport:foundationReport(source),foundation,tables,schema,
      principals:(await db.query('SELECT id,deleted_at FROM pos_admins ORDER BY id')).rows,otherFingerprints:await otherDataFingerprints(db,adminId)};
    backup.fingerprint=backupHash(backup);
    await saveNew(join(directory,'before.json'),backup);
    await db.query('COMMIT');
  } catch(error){await db.query('ROLLBACK');throw error;}
  const rehearsal=await rehearseContractRetirement(backup);
  await saveNew(join(directory,'rehearsal.json'),rehearsal);
  return {backup,rehearsal};
}

export async function rehearseContractRetirement(backup) {
  if(backup.format!=='withbooth-contract-retirement'||backup.version!==1||backup.fingerprint!==backupHash(backup))fail('INVALID_BACKUP');
  const database=new PGlite(),db={query:async(text,values)=>{
    const result=await database.query(text,values);
    for(const field of result.fields||[])if(field.dataTypeID===20)for(const row of result.rows)if(row[field.name]!=null)row[field.name]=String(row[field.name]);
    return result;
  }};
  try {
    await database.exec('CREATE TABLE pos_admins(id TEXT PRIMARY KEY,deleted_at TIMESTAMPTZ)');
    await db.query('INSERT INTO pos_admins SELECT * FROM jsonb_populate_recordset(NULL::pos_admins,$1::jsonb)',[JSON.stringify(backup.principals)]);
    for(const [table,definition] of Object.entries(backup.schema)) {
      if(!allowed.has(table))fail('INVALID_BACKUP_TABLE');
      const columns=definition.columns.map(column=>{
        if(!/^(text|integer|bigint|boolean|jsonb|timestamp with time zone|timestamp without time zone|date|character varying\(\d+\)|numeric\(\d+,\d+\))$/.test(column.type))fail('UNSUPPORTED_SOURCE_COLUMN_TYPE');
        // Rehearsal only adds contract command/policy rows. Preserve their time
        // defaults without executing arbitrary default expressions from a file.
        const timestamp=['created_at','changed_at'].includes(column.name)&&column.type==='timestamp with time zone';
        return `${id(column.name)} ${column.type}${timestamp?' DEFAULT NOW()':''}${column.required?' NOT NULL':''}`;
      });
      if(definition.primaryKey){if(!/^PRIMARY KEY \([a-z_," ]+\)$/.test(definition.primaryKey))fail('INVALID_BACKUP_PRIMARY_KEY');columns.push(definition.primaryKey);}
      await database.exec(`CREATE TABLE ${id(table)} (${columns.join(',')})`);
    }
    for(const [table,rows] of Object.entries(backup.tables))if(rows.length) {
      if(!allowed.has(table)||!backup.schema[table])fail('INVALID_BACKUP_TABLE');
      await db.query(`INSERT INTO ${id(table)} SELECT * FROM jsonb_populate_recordset(NULL::${id(table)},$1::jsonb)`,[JSON.stringify(rows)]);
    }
    const sql=sqlFor(db);
    await db.query('BEGIN');await initContractRetirement(sql);
    const preflight=await retirementReport(sql,backup.adminId,backup.boothId);
    if(!preflight.ready)fail('ID_MAPPINGS_INCOMPLETE');
    if(preflight.sourceFingerprint!==backup.sourceReport.fingerprint)fail('CLONE_SOURCE_MISMATCH');
    const command={boothId:backup.boothId,requestId:randomUUID(),version:preflight.policy.version,expectedFingerprint:preflight.fingerprint,closed:true,queuesChecked:true};
    const result=await changeLegacyContracts(sql,backup.adminId,command);
    const replay=await changeLegacyContracts(sql,backup.adminId,command);
    if(['boothId','version','legacyWritesClosed','sourceFingerprint'].some(key=>result[key]!==replay[key]))fail('REPLAY_MISMATCH');
    const closed=await retirementReport(sql,backup.adminId,backup.boothId);
    await changeLegacyContracts(sql,backup.adminId,{boothId:backup.boothId,requestId:randomUUID(),version:closed.policy.version,expectedFingerprint:closed.fingerprint,closed:false});
    if(foundationReport(await legacySnapshot(sql,backup.adminId)).fingerprint!==backup.sourceReport.fingerprint)fail('REHEARSAL_SOURCE_CHANGED');
    await db.query('COMMIT');
    return {format:'withbooth-contract-rehearsal',version:1,passed:true,backupFingerprint:backup.fingerprint,adminId:backup.adminId,boothId:backup.boothId,preflight,command,closeReplayAndRecovery:true};
  }finally{await database.close();}
}

export async function applyContractRetirement(db,{backup,rehearsal,directory,queuesConfirmed,latestClientConfirmed}) {
  if(!queuesConfirmed||!latestClientConfirmed)fail('DEVICE_AND_CLIENT_CONFIRMATION_REQUIRED');
  if(backup.fingerprint!==backupHash(backup)||rehearsal?.passed!==true||rehearsal.backupFingerprint!==backup.fingerprint||rehearsal.adminId!==backup.adminId||rehearsal.boothId!==backup.boothId||rehearsal.command?.boothId!==backup.boothId||rehearsal.command?.closed!==true||rehearsal.command?.queuesChecked!==true)fail('MATCHED_REHEARSAL_REQUIRED');
  let committed=false;
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='30s'");
    // Acquire the original storage principal before taking any source snapshot.
    // Matching normal writers keeps a concurrent sale ahead of this diagnostic.
    await db.query('SELECT id FROM pos_admins WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[backup.adminId]);
    const sql=sqlFor(db);
    // The owner/custodian lock is also used by normal POS and stock writes.
    const source=foundationReport(await legacySnapshot(sql,backup.adminId));
    if(source.fingerprint!==backup.sourceReport.fingerprint)fail('SOURCE_CHANGED');
    const current=await foundationBackup(sql,backup.adminId);
    if(digest(withoutPolicy(current))!==digest(withoutPolicy(backup.foundation)))fail('RELATIONS_CHANGED');
    if(JSON.stringify(await otherDataFingerprints(db,backup.adminId))!==JSON.stringify(backup.otherFingerprints))fail('OTHER_ACCOUNT_DATA_CHANGED');
    await initContractRetirement(sql);
    const result=await changeLegacyContracts(sql,backup.adminId,rehearsal.command);
    if(foundationReport(await legacySnapshot(sql,backup.adminId)).fingerprint!==backup.sourceReport.fingerprint)fail('SOURCE_CHANGED');
    if(JSON.stringify(await otherDataFingerprints(db,backup.adminId))!==JSON.stringify(backup.otherFingerprints))fail('OTHER_ACCOUNT_DATA_CHANGED');
    const report={format:'withbooth-contract-application',status:'prepared',adminId:backup.adminId,boothId:backup.boothId,result,backupFingerprint:backup.fingerprint,sourceUnchanged:true,otherAccountsUnchanged:true,queuesConfirmed:true,latestClientConfirmed:true};
    await saveNew(join(directory,'applied.json'),report);
    await db.query('COMMIT');committed=true;
    report.status='applied';report.committedAt=new Date().toISOString();
    await writeFile(join(directory,'applied.json'),JSON.stringify(report,null,2),{mode:0o600});
    return report;
  }catch(error){if(!committed)await db.query('ROLLBACK');else fail('COMMITTED_REPORT_WRITE_FAILED');throw error;}
}

export async function verifyContractRetirement(db,{backup,rehearsal}) {
  const sql=sqlFor(db),source=foundationReport(await legacySnapshot(sql,backup.adminId));
  const policy=(await db.query('SELECT version,legacy_writes_closed FROM pos_booth_contract_policy WHERE booth_id=$1',[backup.boothId])).rows[0];
  const receipt=(await db.query('SELECT actor_id,booth_id,result FROM pos_booth_contract_commands WHERE id=$1',[rehearsal.command.requestId])).rows[0];
  if(!policy?.legacy_writes_closed||policy.version!==rehearsal.command.version+1||receipt?.actor_id!==backup.adminId||receipt?.booth_id!==backup.boothId||receipt?.result?.legacyWritesClosed!==true)fail('POLICY_VERIFICATION_FAILED');
  if(source.fingerprint!==backup.sourceReport.fingerprint||digest(withoutPolicy(await foundationBackup(sql,backup.adminId)))!==digest(withoutPolicy(backup.foundation)))fail('POST_COMMIT_SOURCE_CHANGED');
  if(JSON.stringify(await otherDataFingerprints(db,backup.adminId))!==JSON.stringify(backup.otherFingerprints))fail('POST_COMMIT_OTHER_ACCOUNT_CHANGED');
  return {verified:true,adminId:backup.adminId,boothId:backup.boothId,policy,report:source,sourceUnchanged:true,otherAccountsUnchanged:true};
}

async function main() {
  const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  const mode=['prepare','apply','verify'].find(m=>args.includes('--'+m));
  const directory=value('--directory'),adminId=value('--admin-id');
  if(!mode||!directory||!adminId)fail('EXPLICIT_MODE_ACCOUNT_DIRECTORY_REQUIRED');
  if(value('--env-file'))process.loadEnvFile(resolve(value('--env-file')));
  const connectionString=process.env.POSTGRES_URL_NON_POOLING||process.env.DATABASE_URL||process.env.POSTGRES_URL;
  if(!connectionString)fail('SERVER_DB_CONFIG_REQUIRED');
  const db=createClient({connectionString});let connected=false;
  const timer=setTimeout(()=>{console.error('Contract migration timed out; inspect its saved report before retrying.');process.exit(2);},90000);
  try {
    await db.connect();connected=true;
    if(mode==='prepare') {
      const {backup,rehearsal}=await prepareContractRetirement(db,{adminId,directory});
      console.log(JSON.stringify({mode,adminId,boothId:backup.boothId,ready:rehearsal.preflight.ready,rehearsalPassed:rehearsal.passed,report:backup.sourceReport}));return;
    }
    const backup=JSON.parse(await readFile(join(directory,'before.json'),'utf8')),rehearsal=JSON.parse(await readFile(join(directory,'rehearsal.json'),'utf8'));
    if(backup.adminId!==adminId)fail('BACKUP_ACCOUNT_MISMATCH');
    if(mode==='apply')console.log(JSON.stringify({mode,...await applyContractRetirement(db,{backup,rehearsal,directory,queuesConfirmed:args.includes('--queues-confirmed'),latestClientConfirmed:args.includes('--latest-client-confirmed')})}));
    else {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const verified=await verifyContractRetirement(db,{backup,rehearsal});
      await saveNew(join(directory,'verified.json'),verified);await db.query('COMMIT');
      console.log(JSON.stringify({mode,...verified}));
    }
  } catch(error){if(connected)await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({mode,connected,code:/^[A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'CONNECTION_OR_QUERY_FAILED',status:error.status}));process.exitCode=1;}
  finally{clearTimeout(timer);if(connected)await db.end().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('CONTRACT_MIGRATION_COMMAND_FAILED');process.exitCode=1;});
