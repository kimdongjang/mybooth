import crypto from 'node:crypto';
import { validateAdminPassword } from './auth.js';
import { foundationBackup, migratedBooth,protectMigratedLifecycle } from './boothFoundation.js';
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const tables = ['pos_projects','pos_inventory_numbers','pos_inventory','pos_products','pos_bundles','pos_sales','pos_sale_receipts','pos_inventory_links','pos_inventory_adjustments','pos_inventory_transfers','pos_stock_movements','pos_event_archives','pos_settlements','pos_settlement_commands','pos_event_settlements'];
const owned = new Set(['pos_projects','pos_inventory_numbers','pos_inventory','pos_inventory_links','pos_inventory_adjustments','pos_inventory_transfers','pos_stock_movements','pos_settlements','pos_settlement_commands','pos_event_settlements']);
const signature = data => crypto.createHmac('sha256',process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'dev-pos-secret').update(JSON.stringify(data)).digest('hex');
export async function accountSnapshot(sql,adminId,action,payload,checkPassword=validateAdminPassword) {
  await sql`SELECT id FROM pos_projects WHERE admin_id=${adminId} ORDER BY id FOR UPDATE`;
  const available=[];
  for(const table of tables) if((await sql`SELECT to_regclass(${table}) AS name`).rows[0].name) available.push(table);
  // SQL identifiers come only from the fixed table allowlist above.
  const query=(parts,...args)=>{const strings=[...parts];strings.raw=[...parts];return sql(strings,...args);};
  const scope=t=>owned.has(t)?'admin_id=':'project_id IN (SELECT id FROM pos_projects WHERE admin_id=';
  const tail=t=>owned.has(t)?'':')';
  if(action==='backupAccount') {
    const records={};
    for(const table of available) records[table]=(await query([`SELECT * FROM ${table} WHERE ${scope(table)}`,tail(table)],adminId)).rows;
    const foundation=await foundationBackup(sql,adminId);
    const data={format:'withbooth-account',version:foundation?2:1,owner:adminId,createdAt:new Date().toISOString(),tables:records,...(foundation?{foundation}:{})};
    if(Buffer.byteLength(JSON.stringify(data))>3*1024*1024) fail('백업 크기가 3MiB를 초과했습니다.',413);
    return {backup:{data,signature:signature(data)}};
  }
  await protectMigratedLifecycle(sql,adminId,'restoreAccount');
  if(await migratedBooth(sql,adminId)) fail('부스 이력이 포함된 자료는 계정 전체 교체로 복원할 수 없습니다.',409);
  if(!await checkPassword(adminId,payload.password,sql)) fail('현재 비밀번호를 확인해주세요.',403);
  const {data,signature:provided}=payload.backup || {};
  if(!data || data.format!=='withbooth-account' || data.version!==1 || data.owner!==adminId || typeof provided!=='string' || provided!==signature(data) || Buffer.byteLength(JSON.stringify(data))>3*1024*1024 || !data.tables || Object.keys(data.tables).some(t=>!available.includes(t))) fail('현재 계정의 유효한 백업 파일이 아닙니다.');
  for(const table of available) if(!Array.isArray(data.tables[table]) && !(['pos_settlements','pos_settlement_commands','pos_event_settlements'].includes(table) && data.tables[table]===undefined)) fail('백업 데이터가 누락되었습니다.');
  if(typeof payload.requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(payload.requestId)) fail('복원 요청 ID가 필요합니다.');
  const prior=(await sql`SELECT fingerprint FROM pos_account_restores WHERE admin_id=${adminId} AND id=${payload.requestId}`).rows[0];
  if(prior) {if(prior.fingerprint!==provided)fail('복원 요청이 변경되었습니다.',409);return {restored:true};}
  const versions=(await sql`SELECT id,version FROM pos_inventory WHERE admin_id=${adminId}`).rows;
  for(const table of [...available].reverse()) await query([`DELETE FROM ${table} WHERE ${scope(table)}`,tail(table)],adminId);
  for(const table of available) if(data.tables[table]?.length) await query([`INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table},`,'::jsonb)'],JSON.stringify(data.tables[table]));
  for(const item of data.tables.pos_inventory) {
    const version=Math.max(item.version,versions.find(row=>row.id===item.id)?.version ?? 0)+1;
    await sql`UPDATE pos_inventory SET version=${version} WHERE admin_id=${adminId} AND id=${item.id}`;
  }
  await sql`INSERT INTO pos_account_restores (admin_id,id,fingerprint) VALUES (${adminId},${payload.requestId},${provided})`;
  for (const project of data.tables.pos_projects) await sql`INSERT INTO pos_event_archives (project_id,revision,snapshot) VALUES (${project.id},${crypto.randomUUID()},'{}'::jsonb) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision`;
  return {restored:true};
}
export async function stockMovement(sql,adminId,action,payload,state) {
  await sql`SELECT id FROM pos_projects WHERE admin_id=${adminId} ORDER BY id FOR UPDATE`;
  if(action==='recordStockMovement') {
    const {requestId,inventoryId,projectId=null,productId=null,version,quantity,reason,memo=''}=payload;
    if(typeof requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(requestId) || typeof inventoryId!=='string' || !Number.isInteger(quantity) || quantity<1 || quantity>2147483647 || !['external','damage','loss'].includes(reason) || typeof memo!=='string' || memo.length>500) fail('올바른 재고 기록을 입력해주세요.');
    const request={inventoryId,projectId,productId,version,quantity,reason,memo};
    const prior=(await sql`SELECT request FROM pos_stock_movements WHERE admin_id=${adminId} AND id=${requestId}`).rows[0];
    if(prior) {
      if(JSON.stringify(Object.entries(Object.fromEntries(Object.keys(request).map(key=>[key,prior.request[key]]))).sort())!==JSON.stringify(Object.entries(request).sort())) fail('같은 요청의 내용이 변경되었습니다.',409);
    } else {
      const item=(await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} AND id=${inventoryId} FOR UPDATE`).rows[0];
      if(!item || item.product.removedAt || item.version!==version) fail('재고가 변경되었습니다. 새로고침해주세요.',409);
      if(projectId) {
        if(reason==='external') fail('외부 판매는 공통 재고에서 기록해주세요.');
        const product=(await sql`SELECT p.*,e.archived_at FROM pos_products p JOIN pos_projects e ON e.id=p.project_id JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id WHERE e.admin_id=${adminId} AND p.project_id=${projectId} AND p.id=${productId} AND l.inventory_id=${inventoryId} AND l.admin_id=${adminId} FOR UPDATE OF p`).rows[0];
        if(!product || product.archived_at || product.is_active===false || Number(product.stock_qty ?? product.stock)<quantity) fail('행사 상태 또는 남은 수량을 확인해주세요.',409);
        await sql`UPDATE pos_products SET stock=COALESCE(stock_qty,stock)-${quantity},stock_qty=COALESCE(stock_qty,stock)-${quantity},updated_at=NOW() WHERE project_id=${projectId} AND id=${productId}`;
        await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
        await sql`UPDATE pos_inventory SET version=version+1 WHERE admin_id=${adminId} AND id=${inventoryId}`;
      } else {
        if(Number(item.stock)<quantity) fail('미배정 재고가 부족합니다.',409);
        await sql`UPDATE pos_inventory SET stock=stock-${quantity},version=version+1 WHERE admin_id=${adminId} AND id=${inventoryId}`;
      }
      request.productName = item.product.name;
      await sql`INSERT INTO pos_stock_movements (admin_id,id,request) VALUES (${adminId},${requestId},${JSON.stringify(request)}::jsonb)`;
    }
  }
  return {...await state(adminId),movements:(await sql`SELECT id,request,created_at FROM pos_stock_movements WHERE admin_id=${adminId} ORDER BY created_at DESC,id`).rows};
}
