import { createClient } from '@vercel/postgres';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { legacySnapshot, foundationReport, migrateLegacyBooth } from '../api/lib/boothFoundation.js';

const sourceTables={projects:'pos_projects',inventory:'pos_inventory',products:'pos_products',bundles:'pos_bundles',sales:'pos_sales',links:'pos_inventory_links',receipts:'pos_sale_receipts',settlements:'pos_settlements',closures:'pos_event_settlements',adjustments:'pos_inventory_adjustments',transfers:'pos_inventory_transfers',movements:'pos_stock_movements',numbers:'pos_inventory_numbers',restoreReceipts:'pos_account_restores',settlementCommands:'pos_settlement_commands',archives:'pos_event_archives'};
const scopedTables=new Set(['pos_inventory','pos_inventory_links','pos_settlements','pos_event_settlements','pos_inventory_adjustments','pos_inventory_transfers','pos_stock_movements','pos_inventory_numbers','pos_account_restores','pos_settlement_commands']);
const migrationError=code=>Object.assign(new Error(code),{code});
const tagged=db=>(parts,...values)=>db.query(parts.reduce((text,part,i)=>text+(i?`$${i}`:'')+part,''),values);
const identifier=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw migrationError('INVALID_SCHEMA_IDENTIFIER');return '"'+value+'"';};
async function saveNew(path,value){await mkdir(dirname(resolve(path)),{recursive:true});await writeFile(resolve(path),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});}

export async function otherDataFingerprints(db,adminId) {
  const result={};
  for(const table of Object.values(sourceTables)) {
    let where;
    if(table==='pos_projects') where='r.admin_id<>$1';
    else if(scopedTables.has(table)) where='r.admin_id<>$1';
    else if(table==='pos_event_archives') where="NOT (r.project_id IN (SELECT id FROM pos_projects WHERE admin_id=$1) OR COALESCE(r.snapshot->'project'->>'admin_id','')=$1)";
    else where='r.project_id IN (SELECT id FROM pos_projects WHERE admin_id<>$1)';
    // Table identifiers are a fixed local allowlist, never request/file content.
    // Match legacySnapshot's nullable-column normalization without masking a
    // real deletion marker (or any other account data change).
    const row=table==='pos_projects'?"(to_jsonb(r)||jsonb_build_object('deleted_at',COALESCE(to_jsonb(r)->'deleted_at','null'::jsonb)))":'to_jsonb(r)';
    result[table]=(await db.query(`SELECT COUNT(*)::int AS count,md5(COALESCE(jsonb_agg(${row} ORDER BY (${row})::text),'[]'::jsonb)::text) AS fingerprint FROM ${table} r WHERE ${where}`,[adminId])).rows[0];
  }
  if((await db.query("SELECT to_regclass('pos_meta') AS name")).rows[0].name) result.pos_meta=(await db.query("SELECT COUNT(*)::int AS count,md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb)::text) AS fingerprint FROM pos_meta r")).rows[0];
  return result;
}

export async function exportLegacyAccount(db,{adminId,backupFile}) {
  if(!adminId || !backupFile)throw migrationError('EXPLICIT_ACCOUNT_AND_BACKUP_REQUIRED');
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    if(!(await db.query('SELECT id FROM pos_admins WHERE id=$1 AND deleted_at IS NULL',[adminId])).rows.length)throw migrationError('ACTIVE_ACCOUNT_NOT_FOUND');
    const source=await legacySnapshot(tagged(db),adminId),report=foundationReport(source);
    const schema={};
    for(const table of Object.values(sourceTables)) {
      const columns=(await db.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required FROM pg_attribute a WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[table])).rows;
      const primaryKey=(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass($1) AND contype='p'",[table])).rows[0]?.definition;
      schema[table]={columns,primaryKey};
    }
    const backup={format:'withbooth-legacy-migration',version:1,adminId,createdAt:new Date().toISOString(),source,report,schema,otherFingerprints:await otherDataFingerprints(db,adminId)};
    await saveNew(backupFile,backup);
    await db.query('COMMIT');
    return backup;
  }catch(error){await db.query('ROLLBACK');throw error;}
}

async function loadBackup(file) {
  const backup=JSON.parse(await readFile(resolve(file),'utf8'));
  if(backup.format!=='withbooth-legacy-migration' || backup.version!==1 || !backup.adminId || foundationReport(backup.source).fingerprint!==backup.report.fingerprint)throw migrationError('INVALID_BACKUP');
  return backup;
}

