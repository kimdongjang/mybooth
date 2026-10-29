import { eventSettlementPreview, validateEventCosts, settlementFinishedAt, recipientSettled } from '../../src/utils/eventSettlement.js';
import { decorateEventProducts } from './boothFoundation.js';
export {settlementFinishedAt,recipientSettled};
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const eventRecord=row=>({projectId:row.project_id,version:row.version,costs:row.costs,snapshot:row.snapshot,closedAt:row.closed_at,history:row.history,finishedAt:settlementFinishedAt(row)});
export async function initEventSettlements(sql) {
 await sql`CREATE TABLE IF NOT EXISTS pos_event_archives (project_id TEXT PRIMARY KEY,revision TEXT NOT NULL,archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),snapshot JSONB NOT NULL)`;
 await sql`CREATE TABLE IF NOT EXISTS pos_event_settlements (admin_id TEXT NOT NULL REFERENCES pos_admins(id),project_id TEXT PRIMARY KEY REFERENCES pos_projects(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 0,costs JSONB NOT NULL DEFAULT '[]',snapshot JSONB,closed_at TIMESTAMPTZ,history JSONB NOT NULL DEFAULT '[]')`;
}
export async function eventSettlementCommand(sql,adminId,body) {
 const {action,projectId,requestId,version}=body;
 if(typeof projectId!=='string' || typeof requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(requestId) || !Number.isSafeInteger(version) || version<0)fail('정산 요청을 확인해주세요.');
 if(!(await sql`SELECT id FROM pos_projects WHERE id=${projectId} AND admin_id=${adminId} FOR UPDATE`).rows.length)fail('행사를 찾을 수 없습니다.',404);
 const current=(await sql`SELECT * FROM pos_event_settlements WHERE admin_id=${adminId} AND project_id=${projectId} FOR UPDATE`).rows[0];
 const fingerprint=JSON.stringify(body);
 const receipt=(await sql`SELECT fingerprint FROM pos_settlement_commands WHERE admin_id=${adminId} AND id=${requestId}`).rows[0];
 if(receipt){if(receipt.fingerprint!==fingerprint)fail('같은 요청의 내용이 다릅니다.',409);return {eventSettlement:eventRecord(current)};}
 if((current?.version||0)!==version)fail('정산이 변경되었습니다. 새로고침해주세요.',409);
 const records=(await sql`SELECT * FROM pos_settlements WHERE admin_id=${adminId} AND project_id=${projectId}`).rows;
 const history=[...(current?.history||[])];
 let costs=current?.costs||[],snapshot=current?.snapshot||null,closedAt=current?.closed_at||null;
 if(action==='finishEventSettlement'||action==='resumeEventSettlement') {
  if(!closedAt)fail('정산을 먼저 시작해주세요.',409);
  const finished=settlementFinishedAt(current);
  if(action==='finishEventSettlement'){
   if(finished)fail('이미 종료된 정산입니다.',409);
   if(!snapshot.rows.every(row=>recipientSettled(row,records.find(r=>r.creator===row.creator)?.payments||[])))fail('모든 제작자의 정산을 완료해주세요.',409);
   history.push({action:'finish',at:new Date().toISOString()});
  }else{
   if(!finished)fail('종료된 정산이 아닙니다.',409);
   history.push({action:'resume',at:new Date().toISOString()});
  }
 }else if(action==='reopenEventSettlement') {
  if(settlementFinishedAt(current))fail('정산 종료를 먼저 해제해주세요.',409);
  if(!closedAt)fail('정산을 시작한 행사가 아닙니다.',409);
  if(records.some(row=>row.payments.reduce((sum,p)=>sum+p.amount,0)>0||row.payments.some(p=>p.settlementComplete&&!row.payments.some(r=>r.reversalOf===p.id))))fail('제작자별 정산 완료·지급 기록을 취소한 후 정산 시작을 취소해주세요.',409);
  history.push({action:'reopen',at:new Date().toISOString(),snapshot});closedAt=null;snapshot=null;
 }else{
  if(closedAt)fail('정산 시작 후에는 비용을 수정할 수 없습니다.',409);
  if(action==='saveEventCosts')costs=validateEventCosts(body.costs);
  else {
   const state=await eventState(sql,adminId,projectId);
   const preview=eventSettlementPreview(state,costs,records);
   const sales=state.sales;
   if(JSON.stringify(preview)!==body.expectedPreview)fail('판매 또는 비용이 변경되었습니다. 새로고침 후 정산을 시작해주세요.',409);
   if(!preview.rows.length)fail('참여 제작자와 판매 내역을 확인해주세요.');
   if(records.some(row=>row.payments.reduce((sum,p)=>sum+p.amount,0)>Math.max(0,preview.rows.find(r=>r.creator===row.creator)?.net||0)))fail('기존 지급액이 확정 정산금을 초과합니다. 지급 기록을 확인해주세요.',409);
   closedAt=new Date().toISOString();snapshot={...preview,closedAt,sales};history.push({action:'close',at:closedAt});
  }
 }
 if(['closeEventSettlement','reopenEventSettlement'].includes(action)) await sql`INSERT INTO pos_event_archives (project_id,revision,snapshot) VALUES (${projectId},${'settlement:'+requestId},'{}'::jsonb) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision`;
 const saved=(await sql`INSERT INTO pos_event_settlements (admin_id,project_id,version,costs,snapshot,closed_at,history) VALUES (${adminId},${projectId},${version+1},${JSON.stringify(costs)}::jsonb,${snapshot?JSON.stringify(snapshot):null}::jsonb,${closedAt},${JSON.stringify(history)}::jsonb) ON CONFLICT(project_id) DO UPDATE SET version=EXCLUDED.version,costs=EXCLUDED.costs,snapshot=EXCLUDED.snapshot,closed_at=EXCLUDED.closed_at,history=EXCLUDED.history RETURNING *`).rows[0];
 await sql`INSERT INTO pos_settlement_commands (admin_id,id,project_id,fingerprint) VALUES (${adminId},${requestId},${projectId},${fingerprint})`;
 return {eventSettlement:eventRecord(saved)};
}

export async function eventState(sql,adminId,projectId) {
 const products=(await sql`SELECT p.*,CASE WHEN i.id IS NOT NULL THEN i.product->>'creatorName' ELSE p.creator_name END AS creator_name FROM pos_products p LEFT JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id AND l.admin_id=${adminId} LEFT JOIN pos_inventory i ON i.admin_id=l.admin_id AND i.id=l.inventory_id WHERE p.project_id=${projectId} ORDER BY p.id`).rows.map(p=>({...p,creatorName:p.creator_name,isActive:p.is_active}));
 const bundles=(await sql`SELECT * FROM pos_bundles WHERE project_id=${projectId} ORDER BY id`).rows;
 const sales=(await sql`SELECT * FROM pos_sales WHERE project_id=${projectId} ORDER BY id`).rows;
 return {products:await decorateEventProducts(sql,adminId,projectId,products),bundles,sales};
}
