import { initEventSettlements, eventSettlementCommand, eventRecord, eventState } from './lib/eventSettlement.js';
import {canonicalSql} from './lib/storageContract.js';
import { sql as pool } from '@vercel/postgres';
import { assertPostgresConnectionString, requireAuth } from './lib/auth.js';
import { settlementMoneyEntries } from '../src/utils/settlementEntries.js';
import { migratedBooth, authorizeBooth, reconcileBoothFoundation, recipientMap, resolveRecipient,enforceBoothContract,boothContracts } from './lib/boothFoundation.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') fail('올바른 지급 날짜를 입력해주세요.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('올바른 지급 날짜를 입력해주세요.');
  return value;
};
const record = row => ({ projectId: row.project_id, creator: row.creator, version: row.version, deductions: row.deductions, payments: row.payments });

const retryableConflict=error=>['40P01','40001'].includes(error.code);
const schemaReady=state=>state.admin_deleted&&state.project_deleted&&state.ledger&&state.commands&&state.archives&&state.events;
async function settlementSchema(sql) {
  return (await sql`SELECT
    EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos_admins') AND attname='deleted_at' AND NOT attisdropped) AS admin_deleted,
    EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('pos_projects') AND attname='deleted_at' AND NOT attisdropped) AS project_deleted,
    to_regclass('pos_settlements') AS ledger,to_regclass('pos_settlement_commands') AS commands,
    to_regclass('pos_event_archives') AS archives,to_regclass('pos_event_settlements') AS events`).rows[0];
}
// Bootstrap commits before authorization can acquire account/booth row locks.
// IF NOT EXISTS still takes strong DDL locks; never run it on routine reads.
async function ensureSettlementSchema(client,sql) {
  if(schemaReady(await settlementSchema(sql)))return;
  await client.query('BEGIN');
  try {
    await sql`SELECT pg_advisory_xact_lock(736281,1)`;
    const state=await settlementSchema(sql);
    if(!state.admin_deleted)await sql`ALTER TABLE pos_admins ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
    if(!state.project_deleted)await sql`ALTER TABLE pos_projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
    if(!state.ledger)await sql`CREATE TABLE IF NOT EXISTS pos_settlements (
      admin_id TEXT NOT NULL REFERENCES pos_admins(id), project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE,
      creator TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0, deductions JSONB NOT NULL DEFAULT '[]', payments JSONB NOT NULL DEFAULT '[]',
      PRIMARY KEY(admin_id,project_id,creator))`;
    if(!state.commands)await sql`CREATE TABLE IF NOT EXISTS pos_settlement_commands (
      admin_id TEXT NOT NULL REFERENCES pos_admins(id), id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, PRIMARY KEY(admin_id,id))`;
    if(!state.archives||!state.events)await initEventSettlements(sql);
    await client.query('COMMIT');
  } catch(error) {
    await client.query('ROLLBACK').catch(()=>{});
    throw error;
  }
}

