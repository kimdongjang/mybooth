import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { otherDataFingerprints, exportLegacyAccount, rehearseLegacyAccount, applyLegacyAccount, verifyLegacyAccount } from '../scripts/migrateLegacyBooth.mjs';
import {prepareContractRetirement,applyContractRetirement,verifyContractRetirement} from '../scripts/retireLegacyContracts.mjs';
import {migrateLegacyBooth} from '../api/lib/boothFoundation.js';
import {initContractRetirement} from '../api/lib/contractRetirement.js';
import {prepareStorageReplacement,applyStorageReplacement} from '../scripts/replaceStorageContract.mjs';
const tagged=db=>(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
const migrateFixture=async f=>{
 const sql=tagged(f.db),preview=await migrateLegacyBooth(sql,'a',{dryRun:true});
 return migrateLegacyBooth(sql,'a',{dryRun:false,expectedFingerprint:preview.report.fingerprint});
};

async function fixture() {
  const database=new PGlite();
  await database.exec(`
    CREATE TABLE pos_admins(id TEXT PRIMARY KEY,deleted_at TIMESTAMPTZ);INSERT INTO pos_admins(id) VALUES('a'),('b');
    CREATE TABLE pos_projects(id TEXT PRIMARY KEY,admin_id TEXT,name TEXT);INSERT INTO pos_projects VALUES('july','a','7월'),('other','b','타 계정');
    CREATE TABLE pos_inventory(admin_id TEXT,id TEXT,product JSONB,stock INTEGER,version INTEGER,total_received BIGINT,total_estimated BOOLEAN,PRIMARY KEY(admin_id,id));
    INSERT INTO pos_inventory VALUES('a','i','{"name":"무료 상품","creatorName":"작가"}',3,0,10,FALSE);
    CREATE TABLE pos_products(project_id TEXT,id TEXT,name TEXT,creator_name TEXT,price INTEGER,stock INTEGER,stock_qty INTEGER,initial_stock_qty INTEGER,PRIMARY KEY(project_id,id));
    INSERT INTO pos_products VALUES('july','p','무료 상품','작가',0,7,7,7);
    CREATE TABLE pos_bundles(project_id TEXT,id TEXT,items JSONB,PRIMARY KEY(project_id,id));
    CREATE TABLE pos_sales(project_id TEXT,id TEXT,total INTEGER,lines JSONB,PRIMARY KEY(project_id,id));
    CREATE TABLE pos_inventory_links(admin_id TEXT,inventory_id TEXT,project_id TEXT,product_id TEXT,PRIMARY KEY(project_id,product_id));INSERT INTO pos_inventory_links VALUES('a','i','july','p');
    CREATE TABLE pos_sale_receipts(project_id TEXT,id TEXT,voided BOOLEAN,PRIMARY KEY(project_id,id));
    CREATE TABLE pos_settlements(admin_id TEXT,project_id TEXT,creator TEXT,deductions JSONB,payments JSONB,PRIMARY KEY(admin_id,project_id,creator));
    CREATE TABLE pos_event_settlements(admin_id TEXT,project_id TEXT PRIMARY KEY,snapshot JSONB);
    CREATE TABLE pos_inventory_adjustments(admin_id TEXT,id TEXT PRIMARY KEY,inventory_id TEXT,delta INTEGER);
    CREATE TABLE pos_inventory_transfers(admin_id TEXT,id TEXT,request JSONB,PRIMARY KEY(admin_id,id));
    CREATE TABLE pos_stock_movements(admin_id TEXT,id TEXT,request JSONB,PRIMARY KEY(admin_id,id));
    CREATE TABLE pos_inventory_numbers(admin_id TEXT PRIMARY KEY,prefix TEXT,last_number INTEGER);
    CREATE TABLE pos_account_restores(admin_id TEXT,id TEXT,fingerprint TEXT,PRIMARY KEY(admin_id,id));
    CREATE TABLE pos_settlement_commands(admin_id TEXT,id TEXT,fingerprint TEXT,PRIMARY KEY(admin_id,id));
    CREATE TABLE pos_event_archives(project_id TEXT PRIMARY KEY,snapshot JSONB);
    CREATE TABLE pos_meta(id TEXT PRIMARY KEY,value TEXT);INSERT INTO pos_meta VALUES('global','preserved');
  `);
  const db={query:async(text,values)=>{const result=await database.query(text,values);for(const f of result.fields || [])if(f.dataTypeID===20)for(const row of result.rows)if(row[f.name]!=null)row[f.name]=String(row[f.name]);return result;}};
  const directory=await mkdtemp(join(tmpdir(),'withbooth-migration-'));
  const backupFile=join(directory,'before.json'),reportFile=join(directory,'applied.json');
  const close=async()=>{await database.close();for(const path of [backupFile,reportFile,join(directory,'rehearsal.json'),join(directory,'verified.json')])await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});await rmdir(directory);};
  return {db,database,backupFile,reportFile,directory,close};
}

