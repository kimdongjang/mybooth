const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status});};
export async function initStockDelegation(sql){
 const columns=(await sql`SELECT attrelid::regclass::text AS table_name,attname FROM pg_attribute WHERE attrelid IN ('pos_admins'::regclass,'pos_booth_artists'::regclass) AND attname IN ('allow_operator_stock','stock_management_confirmed') AND NOT attisdropped`).rows;
 if(!columns.some(r=>r.attname==='allow_operator_stock'))await sql`ALTER TABLE pos_admins ADD COLUMN IF NOT EXISTS allow_operator_stock BOOLEAN NOT NULL DEFAULT TRUE`;
 if(!columns.some(r=>r.attname==='stock_management_confirmed'))await sql`ALTER TABLE pos_booth_artists ADD COLUMN IF NOT EXISTS stock_management_confirmed BOOLEAN NOT NULL DEFAULT TRUE`;
}
export async function stockDelegationAllowed(sql,userId,ownerId,boothId,allowEnding=false){
 const profile=(await sql`SELECT o.linked_user_id,u.allow_operator_stock FROM pos_stock_owners o LEFT JOIN pos_admins u ON u.id=o.linked_user_id AND u.deleted_at IS NULL WHERE o.id=${ownerId}`).rows[0];
 if(!profile)return false;
 if((await sql`SELECT owner_id FROM pos_owner_members WHERE owner_id=${ownerId} AND user_id=${userId}`).rows.length)return true;
 if(!boothId)return false;
 const relation=(await sql`SELECT a.status,a.stock_management_confirmed FROM pos_booth_artists a JOIN pos_booth_members m ON m.booth_id=a.booth_id AND m.user_id=${userId} AND m.status='active' AND m.role IN ('owner','manager') WHERE a.booth_id=${boothId} AND a.owner_id=${ownerId}`).rows[0];
 return Boolean(relation&&(allowEnding?['active','proxy','ending']:['active','proxy']).includes(relation.status)&&(!profile.linked_user_id||profile.allow_operator_stock===true&&relation.stock_management_confirmed));
}
export async function assertStockDelegation(sql,userId,ownerId,boothId,allowEnding=false){if(!await stockDelegationAllowed(sql,userId,ownerId,boothId,allowEnding))fail('제작자의 재고관리 허용과 부스 참여 확인이 필요합니다.');}
export async function stockPreferenceView(sql,userId){
 const account=(await sql`SELECT allow_operator_stock FROM pos_admins WHERE id=${userId} AND deleted_at IS NULL`).rows[0];if(!account)fail('인증이 필요합니다.',401);
 const participations=(await sql`SELECT a.booth_id,a.owner_id,a.stock_management_confirmed,b.name AS booth_name,o.display_name FROM pos_booth_artists a JOIN pos_stock_owners o ON o.id=a.owner_id AND o.linked_user_id=${userId} JOIN pos_owner_members m ON m.owner_id=o.id AND m.user_id=${userId} JOIN pos_booths b ON b.id=a.booth_id WHERE a.status IN ('active','proxy') AND b.status='active' ORDER BY b.name,a.owner_id`).rows;
 return {allowOperatorStock:account.allow_operator_stock,participations};
}
export async function stockPreferenceCommand(sql,userId,action,payload){
 if(!/^[a-f0-9-]{36}$/i.test(payload.requestId||''))fail('요청 ID를 확인해주세요.',400);
 await sql`SELECT id FROM pos_admins WHERE id=${userId} AND deleted_at IS NULL FOR UPDATE`;
 const fingerprint=JSON.stringify({userId,action,payload});
 const prior=(await sql`SELECT actor_id,fingerprint,result FROM pos_shared_stock_commands WHERE id=${payload.requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
 if(action==='saveStockPreference'){
  if(typeof payload.allowOperatorStock!=='boolean')fail('허용 설정을 확인해주세요.',400);
  await sql`UPDATE pos_admins SET allow_operator_stock=${payload.allowOperatorStock} WHERE id=${userId} AND deleted_at IS NULL`;
 }else if(action==='confirmStockParticipation'){
  const owned=(await sql`SELECT o.id AS owner_id FROM pos_stock_owners o JOIN pos_owner_members m ON m.owner_id=o.id AND m.user_id=${userId} WHERE o.id=${payload.ownerId} AND o.linked_user_id=${userId}`).rows[0];
  if(!owned)fail('본인 제작자의 참여만 확인할 수 있습니다.');
  if(!(await sql`UPDATE pos_booth_artists SET stock_management_confirmed=TRUE WHERE owner_id=${payload.ownerId} AND booth_id=${payload.boothId} AND status IN ('active','proxy') RETURNING owner_id`).rows.length)fail('참여 관계를 찾을 수 없습니다.',404);
 }else fail('지원하지 않는 설정입니다.',400);
 const result=await stockPreferenceView(sql,userId);
 await sql`INSERT INTO pos_shared_stock_commands(id,actor_id,owner_id,booth_id,fingerprint,result) VALUES(${payload.requestId},${userId},${payload.ownerId||null},${payload.boothId||null},${fingerprint},${JSON.stringify({action,...result})}::jsonb)`;
 return {action,...result};
}
