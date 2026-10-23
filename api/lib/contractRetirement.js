import {createHash} from 'node:crypto';
import {authorizeBooth,foundationReport,legacySnapshot,boothContracts} from './boothFoundation.js';

const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function initContractRetirement(sql) {
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_contract_policy (
    booth_id TEXT PRIMARY KEY REFERENCES pos_booths(id),version INTEGER NOT NULL DEFAULT 0,
    legacy_writes_closed BOOLEAN NOT NULL DEFAULT FALSE,changed_by TEXT REFERENCES pos_admins(id),changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_contract_commands (
    id TEXT PRIMARY KEY,booth_id TEXT NOT NULL REFERENCES pos_booths(id),actor_id TEXT NOT NULL REFERENCES pos_admins(id),
    fingerprint TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
}

export async function retirementReport(sql,userId,boothId) {
  const booth=await authorizeBooth(sql,userId,boothId,'owner');
  const source=await legacySnapshot(sql,booth.legacy_admin_id);
  const original=foundationReport(source);
  const events=(await sql`SELECT * FROM pos_event_booths WHERE booth_id=${boothId} ORDER BY project_id`).rows;
  const identities=(await sql`SELECT i.* FROM pos_event_product_identities i JOIN pos_event_booths e ON e.project_id=i.project_id WHERE e.booth_id=${boothId} ORDER BY i.project_id,i.product_id`).rows;
  const recipients=(await sql`SELECT er.* FROM pos_event_recipients er JOIN pos_event_booths e ON e.project_id=er.project_id WHERE e.booth_id=${boothId} ORDER BY er.project_id,er.legacy_creator`).rows;
  const owners=(await sql`SELECT * FROM pos_inventory_owners WHERE admin_id=${booth.legacy_admin_id} ORDER BY inventory_id`).rows;
  const policy=await boothContracts(sql,boothId);
  const issues=[];
  for(const e of source.projects)if(!events.some(m=>m.project_id===e.id))issues.push({code:'MISSING_EVENT_BOOTH',projectId:e.id});
  for(const p of source.products)if(!identities.some(i=>i.project_id===p.project_id&&i.product_id===p.id))issues.push({code:'MISSING_PRODUCT_IDENTITY',projectId:p.project_id,productId:p.id});
  for(const i of source.inventory)if(!owners.some(o=>o.inventory_id===i.id))issues.push({code:'MISSING_INVENTORY_OWNER',inventoryId:i.id});
  const keys=[...source.settlements,...source.closures.flatMap(c=>(c.snapshot?.rows||[]).map(r=>({project_id:c.project_id,creator:r.creator})))];
  for(const r of keys)if(!recipients.some(m=>m.project_id===r.project_id&&m.legacy_creator===r.creator))issues.push({code:'MISSING_SETTLEMENT_RECIPIENT',projectId:r.project_id});
  return {boothId,policy,ready:issues.length===0,issues,
    counts:original.counts,totals:original.totals,sourceFingerprint:original.fingerprint,
    fingerprint:hash({source:original.fingerprint,events,identities,recipients,owners,version:policy.version}),
    deviceQueues:'not-observable-on-server',
    retained:['admin_id storage adapters','historical creator aliases','original sale/closure snapshots','v1/v2 backup readers','offline payloads']};
}

export async function changeLegacyContracts(sql,userId,payload) {
  const {boothId,requestId,version,expectedFingerprint,queuesChecked,closed}=payload;
  await authorizeBooth(sql,userId,boothId,'owner');
  if(typeof requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(requestId)||!Number.isSafeInteger(version)||version<0||typeof closed!=='boolean')fail('계약 전환 요청을 확인해주세요.',400);
  const fingerprint=hash({userId,boothId,requestId,version,expectedFingerprint,queuesChecked,closed});
  const prior=(await sql`SELECT * FROM pos_booth_contract_commands WHERE id=${requestId}`).rows[0];
  if(prior){if(prior.actor_id!==userId||prior.booth_id!==boothId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.');return prior.result;}
  const report=await retirementReport(sql,userId,boothId);
  if(version!==report.policy.version||expectedFingerprint!==report.fingerprint)fail('자료 또는 계약 상태가 변경되었습니다. 진단을 다시 확인해주세요.');
  if(closed&&(!report.ready||queuesChecked!==true))fail('ID 매핑과 모든 기기의 미동기화 주문을 확인해주세요.');
  const result={boothId,version:version+1,legacyWritesClosed:closed,sourceFingerprint:report.sourceFingerprint};
  await sql`INSERT INTO pos_booth_contract_policy(booth_id,version,legacy_writes_closed,changed_by)
    VALUES(${boothId},${version+1},${closed},${userId}) ON CONFLICT(booth_id) DO UPDATE SET version=EXCLUDED.version,legacy_writes_closed=EXCLUDED.legacy_writes_closed,changed_by=EXCLUDED.changed_by,changed_at=NOW()`;
  await sql`INSERT INTO pos_booth_contract_commands(id,booth_id,actor_id,fingerprint,result) VALUES(${requestId},${boothId},${userId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
  return result;
}
