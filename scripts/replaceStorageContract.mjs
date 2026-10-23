import {createClient} from '@vercel/postgres';
import {PGlite} from '@electric-sql/pglite';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {storageShape,storageDigests,replaceStorageNames} from '../api/lib/storageMigration.js';
import {canonicalSql} from '../api/lib/storageContract.js';
import {legacySnapshot,foundationReport,migrateLegacyBooth} from '../api/lib/boothFoundation.js';
import {initArtistStock} from '../api/lib/artistStock.js';
import {initEventAccess,workspaceEvents} from '../api/lib/eventAccess.js';

const ident=value=>{if(!/^[a-z_][a-z0-9_]*$/.test(value))throw new Error('INVALID_IDENTIFIER');return '"'+value+'"';};
const tagged=db=>(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
const fail=code=>{throw Object.assign(new Error(code),{code});};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const saveNew=(path,data)=>writeFile(path,JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
const hashBackup=backup=>digest({...backup,fingerprint:undefined});

export async function prepareStorageReplacement(db,{directory}) {
 await mkdir(resolve(directory),{recursive:true});
 await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 let backup;
 try {
  const shape=await storageShape(db);if(shape.pos_artist_inventory)fail('ALREADY_CANONICAL');
  const schema={},tables={};
  for(const table of Object.keys(shape)) {
   const columns=(await db.query('SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS default_value FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum',[table])).rows;
   // Authentication/invitation secrets are never copied into a migration file.
   const exported=table==='pos_admins'?columns.filter(c=>['id','deleted_at'].includes(c.name)):columns.filter(c=>!['token_hash','password_hash','password','token'].includes(c.name));
   const constraints=table==='pos_admins'?['PRIMARY KEY (id)']:(await db.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=to_regclass($1) AND contype IN ('p','u','c','f') ORDER BY contype,oid",[table])).rows.map(r=>r.definition);
   schema[table]={columns:exported,constraints};
   tables[table]=(await db.query(`SELECT ${exported.map(c=>ident(c.name)).join(',')} FROM ${ident(table)}`)).rows;
  }
  backup={format:'withbooth-storage-replacement',version:1,createdAt:new Date().toISOString(),shape,schema,tables,digests:await storageDigests(db,shape)};
  backup.fingerprint=hashBackup(backup);await saveNew(join(directory,'before.json'),backup);await db.query('COMMIT');
 } catch(error){await db.query('ROLLBACK');throw error;}
 const rehearsal=await rehearseStorageReplacement(backup);
 await saveNew(join(directory,'rehearsal.json'),rehearsal);
 return {backup,rehearsal};
}

async function transition(db) {
 let sql=tagged(db);
 const accounts=(await db.query('SELECT DISTINCT admin_id FROM pos_projects UNION SELECT DISTINCT admin_id FROM pos_inventory ORDER BY admin_id')).rows.map(r=>r.admin_id);
 const before={};
 for(const account of accounts) {
  before[account]=foundationReport(await legacySnapshot(sql,account));
  await migrateLegacyBooth(sql,account,{dryRun:false,expectedFingerprint:before[account].fingerprint});
 }
 await initArtistStock(sql);await initEventAccess(sql);
 const physical=await replaceStorageNames(db);
 sql=await canonicalSql(sql);
 const reports={};
 for(const account of accounts) {
  reports[account]=foundationReport(await legacySnapshot(sql,account));
  if(reports[account].fingerprint!==before[account].fingerprint)fail('SOURCE_CHANGED');
  await workspaceEvents(sql,account);
 }
 return {physical,reports};
}

export async function rehearseStorageReplacement(backup) {
 if(backup.format!=='withbooth-storage-replacement'||backup.fingerprint!==hashBackup(backup))fail('INVALID_BACKUP');
 const database=new PGlite();
 const db={query:async(text,values)=>{const result=await database.query(text,values);for(const field of result.fields||[])if(field.dataTypeID===20)for(const row of result.rows)if(row[field.name]!=null)row[field.name]=String(row[field.name]);return result;}};
 try {
  for(const [table,definition] of Object.entries(backup.schema)) {
   const columns=definition.columns.map(c=>{
    if(!/^(text|integer|bigint|boolean|jsonb|timestamp with time zone|timestamp without time zone|date|character varying\(\d+\)|numeric\(\d+,\d+\))$/.test(c.type))fail('UNSUPPORTED_COLUMN_TYPE');
    const safeDefault=c.default_value&&/^(now\(\)|CURRENT_TIMESTAMP|true|false|-?\d+|'(?:''|[^'])*'(?:::[a-z0-9_ ]+)?)$/i.test(c.default_value)?` DEFAULT ${c.default_value}`:'';
    return `${ident(c.name)} ${c.type}${safeDefault}${c.required?' NOT NULL':''}`;
   });
   // Rehearsal excludes secret columns and constraints involving them.
   const constraints=definition.constraints.filter(c=>!c.startsWith('FOREIGN KEY')&&!/token_hash|password/.test(c));
   for(const c of constraints)if(!/^(PRIMARY KEY|UNIQUE|CHECK) [a-zA-Z0-9_()\[\]'", .:~<>=+*-]+$/.test(c.replace(/'(?:''|[^'])*'/g,"''")))fail('UNSUPPORTED_CONSTRAINT');
   await database.exec(`CREATE TABLE ${ident(table)} (${[...columns,...constraints].join(',')})`);
  }
  for(const [table,rows] of Object.entries(backup.tables))if(rows.length)await db.query(`INSERT INTO ${ident(table)} SELECT * FROM jsonb_populate_recordset(NULL::${ident(table)},$1::jsonb)`,[JSON.stringify(rows)]);
  await db.query('BEGIN');const result=await transition(db);await db.query('COMMIT');
  return {format:'withbooth-storage-rehearsal',passed:true,backupFingerprint:backup.fingerprint,reports:result.reports,renamedTables:result.physical.tables};
 }finally{await database.close();}
}

export async function applyStorageReplacement(db,{backup,rehearsal,directory}) {
 if(backup.fingerprint!==hashBackup(backup)||!rehearsal.passed||rehearsal.backupFingerprint!==backup.fingerprint)fail('MATCHED_REHEARSAL_REQUIRED');
 let committed=false;
 await db.query('BEGIN');
 try {
  await db.query("SET LOCAL lock_timeout='5s'");await db.query("SET LOCAL statement_timeout='45s'");
  await db.query(`LOCK TABLE ${Object.keys(backup.shape).sort().map(ident).join(',')} IN ACCESS EXCLUSIVE MODE`);
  if(JSON.stringify(await storageDigests(db,backup.shape))!==JSON.stringify(backup.digests))fail('SOURCE_CHANGED');
  const result=await transition(db);
  const report={format:'withbooth-storage-application',status:'prepared',backupFingerprint:backup.fingerprint,...result};
  await saveNew(join(directory,'applied.json'),report);
  await db.query('COMMIT');committed=true;report.status='applied';report.committedAt=new Date().toISOString();
  await writeFile(join(directory,'applied.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
 } catch(error){if(!committed)await db.query('ROLLBACK');else fail('COMMITTED_REPORT_WRITE_FAILED');throw error;}
}

async function main() {
 const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 const mode=['prepare','rehearse','apply','verify'].find(m=>args.includes('--'+m)),directory=value('--directory');
 if(!mode||!directory)fail('EXPLICIT_MODE_DIRECTORY_REQUIRED');
 if(mode==='rehearse') {
  const backup=JSON.parse(await readFile(join(directory,'before.json'),'utf8'));
  const rehearsal=await rehearseStorageReplacement(backup);await saveNew(join(directory,'rehearsal.json'),rehearsal);
  console.log(JSON.stringify({mode,passed:rehearsal.passed,reports:rehearsal.reports}));return;
 }
 if(value('--env-file'))process.loadEnvFile(resolve(value('--env-file')));
 const connectionString=process.env.POSTGRES_URL_NON_POOLING||process.env.DATABASE_URL||process.env.POSTGRES_URL;
 if(!connectionString)fail('SERVER_DB_CONFIG_REQUIRED');
 const db=createClient({connectionString});let connected=false;
 const timer=setTimeout(()=>{console.error('Storage transition timed out; inspect its saved reports before retry.');process.exit(2);},240000);
 try {
  await db.connect();connected=true;
  if(mode==='prepare'){const {backup,rehearsal}=await prepareStorageReplacement(db,{directory});console.log(JSON.stringify({mode,passed:rehearsal.passed,backupFingerprint:backup.fingerprint,reports:rehearsal.reports}));}
  else {
   const backup=JSON.parse(await readFile(join(directory,'before.json'),'utf8')),rehearsal=JSON.parse(await readFile(join(directory,'rehearsal.json'),'utf8'));
   if(mode==='apply') {const report=await applyStorageReplacement(db,{backup,rehearsal,directory});console.log(JSON.stringify({mode,status:report.status,reports:report.reports}));}
   else {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const sql=await canonicalSql(tagged(db)),reports={};
    for(const [account,expected] of Object.entries(rehearsal.reports)) {
     reports[account]=foundationReport(await legacySnapshot(sql,account));if(reports[account].fingerprint!==expected.fingerprint)fail('POST_COMMIT_SOURCE_CHANGED');
    }
    const report={verified:true,reports,shape:await storageShape(db)};await saveNew(join(directory,'verified.json'),report);await db.query('COMMIT');console.log(JSON.stringify({mode,verified:true,reports}));
   }
  }
 }catch(error){if(connected)await db.query('ROLLBACK').catch(()=>{});console.error(JSON.stringify({mode,connected,code:error.code||(/^[A-Z0-9_]+$/.test(error.message||'')?error.message:'STORAGE_TRANSITION_FAILED'),status:error.status}));process.exitCode=1;}
 finally{clearTimeout(timer);if(connected)await db.end().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('STORAGE_TRANSITION_COMMAND_FAILED');process.exitCode=1;});