export function createHandler(pool) {
  return async (req, res) => {
    const authenticated = requireAuth(req, res);
    if (!authenticated) return;
    for(let attempt=0;attempt<3;attempt++) {
    let admin={...authenticated};
    let client;
    try {
      assertPostgresConnectionString();
      client = await pool.connect();
      const sql = await canonicalSql(client.sql.bind(client));
      await ensureSettlementSchema(client,sql);
      await client.query('BEGIN');
      const requestedBooth=req.query?.boothId || req.body?.boothId;
      const defaultBooth=await migratedBooth(sql,admin.id);
      let booth=null;
      if(requestedBooth || defaultBooth) {
        booth=await authorizeBooth(sql,admin.id,requestedBooth || defaultBooth.id,'manage');
        await enforceBoothContract(sql,booth,req,{settlement:true});
        const projectId=req.query?.projectId || req.body?.projectId;
        if(projectId && !(await sql`SELECT project_id FROM pos_event_booths WHERE project_id=${projectId} AND booth_id=${booth.id}`).rows.length) fail('부스의 행사가 아닙니다.',404);
        admin={...admin,id:booth.legacy_admin_id};
      }
      if (!(await sql`SELECT id FROM pos_admins WHERE id=${admin.id} AND deleted_at IS NULL FOR UPDATE`).rows.length) fail('인증이 필요합니다.', 401);
      if(booth) await reconcileBoothFoundation(sql,admin.id);
      const mappings=booth ? await recipientMap(sql,admin.id) : [];
      const identityRecord=row=>({...record(row),...(booth ? {recipientId:mappings.find(m=>m.project_id===row.project_id && m.legacy_creator===row.creator)?.recipient_id} : {})});
      if (req.method === 'GET') {
        const rows = await sql`SELECT s.* FROM pos_settlements s JOIN pos_projects p ON p.id=s.project_id AND p.admin_id=s.admin_id WHERE s.admin_id=${admin.id}`;
        const events=await sql`SELECT * FROM pos_event_settlements WHERE admin_id=${admin.id}`;
        let state;
        if(req.query?.projectId){if(!(await sql`SELECT id FROM pos_projects WHERE id=${req.query.projectId} AND admin_id=${admin.id} AND deleted_at IS NULL`).rows.length)fail('행사를 찾을 수 없습니다.',404);state=await eventState(sql,admin.id,req.query.projectId);}
        const contracts=booth?await boothContracts(sql,booth.id):null;
        await client.query('COMMIT');
        return res.status(200).json({ state, settlements: rows.rows.map(identityRecord), eventSettlements: events.rows.map(eventRecord), ...(booth?{boothId:booth.id,recipientMappings:mappings,contracts}:{}) });
      }
      if (req.method !== 'POST') fail('Method not allowed', 405);
      if(req.body?.projectId&&(await sql`SELECT id FROM pos_projects WHERE id=${req.body.projectId} AND deleted_at IS NOT NULL`).rows.length)fail('삭제된 행사입니다.',404);
      if (['saveEventCosts','closeEventSettlement','reopenEventSettlement'].includes(req.body?.action)) {
        const result=await eventSettlementCommand(sql,admin.id,req.body);await client.query('COMMIT');return res.status(200).json(result);
      }
      const { action, projectId, version, requestId, deductions, amount, paidAt, memo = '', paymentId } = req.body || {};
      let creator=req.body?.creator;
      if(req.body?.recipientId) {
        if(typeof req.body.recipientId!=='string' || req.body.recipientId.length>200) fail('수취인 ID를 확인해주세요.');
        if(!booth) fail('수취인 ID를 사용하려면 부스 기반 이관이 필요합니다.',409);
        const mapped=await resolveRecipient(sql,projectId,req.body.recipientId);
        if(creator && creator!==mapped.legacy_creator) fail('수취인과 기존 정산 대상이 일치하지 않습니다.',409);
        creator=mapped.legacy_creator;
      }
      if (!['saveDeductions', 'addPayment', 'reversePayment'].includes(action) || typeof projectId !== 'string' || typeof creator !== 'string' || !creator.trim() || creator !== creator.trim() || creator.length > 200 || !integer(version) || typeof requestId !== 'string' || !/^[a-f0-9-]{36}$/i.test(requestId)) fail('올바른 정산 요청이 아닙니다.');
      if (!(await sql`SELECT id FROM pos_projects WHERE id=${projectId} AND admin_id=${admin.id} FOR UPDATE`).rows.length) fail('행사를 찾을 수 없습니다.', 404);
      const fingerprint = JSON.stringify({ action, projectId, creator, version, deductions, amount, paidAt, memo, paymentId });
      const replay = (await sql`SELECT fingerprint FROM pos_settlement_commands WHERE admin_id=${admin.id} AND id=${requestId}`).rows[0];
      const current = (await sql`SELECT * FROM pos_settlements WHERE admin_id=${admin.id} AND project_id=${projectId} AND creator=${creator} FOR UPDATE`).rows[0];
      if (replay) {
        if (replay.fingerprint !== fingerprint) fail('같은 요청 ID의 내용이 다릅니다.', 409);
        await client.query('COMMIT');
        return res.status(200).json({ settlement: identityRecord(current) });
      }
      const closure=(await sql`SELECT * FROM pos_event_settlements WHERE admin_id=${admin.id} AND project_id=${projectId}`).rows[0];
      if (action==='saveDeductions' && closure?.closed_at) fail('마감된 정산은 수정할 수 없습니다.',409);
      if (action==='addPayment' && !closure?.closed_at) fail('행사 정산을 먼저 마감해주세요.',409);
      if ((current?.version || 0) !== version) fail('정산 내역이 변경되었습니다. 새로고침 후 다시 시도해주세요.', 409);
      const products = (await sql`SELECT p.*,CASE WHEN i.id IS NOT NULL THEN i.product->>'creatorName' ELSE p.creator_name END AS creator_name
        FROM pos_products p LEFT JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id AND l.admin_id=${admin.id}
        LEFT JOIN pos_inventory i ON i.admin_id=l.admin_id AND i.id=l.inventory_id WHERE p.project_id=${projectId} AND COALESCE(p.is_active,TRUE)`).rows;
      const byId = Object.fromEntries(products.map(product => [product.id, { ...product, creatorName: product.creator_name }]));
      const bundles = (await sql`SELECT * FROM pos_bundles WHERE project_id=${projectId}`).rows;
      const sales = (await sql`SELECT lines FROM pos_sales WHERE project_id=${projectId}`).rows;
      let gross = 0, found = false;
      for (const sale of sales) for (const line of sale.lines || []) for (const entry of settlementMoneyEntries(line, byId, bundles)) {
        if ((String(entry.creator || '').trim() || '미지정') === creator) { gross += entry.amount; found = true; }
      }
      if (!found && !current && !closure?.snapshot?.rows.some(row=>row.creator===creator)) fail('판매 내역에 없는 제작자입니다.', 404);
      gross = Math.round(gross);
      const frozen=closure?.closed_at ? closure.snapshot.rows.find(row=>row.creator===creator) : null;
      if(closure?.closed_at && !frozen)fail('마감 내역에 없는 제작자입니다.',404);
      if(frozen)gross=frozen.gross;
      let nextDeductions = current?.deductions || [];
      const payments = [...(current?.payments || [])];
      const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
      if (action === 'saveDeductions') {
        if (!Array.isArray(deductions) || deductions.length > 50) fail('차감 항목은 최대 50개입니다.');
        nextDeductions = deductions.map(item => {
          if (!item || typeof item.label !== 'string' || !item.label.trim() || item.label.trim().length > 80 || !integer(item.amount)) fail('차감 항목명과 0 이상의 원 단위 금액을 입력해주세요.');
          return { label: item.label.trim(), amount: item.amount };
        });
        const fees = nextDeductions.reduce((sum, item) => sum + item.amount, 0);
        if (fees > gross) fail('차감 합계는 판매액보다 클 수 없습니다.');
        const oldFees = (current?.deductions || []).reduce((sum, item) => sum + item.amount, 0);
        if (gross - fees < paid && fees > oldFees) fail('이미 지급한 금액보다 정산 예정액을 줄일 수 없습니다.');
      } else if (action === 'addPayment') {
        if (!integer(amount) || amount === 0 || typeof memo !== 'string' || memo.length > 500) fail('지급 금액과 메모를 확인해주세요.');
        const net = frozen ? frozen.net : gross - nextDeductions.reduce((sum, item) => sum + item.amount, 0);
        if (amount > net - paid) fail('지급 금액은 남은 정산금보다 클 수 없습니다.');
        payments.push({ id: requestId, amount, paidAt: date(paidAt), memo: memo.trim() });
      } else {
        const original = payments.find(payment => payment.id === paymentId && payment.amount > 0);
        if (!original || payments.some(payment => payment.reversalOf === paymentId)) fail('취소할 수 없는 지급 기록입니다.', 409);
        if (typeof memo !== 'string' || memo.length > 500) fail('메모는 500자 이내로 입력해주세요.');
        payments.push({ id: requestId, amount: -original.amount, paidAt: date(paidAt), memo: memo.trim(), reversalOf: paymentId });
      }
      const saved = await sql`INSERT INTO pos_settlements (admin_id,project_id,creator,version,deductions,payments)
        VALUES (${admin.id},${projectId},${creator},${version + 1},${JSON.stringify(nextDeductions)}::jsonb,${JSON.stringify(payments)}::jsonb)
        ON CONFLICT(admin_id,project_id,creator) DO UPDATE SET version=EXCLUDED.version,deductions=EXCLUDED.deductions,payments=EXCLUDED.payments RETURNING *`;
      await sql`INSERT INTO pos_settlement_commands (admin_id,id,project_id,fingerprint) VALUES (${admin.id},${requestId},${projectId},${fingerprint})`;
      await client.query('COMMIT');
      return res.status(200).json({ settlement: identityRecord(saved.rows[0]) });
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if(retryableConflict(error)&&attempt<2)continue;
      if(retryableConflict(error))return res.status(503).json({error:'정산 처리 중 다른 요청과 충돌했습니다. 잠시 후 다시 시도해주세요.'});
      return res.status(error.status || 500).json({ error: error.message || '정산 저장에 실패했습니다.' });
    } finally { client?.release(); }
    }
  };
}
export default createHandler(pool);
