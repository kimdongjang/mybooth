import {createClient} from '@vercel/postgres';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {retireArtistProfiles} from '../api/lib/boothFoundation.js';
import {storageShape,storageDigests} from '../api/lib/storageMigration.js';

// Administrative, explicit DB migration tooling; never exposed as a public API.
// 기본은 리허설이다: 한 트랜잭션에서 이관·검증 후 ROLLBACK 한다. --apply일 때만 COMMIT 한다.
const touched=['pos_stock_owners','pos_artist_profiles','pos_artist_profiles_retired','pos_artist_invitations','pos_artist_link_audit'];
const sqlFor=db=>(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exists=async(db,table)=>Boolean((await db.query('SELECT to_regclass($1) AS name',[table])).rows[0]?.name);
const count=async(db,table)=>await exists(db,table)?Number((await db.query(`SELECT COUNT(*)::int AS n FROM "${table}"`)).rows[0].n):null;

async function untouchedDigests(db) {
 const shape=Object.fromEntries(Object.entries(await storageShape(db)).filter(([table])=>!touched.includes(table)));
 return storageDigests(db,shape);
}
// 이관 전후 모두 존재하는 제작자 기본 열만 비교한다.
async function ownerDigest(db) {
 return digest((await db.query('SELECT id,kind,display_name,origin_booth_id,legacy_key FROM pos_stock_owners ORDER BY id')).rows);
}

export async function rehearseRetirement(db,{apply=false}={}) {
 await db.query('BEGIN');
 let committed=false;
 try {
  if(!await exists(db,'pos_stock_owners'))fail('STOCK_OWNERS_REQUIRED');
  if(!await exists(db,'pos_artist_profiles')){
   const folded=(await db.query("SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pos_stock_owners' AND column_name='link_status'")).rows.length>0;
   await db.query('ROLLBACK');
   return {alreadyApplied:folded,applied:false,passed:folded};
  }
  const profiles=(await db.query('SELECT id,owner_id,linked_user_id,status FROM pos_artist_profiles ORDER BY id')).rows;
  const before={owners:await count(db,'pos_stock_owners'),profiles:profiles.length,invitations:await count(db,'pos_artist_invitations'),audit:await count(db,'pos_artist_link_audit'),
   ownerRows:await ownerDigest(db),others:await untouchedDigests(db)};
  await retireArtistProfiles(sqlFor(db));
  const checks={};
  checks.ownerCountUnchanged=await count(db,'pos_stock_owners')===before.owners;
  checks.ownerRowsUnchanged=await ownerDigest(db)===before.ownerRows;
  const owners=new Map((await db.query('SELECT id,linked_user_id,link_status FROM pos_stock_owners')).rows.map(row=>[row.id,row]));
  checks.linksCopied=profiles.every(p=>owners.get(p.owner_id)?.linked_user_id===p.linked_user_id&&owners.get(p.owner_id)?.link_status===p.status);
  checks.ownersWithoutProfileUnlinked=[...owners.values()].filter(o=>!profiles.some(p=>p.owner_id===o.id)).every(o=>o.linked_user_id===null&&o.link_status==='unlinked');
  checks.profilesRetired=!await exists(db,'pos_artist_profiles')&&await count(db,'pos_artist_profiles_retired')===profiles.length;
  const mapping=new Map(profiles.map(p=>[p.id,p.owner_id]));
  for(const table of ['pos_artist_invitations','pos_artist_link_audit']){
   if(before[table==='pos_artist_invitations'?'invitations':'audit']===null){checks[table]=true;continue;}
   const rows=(await db.query(`SELECT owner_id,legacy_profile_id FROM "${table}"`)).rows;
   checks[table]=rows.length===before[table==='pos_artist_invitations'?'invitations':'audit']&&rows.every(row=>row.owner_id&&mapping.get(row.legacy_profile_id)===row.owner_id);
  }
  checks.otherTablesUnchanged=JSON.stringify(await untouchedDigests(db))===JSON.stringify(before.others);
  const passed=Object.values(checks).every(Boolean);
  const report={applied:false,passed,checks,before:{owners:before.owners,profiles:before.profiles,linkedProfiles:profiles.filter(p=>p.status==='linked').length,invitations:before.invitations,audit:before.audit,otherTables:Object.keys(before.others).length}};
  if(apply&&passed){await db.query('COMMIT');committed=true;report.applied=true;}
  else await db.query('ROLLBACK');
  return report;
 } catch(error){if(!committed)await db.query('ROLLBACK').catch(()=>{});throw error;}
}

async function main() {
 const args=process.argv.slice(2),value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
 if(value('--env-file'))process.loadEnvFile(resolve(value('--env-file')));
 // 운영 연결 변수와 섞이지 않도록 검증 대상은 별도 변수로만 받는다.
 // createClient는 Neon pooled 주소를 거절하므로 같은 브랜치의 direct 호스트로 바꾼다.
 const connectionString=process.env.RETIRE_PROFILES_DATABASE_URL?.replace(/(@[^/@]*?)-pooler\./,'$1.');
 if(!connectionString)fail('RETIRE_PROFILES_DATABASE_URL_REQUIRED');
 const apply=args.includes('--apply');
 if(apply&&!args.includes('--confirm-target'))fail('APPLY_REQUIRES_CONFIRM_TARGET');
 const db=createClient({connectionString});let connected=false;
 const timer=setTimeout(()=>{console.error('Profile retirement timed out; the transaction was not committed unless a report says applied.');process.exit(2);},120000);
 try {
  await db.connect();connected=true;
  const report=await rehearseRetirement(db,{apply});
  if(value('--report'))await writeFile(resolve(value('--report')),JSON.stringify({format:'withbooth-profile-retirement',at:new Date().toISOString(),...report},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify(report));
  if(!report.passed)process.exitCode=1;
 } catch(error){console.error(JSON.stringify({connected,code:/^[A-Z0-9_]{1,80}$/.test(error.code||'')?error.code:'CONNECTION_OR_QUERY_FAILED'}));process.exitCode=1;}
 finally{clearTimeout(timer);if(connected)await db.end().catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify({code:/^[A-Za-z0-9_]{1,80}$/.test(error.code||'')?error.code:'PROFILE_RETIREMENT_COMMAND_FAILED'}));process.exitCode=1;});