test('real-data migration runner exports, rehearses/replays and applies only with intact source and other-account data',async()=>{
  const f=await fixture();try{
    const backup=await exportLegacyAccount(f.db,{adminId:'a',backupFile:f.backupFile});
    assert.equal(backup.source.inventory[0].total_received,'10');
    assert.equal(JSON.parse(await readFile(f.backupFile,'utf8')).adminId,'a');
    assert.equal((await f.db.query("SELECT to_regclass('pos_booths') AS name")).rows[0].name,null);
    const rehearsal=await rehearseLegacyAccount(backup);assert.equal(rehearsal.passed,true);
    const result=await applyLegacyAccount(f.db,{backup,rehearsal,reportFile:f.reportFile});
    assert.equal(result.status,'applied');assert.equal(result.sourceUnchanged,true);assert.equal(result.otherAccountsUnchanged,true);
    assert.equal((await f.db.query('SELECT stock FROM pos_inventory')).rows[0].stock,3);
    assert.equal((await f.db.query("SELECT name FROM pos_projects WHERE id='other'")).rows[0].name,'타 계정');
    assert.equal(JSON.parse(await readFile(f.reportFile,'utf8')).status,'applied');
    const verified=await verifyLegacyAccount(f.db,backup);assert.equal(verified.verified,true);assert.equal(verified.counts.inventory,1);
  }finally{await f.close();}
});

test('contract migration backs up without authentication secrets, rehearses close/replay/recovery, applies and verifies source preservation',async()=>{
 const f=await fixture();try {
  await f.database.exec("ALTER TABLE pos_admins ADD COLUMN password_hash TEXT;UPDATE pos_admins SET password_hash='never-copy-auth-hash'");
  await migrateFixture(f);
  const prepared=await prepareContractRetirement(f.db,{adminId:'a',directory:f.directory});
  assert.equal(prepared.rehearsal.passed,true);assert.equal(prepared.rehearsal.closeReplayAndRecovery,true);
  assert.equal((await f.db.query("SELECT to_regclass('pos_booth_contract_policy') AS name")).rows[0].name,null,'prepare never installs real schema');
  assert.equal(JSON.stringify(prepared.backup).includes('never-copy-auth-hash'),false);
  await assert.rejects(applyContractRetirement(f.db,{...prepared,directory:f.directory}),e=>e.code==='DEVICE_AND_CLIENT_CONFIRMATION_REQUIRED');
  const applied=await applyContractRetirement(f.db,{...prepared,directory:f.directory,queuesConfirmed:true,latestClientConfirmed:true});
  assert.equal(applied.status,'applied');
  const verified=await verifyContractRetirement(f.db,prepared);
  assert.equal(verified.verified,true);assert.equal(verified.sourceUnchanged,true);assert.equal(verified.otherAccountsUnchanged,true);
  assert.equal(verified.report.counts.inventory,1);assert.equal(verified.policy.legacy_writes_closed,true);
  assert.equal(JSON.parse(await readFile(f.reportFile,'utf8')).status,'applied');
 }finally{await f.close();}
});

test('contract migration refuses an occupied backup path, stale data and a mismatched rehearsal without installing policy',async()=>{
 const f=await fixture();try {
  await migrateFixture(f);
  await writeFile(f.backupFile,'keep-original',{flag:'wx'});
  await assert.rejects(prepareContractRetirement(f.db,{adminId:'a',directory:f.directory}),e=>e.code==='EEXIST');
  assert.equal(await readFile(f.backupFile,'utf8'),'keep-original');await unlink(f.backupFile);
  const prepared=await prepareContractRetirement(f.db,{adminId:'a',directory:f.directory});
  const options={...prepared,directory:f.directory,queuesConfirmed:true,latestClientConfirmed:true};
  await assert.rejects(applyContractRetirement(f.db,{...options,rehearsal:{...prepared.rehearsal,backupFingerprint:'bad'}}),e=>e.code==='MATCHED_REHEARSAL_REQUIRED');
  await f.db.query("UPDATE pos_inventory SET stock=stock+1 WHERE admin_id='a'");
  await assert.rejects(applyContractRetirement(f.db,options),e=>e.code==='SOURCE_CHANGED');
  assert.equal((await f.db.query("SELECT to_regclass('pos_booth_contract_policy') AS name")).rows[0].name,null);
 }finally{await f.close();}
});

test('contract migration command failure rolls back the policy and can retry using its verified backup',async()=>{
 const f=await fixture();try {
  await migrateFixture(f);
  const prepared=await prepareContractRetirement(f.db,{adminId:'a',directory:f.directory});
  await initContractRetirement(tagged(f.db));
  await f.database.exec("CREATE FUNCTION fail_contract_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected'; END $$;CREATE TRIGGER fail_contract BEFORE INSERT ON pos_booth_contract_commands FOR EACH ROW EXECUTE FUNCTION fail_contract_command()");
  const options={...prepared,directory:f.directory,queuesConfirmed:true,latestClientConfirmed:true};
  await assert.rejects(applyContractRetirement(f.db,options),/injected/);
  assert.equal((await f.db.query('SELECT * FROM pos_booth_contract_policy')).rows.length,0);
  await f.database.exec('DROP TRIGGER fail_contract ON pos_booth_contract_commands');
  assert.equal((await applyContractRetirement(f.db,options)).status,'applied');
  assert.equal((await verifyContractRetirement(f.db,prepared)).verified,true);
 }finally{await f.close();}
});