export async function rehearseLegacyAccount(backup) {
  const db=new PGlite();
  // Match node-postgres' int8 representation so a cross-driver comparison does
  // not mistake an identical BIGINT value for a source-data change.
  const adapter={query:async(text,values)=>{
    const result=await db.query(text,values);
    for(const field of result.fields || []) if(field.dataTypeID===20) for(const row of result.rows) if(row[field.name]!=null)row[field.name]=String(row[field.name]);
    return result;
  }};
  try {
    await db.exec('CREATE TABLE pos_admins(id TEXT PRIMARY KEY,deleted_at TIMESTAMPTZ)');
    await db.query('INSERT INTO pos_admins(id) VALUES($1)',[backup.adminId]);
    for(const table of Object.values(sourceTables)) {
      const definition=backup.schema[table];
      if(!definition?.columns.length)throw migrationError('MISSING_SOURCE_SCHEMA');
      const columns=definition.columns.map(column=>{
        if(!/^(text|integer|bigint|boolean|jsonb|timestamp with time zone|timestamp without time zone|date|character varying\(\d+\)|numeric\(\d+,\d+\))$/.test(column.type))throw migrationError('UNSUPPORTED_SOURCE_COLUMN_TYPE');
        return `${identifier(column.name)} ${column.type}${column.required?' NOT NULL':''}`;
      });
      if(definition.primaryKey) {
        if(!/^PRIMARY KEY \([a-z_," ]+\)$/.test(definition.primaryKey))throw migrationError('INVALID_SOURCE_PRIMARY_KEY');
        columns.push(definition.primaryKey);
      }
      await db.exec(`CREATE TABLE ${identifier(table)} (${columns.join(',')})`);
    }
    for(const [key,table] of Object.entries(sourceTables)) if(backup.source[key].length) await db.query(`INSERT INTO ${identifier(table)} SELECT * FROM jsonb_populate_recordset(NULL::${identifier(table)},$1::jsonb)`,[JSON.stringify(backup.source[key])]);
    const sql=tagged(adapter);
    const before=foundationReport(await legacySnapshot(sql,backup.adminId));
    if(before.fingerprint!==backup.report.fingerprint)throw migrationError('CLONE_SOURCE_MISMATCH');
    await db.query('BEGIN');
    const migrated=await migrateLegacyBooth(sql,backup.adminId,{dryRun:false,expectedFingerprint:before.fingerprint});
    await db.query('COMMIT');
    await db.query('BEGIN');
    const repeated=await migrateLegacyBooth(sql,backup.adminId,{dryRun:false,expectedFingerprint:before.fingerprint});
    await db.query('COMMIT');
    if(repeated.boothId!==migrated.boothId || repeated.report.fingerprint!==before.fingerprint)throw migrationError('REHEARSAL_REPLAY_MISMATCH');
    const identities=(await db.query('SELECT COUNT(*)::int AS count FROM pos_inventory_owners')).rows[0].count;
    if(identities!==before.counts.inventory)throw migrationError('REHEARSAL_INVENTORY_MAPPING_MISMATCH');
    return {format:'withbooth-migration-rehearsal',version:1,adminId:backup.adminId,sourceFingerprint:before.fingerprint,boothId:migrated.boothId,passed:true,report:migrated.report};
  }finally{await db.close();}
}

export async function applyLegacyAccount(db,{backup,rehearsal,reportFile}) {
  if(!reportFile || rehearsal?.passed!==true || rehearsal.adminId!==backup.adminId || rehearsal.sourceFingerprint!==backup.report.fingerprint)throw migrationError('SUCCESSFUL_REHEARSAL_REQUIRED');
  let committed=false;
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  try {
    await db.query("SET LOCAL lock_timeout='5s'");
    await db.query("SET LOCAL statement_timeout='30s'");
    const migrated=await migrateLegacyBooth(tagged(db),backup.adminId,{dryRun:false,expectedFingerprint:backup.report.fingerprint});
    const other=await otherDataFingerprints(db,backup.adminId);
    if(JSON.stringify(other)!==JSON.stringify(backup.otherFingerprints))throw migrationError('OTHER_ACCOUNT_DATA_CHANGED');
    const report={format:'withbooth-migration-application',version:1,status:'prepared',adminId:backup.adminId,boothId:migrated.boothId,sourceUnchanged:true,otherAccountsUnchanged:true,report:migrated.report,backupCreatedAt:backup.createdAt};
    // A failed backup/report write cannot leave a partially applied migration.
    await saveNew(reportFile,report);
    await db.query('COMMIT');committed=true;
    report.status='applied';report.committedAt=new Date().toISOString();
    await writeFile(resolve(reportFile),JSON.stringify(report,null,2),{mode:0o600});
    return report;
  }catch(error){if(!committed)await db.query('ROLLBACK');else throw migrationError('COMMITTED_REPORT_WRITE_FAILED');throw error;}
}

export async function verifyLegacyAccount(db,backup) {
  const report=foundationReport(await legacySnapshot(tagged(db),backup.adminId));
  const other=await otherDataFingerprints(db,backup.adminId);
  const booth=(await db.query('SELECT id,name FROM pos_booths WHERE legacy_admin_id=$1',[backup.adminId])).rows[0];
  if(!booth)throw migrationError('MIGRATED_BOOTH_NOT_FOUND');
  const counts=(await db.query(`SELECT
    (SELECT COUNT(*)::int FROM pos_event_booths WHERE booth_id=$1) AS events,
    (SELECT COUNT(*)::int FROM pos_inventory_owners WHERE admin_id=$2) AS inventory,
    (SELECT COUNT(*)::int FROM pos_inventory_openings WHERE admin_id=$2) AS openings,
    (SELECT COUNT(*)::int FROM pos_event_product_identities i JOIN pos_event_booths e ON e.project_id=i.project_id WHERE e.booth_id=$1) AS products,
    (SELECT COUNT(*)::int FROM pos_artist_profiles p JOIN pos_stock_owners o ON o.id=p.owner_id WHERE o.origin_booth_id=$1) AS artist_profiles`,[booth.id,backup.adminId])).rows[0];
  const verified=report.fingerprint===backup.report.fingerprint && JSON.stringify(other)===JSON.stringify(backup.otherFingerprints)
    && counts.events===backup.report.counts.projects && counts.inventory===backup.report.counts.inventory
    && counts.openings===backup.report.counts.inventory && counts.products===backup.report.counts.products;
  if(!verified)throw migrationError('POST_COMMIT_VERIFICATION_MISMATCH');
  return {adminId:backup.adminId,verified:true,sourceUnchanged:true,otherAccountsUnchanged:true,booth,counts,report};
}

export async function inspectLegacyData(db) {
  const tables=(await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'pos_%' ORDER BY table_name")).rows.map(row=>row.table_name);
  const projects=(await db.query(`SELECT p.id,p.admin_id,p.name,p.archived_at,
    (SELECT COUNT(*)::int FROM pos_products r WHERE r.project_id=p.id) AS products,
    (SELECT COUNT(*)::int FROM pos_sales r WHERE r.project_id=p.id) AS sales,
    (SELECT COALESCE(SUM(total),0)::text FROM pos_sales r WHERE r.project_id=p.id) AS sale_total
    FROM pos_projects p ORDER BY p.admin_id,p.created_at,p.id`)).rows;
  const inventory=(await db.query('SELECT admin_id,COUNT(*)::int AS products,SUM(stock)::text AS warehouse FROM pos_inventory GROUP BY admin_id ORDER BY admin_id')).rows;
  return {tables,projects,inventory};
}

async function main() {
  const args=process.argv.slice(2);
  const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
  const mode=['inspect','export','rehearse','apply','verify'].find(mode=>args.includes('--'+mode));
  if(!mode)throw migrationError('EXPLICIT_MODE_REQUIRED');
  const backupFile=value('--backup-file'),reportFile=value('--report-file');
  if(mode==='rehearse') {
    const report=await rehearseLegacyAccount(await loadBackup(backupFile));
    await saveNew(reportFile,report);console.log(JSON.stringify(report));return;
  }
  if(value('--env-file')) process.loadEnvFile(resolve(value('--env-file')));
  const connectionString=process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if(!connectionString) throw new Error('NO_SERVER_DB_CONFIG');
  const db=createClient({connectionString});
  let connected=false;
  const timer=setTimeout(()=>{console.error('Migration command timed out; inspect its saved report and database transaction status before retrying.');process.exit(2);},mode==='apply'?300000:60000);
  try {
    await db.connect();connected=true;
    let result;
    if(mode==='inspect') {
      await db.query('BEGIN READ ONLY');result=await inspectLegacyData(db);await db.query('ROLLBACK');
    }else if(mode==='export') {
      const backup=await exportLegacyAccount(db,{adminId:value('--admin-id'),backupFile});
      result={adminId:backup.adminId,backupFile:resolve(backupFile),report:backup.report};
    }else if(mode==='verify') {
      const backup=await loadBackup(backupFile);
      if(value('--admin-id')!==backup.adminId)throw migrationError('BACKUP_ACCOUNT_MISMATCH');
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      result=await verifyLegacyAccount(db,backup);
      if(reportFile)await saveNew(reportFile,result);
      await db.query('COMMIT');
    }else {
      const backup=await loadBackup(backupFile);
      if(value('--admin-id')!==backup.adminId)throw migrationError('BACKUP_ACCOUNT_MISMATCH');
      const rehearsal=JSON.parse(await readFile(resolve(value('--rehearsal-file')),'utf8'));
      result=await applyLegacyAccount(db,{backup,rehearsal,reportFile});
    }
    console.log(JSON.stringify({mode,...result}));
  } catch(error) {
    if(connected) await db.query('ROLLBACK').catch(()=>{});
    // A driver error may contain a connection URL. Never print it or its stack.
    const message=String(error.message || '');
    console.error(JSON.stringify({mode,connected,code:typeof error.code==='string'?error.code:'CONNECTION_OR_QUERY_FAILED',
      diagnostics:{dns:/ENOTFOUND|EAI_AGAIN/.test(message),refused:/ECONNREFUSED/.test(message),permissions:/EACCES|EPERM|denied/i.test(message),websocket:/WebSocket|websocket/.test(message)}}));
    process.exitCode=1;
  } finally {clearTimeout(timer);if(connected)await db.end().catch(()=>{});}
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch(error=>{console.error(JSON.stringify({mode:'migration',code:/^[A-Z0-9_]{1,80}$/.test(error.code || '')?error.code:'MIGRATION_COMMAND_FAILED'}));process.exitCode=1;});
