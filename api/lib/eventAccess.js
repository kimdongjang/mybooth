import {createHash} from 'node:crypto';
import {authorizeBooth} from './boothFoundation.js';

const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status});};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export async function initEventAccess(sql) {
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_management_commands (
    id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES pos_admins(id),booth_id TEXT NOT NULL REFERENCES pos_booths(id),
    fingerprint TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_artists (
    project_id TEXT NOT NULL REFERENCES pos_projects(id),owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project_id,owner_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_staff (
    project_id TEXT NOT NULL REFERENCES pos_projects(id),user_id TEXT NOT NULL REFERENCES pos_admins(id),
    role TEXT NOT NULL CHECK(role IN ('seller','assistant')),status TEXT NOT NULL CHECK(status IN ('active','ended')),
    version INTEGER NOT NULL DEFAULT 0,changed_by TEXT NOT NULL REFERENCES pos_admins(id),PRIMARY KEY(project_id,user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_access_commands (
    id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES pos_admins(id),project_id TEXT NOT NULL REFERENCES pos_projects(id),
    fingerprint TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  // Existing products/settlements establish historical event participation.
  // Never reactivate a participant who was explicitly ended.
  await sql`INSERT INTO pos_event_artists(project_id,owner_id)
    SELECT project_id,owner_id FROM pos_event_product_identities WHERE owner_id IS NOT NULL
    UNION SELECT e.project_id,r.owner_id FROM pos_event_recipients e JOIN pos_recipients r ON r.id=e.recipient_id WHERE r.owner_id IS NOT NULL
    ON CONFLICT DO NOTHING`;
}

export async function boothManagementView(sql,userId,{boothId}) {
 const booth=await authorizeBooth(sql,userId,boothId,'manage');
 const members=(await sql`SELECT m.user_id,m.role,m.status,u.nickname FROM pos_booth_members m JOIN pos_admins u ON u.id=m.user_id WHERE m.booth_id=${boothId} ORDER BY m.user_id`).rows;
 const profiles=(await sql`SELECT p.id,p.owner_id,p.linked_user_id,o.display_name FROM pos_booth_artists a JOIN pos_artist_profiles p ON p.owner_id=a.owner_id JOIN pos_stock_owners o ON o.id=p.owner_id WHERE a.booth_id=${boothId} AND a.status IN ('active','proxy') ORDER BY p.id`).rows;
 return {boothId,name:booth.name,role:booth.role,members,profiles};
}

export async function saveBoothManagement(sql,userId,payload) {
 const {boothId,name,expectedName,targetUserId,role,status,expectedRole,expectedStatus,requestId}=payload;
 await authorizeBooth(sql,userId,boothId,targetUserId?'owner':'manage');
 if(!/^[a-f0-9-]{36}$/i.test(requestId||''))fail('요청 ID를 확인해주세요.',400);
 const fingerprint=hash({userId,payload});
 const prior=(await sql`SELECT * FROM pos_booth_management_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.booth_id!==boothId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
 if(targetUserId) {
  if(!['manager','seller','viewer'].includes(role)||!['active','ended'].includes(status))fail('부스 역할을 확인해주세요.',400);
  const previous=(await sql`SELECT role,status FROM pos_booth_members WHERE booth_id=${boothId} AND user_id=${targetUserId}`).rows[0];
  if(previous?.role==='owner')fail('부스 소유자 권한은 변경할 수 없습니다.');
  if((previous?.role||null)!==(expectedRole||null)||(previous?.status||null)!==(expectedStatus||null))fail('부스 권한이 변경되었습니다.',409);
  if(status==='active'&&!(await sql`SELECT p.id FROM pos_artist_profiles p JOIN pos_booth_artists a ON a.owner_id=p.owner_id AND a.booth_id=${boothId} AND a.status IN ('active','proxy') JOIN pos_admins u ON u.id=p.linked_user_id AND u.deleted_at IS NULL WHERE p.linked_user_id=${targetUserId}`).rows.length)fail('계정이 연결된 부스 작가를 선택해주세요.');
  await sql`INSERT INTO pos_booth_members(booth_id,user_id,role,status) VALUES(${boothId},${targetUserId},${role},${status}) ON CONFLICT(booth_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status`;
 } else {
  if(typeof name!=='string'||!name.trim()||name.trim().length>80)fail('부스명을 확인해주세요.',400);
  if(!(await sql`UPDATE pos_booths SET name=${name.trim()} WHERE id=${boothId} AND name=${expectedName} RETURNING id`).rows.length)fail('부스 정보가 변경되었습니다.',409);
 }
 const result=await boothManagementView(sql,userId,{boothId});
 await sql`INSERT INTO pos_booth_management_commands(id,actor_id,booth_id,fingerprint,result) VALUES(${requestId},${userId},${boothId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}

export async function eventPermissions(sql,userId,projectId) {
  const event=(await sql`SELECT p.*,b.id AS booth_id,b.name AS booth_name,b.legacy_admin_id,b.status AS booth_status,
    m.role AS booth_role,m.status AS member_status FROM pos_projects p
    JOIN pos_event_booths eb ON eb.project_id=p.id JOIN pos_booths b ON b.id=eb.booth_id
    LEFT JOIN pos_booth_members m ON m.booth_id=b.id AND m.user_id=${userId} WHERE p.id=${projectId}`).rows[0];
  if(!event)return null;
  const active=(await sql`SELECT id FROM pos_admins WHERE id=${userId} AND deleted_at IS NULL`).rows.length;
  const tables=(await sql`SELECT to_regclass('pos_event_staff') AS staff,to_regclass('pos_event_artists') AS artists`).rows[0];
  const staff=tables.staff?(await sql`SELECT s.* FROM pos_event_staff s WHERE s.project_id=${projectId} AND s.user_id=${userId} AND s.status='active'
    AND EXISTS(SELECT 1 FROM pos_artist_profiles p JOIN pos_event_artists e ON e.owner_id=p.owner_id AND e.project_id=s.project_id AND e.status='active'
      JOIN pos_booth_artists a ON a.owner_id=p.owner_id AND a.booth_id=${event.booth_id} AND a.status IN ('active','proxy') WHERE p.linked_user_id=s.user_id)`).rows[0]:null;
  const owners=tables.artists?(await sql`SELECT a.owner_id FROM pos_event_artists a JOIN pos_owner_members m ON m.owner_id=a.owner_id AND m.user_id=${userId}
    JOIN pos_booth_artists b ON b.owner_id=a.owner_id AND b.booth_id=${event.booth_id} AND b.status IN ('active','proxy')
    WHERE a.project_id=${projectId} AND a.status='active'`).rows.map(row=>row.owner_id):[];
  const operator=Boolean(active&&event.member_status==='active'&&['owner','manager'].includes(event.booth_role));
  const historical=(await sql`SELECT r.owner_id FROM pos_event_recipients e JOIN pos_recipients r ON r.id=e.recipient_id
    JOIN pos_owner_members m ON m.owner_id=r.owner_id AND m.user_id=${userId}
    JOIN pos_artist_profiles p ON p.owner_id=r.owner_id AND p.linked_user_id=${userId} AND p.status='linked'
    WHERE e.project_id=${projectId} LIMIT 1`).rows.length>0;
  const seller=Boolean(active&&event.member_status==='active'&&event.booth_role==='seller');
  const canSell=Boolean(active&&(operator||seller||staff));
  const canConfigure=Boolean(active&&(operator||staff?.role==='assistant'));
  return {...event,permissions:{operator,canSell,canConfigure,canManage:operator,canSettle:operator,canReadOwnHistory:Boolean(active&&historical),canRead:operator||canSell||canConfigure||Boolean(active&&(owners.length||historical)),ownerIds:active?owners:[],role:operator?'operator':staff?.role||(seller?'seller':owners.length||historical?'artist':'none')}};
}

export async function authorizeEvent(sql,userId,projectId,capability='read',boothId) {
  let event=await eventPermissions(sql,userId,projectId);
  if(!event||boothId&&boothId!==event.booth_id)fail('행사를 찾을 수 없습니다.',404);
  await sql`SELECT id FROM pos_admins WHERE id IN (${userId},${event.legacy_admin_id}) ORDER BY id FOR UPDATE`;
  await sql`SELECT id FROM pos_booths WHERE id=${event.booth_id} FOR UPDATE`;
  await sql`SELECT id FROM pos_projects WHERE id=${projectId} FOR UPDATE`;
  event=await eventPermissions(sql,userId,projectId);
  const rights={read:event.permissions.canRead,pos:event.permissions.canSell||event.permissions.canConfigure,sell:event.permissions.canSell,configure:event.permissions.canConfigure,manage:event.permissions.canManage,settle:event.permissions.canSettle};
  if(!rights[capability])fail('이 행사의 작업 권한이 없습니다.');
  if(capability!=='read'&&event.booth_status!=='active')fail('종료된 부스입니다.',409);
  return {...event,id:event.booth_id,role:event.booth_role||event.permissions.role};
}

export async function eventAccessView(sql,userId,{projectId,boothId}) {
  const event=await authorizeEvent(sql,userId,projectId,'manage',boothId);
  const profiles=(await sql`SELECT p.id,p.owner_id,p.linked_user_id,o.display_name,a.status AS booth_status,
    e.status,e.version FROM pos_booth_artists a JOIN pos_stock_owners o ON o.id=a.owner_id
    JOIN pos_artist_profiles p ON p.owner_id=o.id LEFT JOIN pos_event_artists e ON e.owner_id=o.id AND e.project_id=${projectId}
    WHERE a.booth_id=${event.booth_id} ORDER BY p.id`).rows;
  const staff=(await sql`SELECT user_id,role,status,version FROM pos_event_staff WHERE project_id=${projectId} ORDER BY user_id`).rows;
  return {projectId,boothId:event.booth_id,profiles,staff};
}

export async function saveEventAccess(sql,userId,payload) {
  const {projectId,boothId,ownerId,targetUserId,role,status,version,requestId}=payload;
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!Number.isSafeInteger(version)||version<0||!['active','ended'].includes(status)||Boolean(ownerId)===Boolean(targetUserId))fail('참여/권한 요청을 확인해주세요.',400);
  await authorizeEvent(sql,userId,projectId,'manage',boothId);
  const fingerprint=hash({userId,payload});
  const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
  if(prior){if(prior.actor_id!==userId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
  if(ownerId) {
    if(!(await sql`SELECT owner_id FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${ownerId} AND status IN ('active','proxy')`).rows.length)fail('부스 참여 작가가 아닙니다.');
    const previous=(await sql`SELECT * FROM pos_event_artists WHERE project_id=${projectId} AND owner_id=${ownerId}`).rows[0];
    if((previous?.version||0)!==version)fail('참여 내역이 변경되었습니다.',409);
    if(status==='ended'&&(await sql`SELECT p.id FROM pos_products p JOIN pos_event_product_identities i ON i.project_id=p.project_id AND i.product_id=p.id
      WHERE p.project_id=${projectId} AND i.owner_id=${ownerId} AND COALESCE(p.stock_qty,p.stock)>0 LIMIT 1`).rows.length)fail('행사 잔여 재고를 먼저 회수해주세요.',409);
    await sql`INSERT INTO pos_event_artists(project_id,owner_id,status,version) VALUES(${projectId},${ownerId},${status},${version+1})
      ON CONFLICT(project_id,owner_id) DO UPDATE SET status=EXCLUDED.status,version=EXCLUDED.version`;
    if(status==='ended')await sql`UPDATE pos_event_staff SET status='ended',version=version+1 WHERE project_id=${projectId} AND user_id IN
      (SELECT linked_user_id FROM pos_artist_profiles WHERE owner_id=${ownerId})`;
  } else {
    if(!['seller','assistant'].includes(role))fail('판매/부관리자 역할을 확인해주세요.',400);
    if(status==='active'&&!(await sql`SELECT p.id FROM pos_artist_profiles p JOIN pos_event_artists e ON e.owner_id=p.owner_id
      JOIN pos_admins u ON u.id=p.linked_user_id AND u.deleted_at IS NULL WHERE e.project_id=${projectId} AND e.status='active' AND p.linked_user_id=${targetUserId}`).rows.length)fail('계정이 연결된 행사 참여 작가를 선택해주세요.');
    const previous=(await sql`SELECT * FROM pos_event_staff WHERE project_id=${projectId} AND user_id=${targetUserId}`).rows[0];
    if((previous?.version||0)!==version)fail('권한이 변경되었습니다.',409);
    await sql`INSERT INTO pos_event_staff(project_id,user_id,role,status,version,changed_by) VALUES(${projectId},${targetUserId},${role},${status},${version+1},${userId})
      ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,version=EXCLUDED.version,changed_by=EXCLUDED.changed_by`;
  }
  const result=await eventAccessView(sql,userId,{projectId,boothId});
  await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
  return result;
}

export async function workspaceEvents(sql,userId) {
  const ids=(await sql`SELECT project_id FROM pos_event_booths ORDER BY project_id`).rows;
  const events=[];
  for(const {project_id} of ids) {
    const event=await eventPermissions(sql,userId,project_id);
    if(event.permissions.canRead)events.push({id:event.id,name:event.name,boothId:event.booth_id,boothName:event.booth_name,createdAt:event.created_at,archivedAt:event.archived_at,permissions:event.permissions});
  }
  return events;
}