test('backup write failure leaves no migration and a changed target rejects the rehearsed plan',async()=>{
  const f=await fixture();try{
    await writeFile(f.backupFile,'sentinel',{flag:'wx'});
    await assert.rejects(exportLegacyAccount(f.db,{adminId:'a',backupFile:f.backupFile}),error=>error.code==='EEXIST');
    assert.equal(await readFile(f.backupFile,'utf8'),'sentinel');await unlink(f.backupFile);
    const backup=await exportLegacyAccount(f.db,{adminId:'a',backupFile:f.backupFile});const rehearsal=await rehearseLegacyAccount(backup);
    await f.db.query("UPDATE pos_inventory SET stock=stock+1 WHERE admin_id='a'");
    await assert.rejects(applyLegacyAccount(f.db,{backup,rehearsal,reportFile:f.reportFile}),error=>error.status===409);
    assert.equal((await f.db.query("SELECT to_regclass('pos_booths') AS name")).rows[0].name,null);
  }finally{await f.close();}
});

test('missing rehearsal and changes to another account prevent commit and roll back added schemas',async()=>{
  const f=await fixture();try{
    const backup=await exportLegacyAccount(f.db,{adminId:'a',backupFile:f.backupFile});
    await assert.rejects(applyLegacyAccount(f.db,{backup,rehearsal:{passed:false},reportFile:f.reportFile}),error=>error.code==='SUCCESSFUL_REHEARSAL_REQUIRED');
    const rehearsal=await rehearseLegacyAccount(backup);
    await f.db.query("UPDATE pos_projects SET name='타 계정 변경' WHERE admin_id='b'");
    await assert.rejects(applyLegacyAccount(f.db,{backup,rehearsal,reportFile:f.reportFile}),error=>error.code==='OTHER_ACCOUNT_DATA_CHANGED');
    assert.equal((await f.db.query("SELECT to_regclass('pos_booths') AS name")).rows[0].name,null);
    assert.equal((await f.db.query("SELECT stock FROM pos_inventory WHERE admin_id='a'")).rows[0].stock,3);
  }finally{await f.close();}
});
test('physical storage runner rehearses all account relationships, preserves source rows, and replaces old tables without copying auth secrets',async()=>{
 const f=await fixture();try {
  const prepared=await prepareStorageReplacement(f.db,{directory:f.directory});
  assert.equal(prepared.rehearsal.passed,true);
  assert.equal((await f.db.query("SELECT to_regclass('pos_artist_inventory') AS name")).rows[0].name,null);
  const result=await applyStorageReplacement(f.db,{...prepared,directory:f.directory});
  assert.equal(result.status,'applied');assert.equal(result.reports.a.counts.inventory,1);
  assert.equal((await f.db.query("SELECT to_regclass('pos_inventory') AS name")).rows[0].name,null);
  assert.equal((await f.db.query('SELECT custodian_id,stock FROM pos_artist_inventory')).rows[0].stock,3);
 }finally{await f.close();}
});

test('storage replacement rejects stale source and a mid-rename failure restores old tables and relationships atomically',async()=>{
 const f=await fixture();try {
  const prepared=await prepareStorageReplacement(f.db,{directory:f.directory});
  const failing={query:async(text,values)=>{if(text.startsWith('ALTER TABLE')&&text.includes('RENAME TO'))throw new Error('injected rename');return f.db.query(text,values);}};
  await assert.rejects(applyStorageReplacement(failing,{...prepared,directory:f.directory}),/injected rename/);
  assert.equal((await f.db.query("SELECT to_regclass('pos_artist_inventory') AS name")).rows[0].name,null);
  assert.equal((await f.db.query("SELECT to_regclass('pos_booths') AS name")).rows[0].name,null);
  await f.db.query("UPDATE pos_inventory SET stock=stock+1 WHERE admin_id='a'");
  await assert.rejects(applyStorageReplacement(f.db,{...prepared,directory:f.directory}),e=>e.code==='SOURCE_CHANGED');
 }finally{await f.close();}
});


test('other-account fingerprints normalize only an absent nullable deletion marker and detect real deletion changes',async()=>{
 const f=await fixture();try{
  const before=await otherDataFingerprints(f.db,'a');
  await f.db.query('ALTER TABLE pos_projects ADD COLUMN deleted_at TIMESTAMPTZ');
  assert.deepEqual(await otherDataFingerprints(f.db,'a'),before);
  await f.db.query("UPDATE pos_projects SET deleted_at=NOW() WHERE admin_id='b'");
  assert.notDeepEqual(await otherDataFingerprints(f.db,'a'),before);
 }finally{await f.close();}
});
