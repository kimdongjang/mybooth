import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {createBoothArtist,createArtistProfile} from './artistLinking.js';
import {authorizeBooth,ownerIdOf} from './boothFoundation.js';

const fail=(message,status=403)=>{throw Object.assign(new Error(message),{status});};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export async function initEventAccess(sql) {
  await sql`CREATE TABLE IF NOT EXISTS pos_event_details(project_id TEXT PRIMARY KEY REFERENCES pos_projects(id) ON DELETE CASCADE,venue TEXT NOT NULL DEFAULT '')`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_management_commands (
    id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES pos_admins(id),booth_id TEXT NOT NULL REFERENCES pos_booths(id),
    fingerprint TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_artists (
    project_id TEXT NOT NULL REFERENCES pos_projects(id),owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')),version INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(project_id,owner_id))`;
  await sql`ALTER TABLE pos_event_artists ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ`;
  await sql`ALTER TABLE pos_event_artists ADD COLUMN IF NOT EXISTS requested_role TEXT CHECK(requested_role IN ('seller','assistant'))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_staff (
    project_id TEXT NOT NULL REFERENCES pos_projects(id),user_id TEXT NOT NULL REFERENCES pos_admins(id),
    role TEXT NOT NULL CHECK(role IN ('seller','assistant')),status TEXT NOT NULL CHECK(status IN ('active','ended')),
    version INTEGER NOT NULL DEFAULT 0,changed_by TEXT NOT NULL REFERENCES pos_admins(id),PRIMARY KEY(project_id,user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_access_commands (
    id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES pos_admins(id),project_id TEXT NOT NULL REFERENCES pos_projects(id),
    fingerprint TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_invites (
    id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,project_id TEXT NOT NULL REFERENCES pos_projects(id) ON DELETE CASCADE,
    booth_id TEXT NOT NULL REFERENCES pos_booths(id),issued_by TEXT NOT NULL REFERENCES pos_admins(id),
    expires_at TIMESTAMPTZ NOT NULL,revoked_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
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
 const profiles=(await sql`SELECT o.id,o.id AS owner_id,o.linked_user_id,o.display_name FROM pos_booth_artists a JOIN pos_stock_owners o ON o.id=a.owner_id WHERE a.booth_id=${boothId} AND a.status IN ('active','proxy') ORDER BY o.id`).rows;
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
  if(status==='active'&&!(await sql`SELECT o.id FROM pos_stock_owners o JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=${boothId} AND a.status IN ('active','proxy') JOIN pos_admins u ON u.id=o.linked_user_id AND u.deleted_at IS NULL WHERE o.linked_user_id=${targetUserId}`).rows.length)fail('계정이 연결된 부스 제작자를 선택해주세요.');
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
    LEFT JOIN pos_booth_members m ON m.booth_id=b.id AND m.user_id=${userId} WHERE p.id=${projectId} AND p.deleted_at IS NULL`).rows[0];
  if(!event)return null;
  const active=(await sql`SELECT id FROM pos_admins WHERE id=${userId} AND deleted_at IS NULL`).rows.length;
  const tables=(await sql`SELECT to_regclass('pos_event_staff') AS staff,to_regclass('pos_event_artists') AS artists`).rows[0];
  const staff=tables.staff?(await sql`SELECT s.* FROM pos_event_staff s WHERE s.project_id=${projectId} AND s.user_id=${userId} AND s.status='active'
    AND EXISTS(SELECT 1 FROM pos_stock_owners o JOIN pos_event_artists e ON e.owner_id=o.id AND e.project_id=s.project_id AND e.status='active'
      JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=${event.booth_id} AND a.status IN ('active','proxy') WHERE o.linked_user_id=s.user_id)`).rows[0]:null;
  const owners=tables.artists?(await sql`SELECT a.owner_id FROM pos_event_artists a JOIN pos_owner_members m ON m.owner_id=a.owner_id AND m.user_id=${userId}
    JOIN pos_booth_artists b ON b.owner_id=a.owner_id AND b.booth_id=${event.booth_id} AND b.status IN ('active','proxy')
    WHERE a.project_id=${projectId} AND a.status='active'`).rows.map(row=>row.owner_id):[];
  const operator=Boolean(active&&event.member_status==='active'&&['owner','manager'].includes(event.booth_role));
  const historical=(await sql`SELECT r.owner_id FROM pos_event_recipients e JOIN pos_recipients r ON r.id=e.recipient_id
    JOIN pos_owner_members m ON m.owner_id=r.owner_id AND m.user_id=${userId}
    JOIN pos_stock_owners o ON o.id=r.owner_id AND o.linked_user_id=${userId} AND o.link_status='linked'
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
  const profiles=(await sql`SELECT o.id,o.id AS owner_id,o.linked_user_id,o.display_name,a.status AS booth_status,
    e.status,e.version,e.requested_role,e.joined_at,u.nickname,u.avatar,COALESCE(o.origin_booth_id=${event.booth_id} AND o.link_status='linked' AND o.linked_user_id IS NOT NULL,FALSE) AS can_unlink,(SELECT m.role FROM pos_booth_members m WHERE m.booth_id=${event.booth_id} AND m.user_id=o.linked_user_id AND m.status='active') AS booth_role,(SELECT COUNT(*)::int FROM pos_event_product_identities i JOIN pos_products prod ON prod.project_id=i.project_id AND prod.id=i.product_id
      WHERE i.project_id=${projectId} AND i.owner_id=o.id AND prod.is_active IS DISTINCT FROM FALSE) AS product_count FROM pos_booth_artists a JOIN pos_stock_owners o ON o.id=a.owner_id
    LEFT JOIN pos_admins u ON u.id=o.linked_user_id LEFT JOIN pos_event_artists e ON e.owner_id=o.id AND e.project_id=${projectId}
    WHERE a.booth_id=${event.booth_id} ORDER BY o.id`).rows;
  const staff=(await sql`SELECT user_id,role,status,version FROM pos_event_staff WHERE project_id=${projectId} ORDER BY user_id`).rows;
  const schedule=(await sql`SELECT starts_on::text,ends_on::text FROM pos_event_stock_policy WHERE project_id=${projectId}`).rows[0]||null;
  return {projectId,boothId:event.booth_id,profiles,staff,schedule};
}

export async function saveEventAccess(sql,userId,payload) {
  const {projectId,boothId,ownerId,targetUserId,role,status,version,requestId}=payload;
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!Number.isSafeInteger(version)||version<0||!['active','ended'].includes(status)||Boolean(ownerId)===Boolean(targetUserId))fail('참여/권한 요청을 확인해주세요.',400);
  await authorizeEvent(sql,userId,projectId,'manage',boothId);
  const fingerprint=hash({userId,payload});
  const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
  if(prior){if(prior.actor_id!==userId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
  if(ownerId) {
    if(!(await sql`SELECT owner_id FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${ownerId} AND status IN ('active','proxy')`).rows.length)fail('부스 참여 제작자가 아닙니다.');
    const previous=(await sql`SELECT * FROM pos_event_artists WHERE project_id=${projectId} AND owner_id=${ownerId}`).rows[0];
    if((previous?.version||0)!==version)fail('참여 내역이 변경되었습니다.',409);
    if(role!==undefined){
      if(!['seller','assistant'].includes(role)||status!=='active'||previous?.status!=='active')fail('행사 권한을 확인해주세요.',400);
      const profile=(await sql`SELECT linked_user_id FROM pos_stock_owners WHERE id=${ownerId} FOR UPDATE`).rows[0];
      if(!profile||profile.linked_user_id)fail('계정 연결 상태가 변경되었습니다. 다시 확인해주세요.',409);
    }
    if(status==='ended'&&(await sql`SELECT p.id FROM pos_products p JOIN pos_event_product_identities i ON i.project_id=p.project_id AND i.product_id=p.id
      WHERE p.project_id=${projectId} AND i.owner_id=${ownerId} AND COALESCE(p.stock_qty,p.stock)>0 LIMIT 1`).rows.length)fail('행사 잔여 재고를 먼저 회수해주세요.',409);
    await sql`INSERT INTO pos_event_artists(project_id,owner_id,status,version,requested_role) VALUES(${projectId},${ownerId},${status},${version+1},${role??previous?.requested_role??null})
      ON CONFLICT(project_id,owner_id) DO UPDATE SET status=EXCLUDED.status,version=EXCLUDED.version,requested_role=EXCLUDED.requested_role`;
    if(status==='ended')await sql`UPDATE pos_event_staff SET status='ended',version=version+1 WHERE project_id=${projectId} AND user_id IN
      (SELECT linked_user_id FROM pos_stock_owners WHERE id=${ownerId} AND linked_user_id IS NOT NULL)`;
  } else {
    if(!['seller','assistant'].includes(role))fail('판매/부관리자 역할을 확인해주세요.',400);
    if(status==='active'&&!(await sql`SELECT o.id FROM pos_stock_owners o JOIN pos_event_artists e ON e.owner_id=o.id
      JOIN pos_admins u ON u.id=o.linked_user_id AND u.deleted_at IS NULL WHERE e.project_id=${projectId} AND e.status='active' AND o.linked_user_id=${targetUserId}`).rows.length)fail('계정이 연결된 행사 참여 제작자를 선택해주세요.');
    const previous=(await sql`SELECT * FROM pos_event_staff WHERE project_id=${projectId} AND user_id=${targetUserId}`).rows[0];
    if((previous?.version||0)!==version)fail('권한이 변경되었습니다.',409);
    await sql`INSERT INTO pos_event_staff(project_id,user_id,role,status,version,changed_by) VALUES(${projectId},${targetUserId},${role},${status},${version+1},${userId})
      ON CONFLICT(project_id,user_id) DO UPDATE SET role=EXCLUDED.role,status=EXCLUDED.status,version=EXCLUDED.version,changed_by=EXCLUDED.changed_by`;
  }
  const result=await eventAccessView(sql,userId,{projectId,boothId});
  await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
  return result;
}

async function workspaceOperatorSummaries(sql,events) {
 const ids=events.filter(event=>event.permissions.canManage).map(event=>event.id);
 if(!ids.length)return new Map();
 const rows=(await sql`WITH catalog AS (
   SELECT project_id,COUNT(*) FILTER(WHERE COALESCE(is_active,TRUE))::int AS products,
     COUNT(*) FILTER(WHERE COALESCE(is_active,TRUE) AND COALESCE(stock_qty,stock) BETWEEN 1 AND 3)::int AS low_stock,
     COALESCE(SUM(COALESCE(stock_qty,stock)) FILTER(WHERE COALESCE(is_active,TRUE)),0) AS remaining,
     COALESCE(SUM(GREATEST(COALESCE(initial_stock_qty,stock_qty,stock),COALESCE(stock_qty,stock))) FILTER(WHERE COALESCE(is_active,TRUE)),0) AS allocated
   FROM pos_products WHERE project_id=ANY(${ids}::text[]) GROUP BY project_id
  ), sales AS (
   SELECT project_id,COUNT(*)::int AS transactions,COALESCE(SUM(total),0) AS gross,MAX(time) AS latest
   FROM pos_sales WHERE project_id=ANY(${ids}::text[]) GROUP BY project_id
  ), artists AS (
   SELECT project_id,COUNT(*)::int AS artists FROM pos_event_artists WHERE project_id=ANY(${ids}::text[]) AND status='active' GROUP BY project_id
  ) SELECT p.id,COALESCE(c.products,0) AS products,COALESCE(c.low_stock,0) AS low_stock,COALESCE(c.remaining,0) AS remaining,COALESCE(c.allocated,0) AS allocated,
    COALESCE(s.transactions,0) AS transactions,COALESCE(s.gross,0) AS gross,s.latest,COALESCE(a.artists,0) AS artists
   FROM pos_projects p LEFT JOIN catalog c ON c.project_id=p.id LEFT JOIN sales s ON s.project_id=p.id LEFT JOIN artists a ON a.project_id=p.id
   WHERE p.id=ANY(${ids}::text[])`).rows;
 const summaries=new Map(rows.map(row=>[row.id,{products:Number(row.products),remainingStock:Number(row.remaining),initialStock:Number(row.allocated),
  sales:Number(row.transactions),total:Number(row.gross),lastSaleAt:row.latest||null,artistCount:Number(row.artists),lowStockProducts:Number(row.low_stock)}]));
 const tables=(await sql`SELECT to_regclass('pos_event_settlements') AS closures,to_regclass('pos_settlements') AS ledger`).rows[0];
 const closures=tables.closures?(await sql`SELECT c.project_id,c.closed_at,c.snapshot FROM pos_event_settlements c JOIN pos_projects p ON p.id=c.project_id AND p.admin_id=c.admin_id WHERE c.project_id=ANY(${ids}::text[])`).rows:[];
 const ledgers=tables.ledger?(await sql`SELECT l.project_id,l.creator,l.payments FROM pos_settlements l JOIN pos_projects p ON p.id=l.project_id AND p.admin_id=l.admin_id WHERE l.project_id=ANY(${ids}::text[])`).rows:[];
 for(const event of closures){
  const summary=summaries.get(event.project_id);if(!summary)continue;
  summary.closedAt=event.closed_at||null;
  if(event.closed_at&&event.snapshot){
   const records=ledgers.filter(row=>row.project_id===event.project_id);
   const paidFor=creator=>(records.find(row=>row.creator===creator)?.payments||[]).reduce((total,payment)=>total+Number(payment.amount||0),0);
   summary.settlementNet=(event.snapshot.rows||[]).reduce((total,row)=>total+Number(row.net||0),0);
   summary.paid=records.reduce((total,row)=>total+paidFor(row.creator),0);
   summary.pending=(event.snapshot.rows||[]).reduce((total,row)=>total+Math.max(0,Number(row.net||0)-paidFor(row.creator)),0);
  }
 }
 return summaries;
}

export async function workspaceEvents(sql,userId) {
  const ids=(await sql`SELECT eb.project_id,d.venue,sp.starts_on::text,sp.ends_on::text FROM pos_event_booths eb JOIN pos_projects p ON p.id=eb.project_id LEFT JOIN pos_event_details d ON d.project_id=p.id LEFT JOIN pos_event_stock_policy sp ON sp.project_id=p.id WHERE p.deleted_at IS NULL ORDER BY eb.project_id`).rows;
  const events=[];
  for(const {project_id,venue,starts_on,ends_on} of ids) {
    const event=await eventPermissions(sql,userId,project_id);
    if(event.permissions.canRead)events.push({id:event.id,name:event.name,venue,startsOn:starts_on,endsOn:ends_on,boothId:event.booth_id,boothName:event.booth_name,createdAt:event.created_at,archivedAt:event.archived_at,permissions:event.permissions});
  }
  const summaries=await workspaceOperatorSummaries(sql,events);
  return events.map(event=>({...event,...(event.permissions.canManage?{summary:summaries.get(event.id)}:{})}));
}


export async function searchEventAccounts(sql,userId,{projectId,boothId,q}) {
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 if(typeof q!=='string'||q.trim().length<2||q.length>100)fail('검색어를 2~100자로 입력해주세요.',400);
 const term=q.trim();
 const accounts=(await sql`SELECT id,nickname FROM pos_admins WHERE deleted_at IS NULL AND
   (strpos(lower(COALESCE(nickname,'')),lower(${term}))>0 OR lower(id)=lower(${term}) OR lower(email)=lower(${term})) ORDER BY nickname,id LIMIT 20`).rows;
 return {accounts};
}

export async function linkEventArtistAccount(sql,userId,payload) {
 const {projectId,boothId,profileId,targetUserId,requestId}=payload;
 if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||typeof targetUserId!=='string')fail('연결할 계정을 확인해주세요.',400);
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 const fingerprint=hash({userId,action:'linkEventArtistAccount',payload});
 const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.project_id!==projectId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
 if(!(await sql`SELECT id FROM pos_admins WHERE id=${targetUserId} AND deleted_at IS NULL FOR UPDATE`).rows.length)fail('계정을 찾을 수 없습니다.',404);
 const ownerId=await ownerIdOf(sql,profileId);
 const profile=(await sql`SELECT o.*,e.requested_role FROM pos_stock_owners o
  JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=${boothId} AND a.status='proxy'
  JOIN pos_event_artists e ON e.owner_id=o.id AND e.project_id=${projectId} AND e.status='active'
  WHERE o.id=${ownerId} FOR UPDATE OF o,a,e`).rows[0];
 if(!profile||profile.link_status!=='unlinked'||profile.linked_user_id||profile.origin_booth_id!==boothId)fail('연결할 미연결 참여 제작자를 확인해주세요.',409);
 await sql`UPDATE pos_stock_owners SET link_status='linked',linked_user_id=${targetUserId},kind='artist' WHERE id=${ownerId}`;
 await sql`INSERT INTO pos_owner_members(owner_id,user_id) VALUES(${ownerId},${targetUserId}) ON CONFLICT DO NOTHING`;
 await sql`UPDATE pos_booth_artists SET status='active',stock_management_confirmed=TRUE WHERE booth_id=${boothId} AND owner_id=${ownerId}`;
 await sql`UPDATE pos_artist_invitations SET revoked_at=NOW() WHERE owner_id=${ownerId} AND accepted_at IS NULL AND revoked_at IS NULL`;
 await sql`INSERT INTO pos_artist_link_audit(id,owner_id,booth_id,actor_id,action) VALUES(${randomUUID()},${ownerId},${boothId},${userId},'profile_linked_by_operator')`;
 const linkedRole=payload.role??profile.requested_role;
 if(linkedRole!=null){
  if(!['seller','assistant'].includes(linkedRole))fail('행사 권한을 확인해주세요.',400);
  const staff=(await sql`SELECT version FROM pos_event_staff WHERE project_id=${projectId} AND user_id=${targetUserId}`).rows[0];
  await saveEventAccess(sql,userId,{projectId,boothId,targetUserId,role:linkedRole,status:'active',version:staff?.version||0,requestId:randomUUID()});
 }
 const result={linked:true,profileId,targetUserId};
 await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}

export async function unlinkEventArtistAccount(sql,userId,payload) {
 const {projectId,boothId,ownerId,targetUserId,version,requestId}=payload;
 if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||typeof ownerId!=='string'||typeof targetUserId!=='string'||!Number.isSafeInteger(version)||version<0)fail('연결 해제 요청을 확인해주세요.',400);
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 const fingerprint=hash({userId,action:'unlinkEventArtistAccount',payload});
 const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.project_id!==projectId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
 await sql`SELECT id FROM pos_admins WHERE id=${targetUserId} FOR UPDATE`;
 const profile=(await sql`SELECT o.*,e.version,e.status AS event_status FROM pos_stock_owners o
  JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=${boothId} AND a.status IN ('active','proxy')
  JOIN pos_event_artists e ON e.owner_id=o.id AND e.project_id=${projectId}
  WHERE o.id=${ownerId} FOR UPDATE OF o,a,e`).rows[0];
 if(!profile||profile.event_status!=='active')fail('행사 참여 제작자를 찾을 수 없습니다.',404);
 if(profile.origin_booth_id!==boothId)fail('이 부스에서 등록한 제작자의 계정 연결만 해제할 수 있습니다.');
 if(profile.link_status!=='linked'||profile.linked_user_id!==targetUserId||profile.version!==version)fail('계정 연결 상태가 변경되었습니다. 다시 확인해주세요.',409);
 // The identity is shared across events. Keep every product, allocation and settlement identity.
 await sql`SELECT project_id FROM pos_event_artists WHERE owner_id=${ownerId} ORDER BY project_id FOR UPDATE`;
 await sql`UPDATE pos_event_artists e SET version=e.version+1,requested_role=COALESCE(e.requested_role,
  (SELECT s.role FROM pos_event_staff s WHERE s.project_id=e.project_id AND s.user_id=${targetUserId} AND s.status='active')) WHERE e.owner_id=${ownerId}`;
 await sql`UPDATE pos_stock_owners SET linked_user_id=NULL,link_status='unlinked',kind='unverified' WHERE id=${ownerId}`;
 await sql`DELETE FROM pos_owner_members WHERE owner_id=${ownerId} AND user_id=${targetUserId}`;
 await sql`UPDATE pos_booth_artists SET status='proxy',stock_management_confirmed=FALSE WHERE owner_id=${ownerId} AND status='active'`;
 // Other linked creators and independent booth membership still confer their own rights.
 await sql`UPDATE pos_event_staff s SET status='ended',version=s.version+1,changed_by=${userId}
  WHERE s.user_id=${targetUserId} AND s.status='active'
  AND EXISTS(SELECT 1 FROM pos_event_artists e WHERE e.project_id=s.project_id AND e.owner_id=${ownerId})
  AND NOT EXISTS(SELECT 1 FROM pos_event_artists e JOIN pos_stock_owners o ON o.id=e.owner_id
   JOIN pos_event_booths eb ON eb.project_id=e.project_id JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=eb.booth_id AND a.status IN ('active','proxy')
   WHERE e.project_id=s.project_id AND e.status='active' AND o.linked_user_id=${targetUserId} AND o.link_status='linked')`;
 await sql`UPDATE pos_artist_invitations SET revoked_at=NOW() WHERE owner_id=${ownerId} AND accepted_at IS NULL AND revoked_at IS NULL`;
 await sql`INSERT INTO pos_artist_link_audit(id,owner_id,booth_id,actor_id,action) VALUES(${randomUUID()},${ownerId},${boothId},${userId},'profile_unlinked_by_operator')`;
 // Return only IDs from the managing booth; do not expose other booths' event metadata.
 const projectIds=(await sql`SELECT e.project_id FROM pos_event_artists e JOIN pos_event_booths eb ON eb.project_id=e.project_id WHERE e.owner_id=${ownerId} AND eb.booth_id=${boothId} ORDER BY e.project_id`).rows.map(row=>row.project_id);
 const result={unlinked:true,ownerId,previousTargetUserId:targetUserId,projectIds};
 await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}

export async function searchEventArtists(sql,userId,{projectId,boothId,q}) {
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 if(typeof q!=='string'||q.trim().length<2||q.length>100)fail('검색어를 2~100자로 입력해주세요.',400);
 const term=q.trim();
 const artists=(await sql`SELECT o.id,o.id AS owner_id,o.linked_user_id,o.display_name,u.nickname,
  EXISTS(SELECT 1 FROM pos_event_artists e WHERE e.project_id=${projectId} AND e.owner_id=o.id AND e.status='active') AS registered
  FROM pos_stock_owners o LEFT JOIN pos_admins u ON u.id=o.linked_user_id
  WHERE ((o.link_status='linked' AND u.deleted_at IS NULL AND u.id IS NOT NULL) OR
   (o.link_status='unlinked' AND o.origin_booth_id=${boothId} AND EXISTS(SELECT 1 FROM pos_booth_artists a WHERE a.booth_id=${boothId} AND a.owner_id=o.id AND a.status='proxy')))
  AND (strpos(lower(o.display_name),lower(${term}))>0 OR strpos(lower(COALESCE(u.nickname,'')),lower(${term}))>0 OR lower(u.id)=lower(${term}) OR lower(u.email)=lower(${term}))
  ORDER BY o.display_name,o.id LIMIT 20`).rows;
 return {artists};
}

export async function addEventArtist(sql,userId,payload) {
 const {projectId,boothId,profileId,requestId,role='seller'}=payload;
 if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!['none','seller','assistant'].includes(role))fail('제작자 등록 요청을 확인해주세요.',400);
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 const fingerprint=hash({userId,action:'addEventArtist',payload});
 const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.project_id!==projectId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
 const profile=(await sql`SELECT o.*,o.id AS owner_id,o.link_status AS status FROM pos_stock_owners o WHERE o.id=${await ownerIdOf(sql,profileId)} FOR UPDATE`).rows[0];
 if(!profile)fail('제작자를 찾을 수 없습니다.',404);
 if(profile.linked_user_id){if(!(await sql`SELECT id FROM pos_admins WHERE id=${profile.linked_user_id} AND deleted_at IS NULL FOR UPDATE`).rows.length)fail('연결 계정을 확인해주세요.',404);}
 else if(profile.origin_booth_id!==boothId||profile.status!=='unlinked')fail('이 부스의 미연결 제작자를 선택해주세요.',403);
 const relation=(await sql`SELECT status FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${profile.owner_id} FOR UPDATE`).rows[0];
 if(relation?.status==='ending')fail('참여 종료 정리 중인 제작자입니다.',409);
 if(!profile.linked_user_id&&relation?.status!=='proxy')fail('이 부스의 미연결 제작자를 선택해주세요.',403);
 const current=(await sql`SELECT status FROM pos_event_artists WHERE project_id=${projectId} AND owner_id=${profile.owner_id} FOR UPDATE`).rows[0];
 if(current?.status==='active')fail('이미 행사에 등록된 제작자입니다.',409);
 await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status,stock_management_confirmed) VALUES(${boothId},${profile.owner_id},${profile.linked_user_id?'active':'proxy'},${profile.linked_user_id===userId||!profile.linked_user_id}) ON CONFLICT(booth_id,owner_id) DO UPDATE SET status=EXCLUDED.status`;
 await sql`INSERT INTO pos_event_artists(project_id,owner_id,status,version,requested_role,joined_at) VALUES(${projectId},${profile.owner_id},'active',1,${!profile.linked_user_id&&role!=='none'?role:null},NOW()) ON CONFLICT(project_id,owner_id) DO UPDATE SET status='active',version=pos_event_artists.version+1,requested_role=EXCLUDED.requested_role,joined_at=NOW()`;
 if(profile.linked_user_id&&role!=='none'){
  const staff=(await sql`SELECT version FROM pos_event_staff WHERE project_id=${projectId} AND user_id=${profile.linked_user_id}`).rows[0];
  await saveEventAccess(sql,userId,{projectId,boothId,targetUserId:profile.linked_user_id,role,status:'active',version:staff?.version||0,requestId:randomUUID()});
 }
 const result={added:true,profileId,ownerId:profile.owner_id};
 await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}

export async function createEventCreator(sql,userId,payload){
 const {projectId,boothId,name,requestId}=payload;
 if(!/^[a-f0-9-]{36}$/i.test(requestId||''))fail('요청 ID를 확인해주세요.',400);
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 const fingerprint=hash({userId,action:'createEventCreator',payload});
 const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.project_id!==projectId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.',409);return prior.result;}
 const {ownerId}=await createBoothArtist(sql,userId,{boothId,name});
 if(!(await sql`SELECT owner_id FROM pos_event_artists WHERE project_id=${projectId} AND owner_id=${ownerId} AND status='active'`).rows.length)await addEventArtist(sql,userId,{projectId,boothId,profileId:ownerId,role:'none',requestId:randomUUID()});
 const result={added:true,profileId:ownerId,ownerId};
 await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}

const inviteDigest=token=>createHash('sha256').update(token).digest('hex');

// One live link per event: issuing a new link revokes the previous one.
export async function issueEventInvite(sql,userId,{projectId,boothId}) {
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 await sql`UPDATE pos_event_invites SET revoked_at=NOW() WHERE project_id=${projectId} AND revoked_at IS NULL`;
 const token=randomBytes(32).toString('hex'),id=randomUUID();
 const row=(await sql`INSERT INTO pos_event_invites(id,token_hash,project_id,booth_id,issued_by,expires_at)
  VALUES(${id},${inviteDigest(token)},${projectId},${boothId},${userId},NOW()+INTERVAL '7 days') RETURNING id,expires_at`).rows[0];
 return {invite:{id:row.id,token,expiresAt:row.expires_at}};
}

async function inviteForToken(sql,token,userId) {
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('사용할 수 없는 초대입니다.',404);
 const invite=(await sql`SELECT i.*,i.expires_at<=NOW() AS expired,p.name AS event_name,b.name AS booth_name,b.status AS booth_status
  FROM pos_event_invites i JOIN pos_projects p ON p.id=i.project_id AND p.deleted_at IS NULL JOIN pos_booths b ON b.id=i.booth_id
  WHERE i.token_hash=${inviteDigest(token)}`).rows[0];
 if(!invite)fail('사용할 수 없는 초대입니다.',404);
 if(invite.revoked_at||invite.expired||invite.booth_status!=='active')fail('만료되거나 철회된 초대입니다.',409);
 // An issuer who lost operator rights can no longer admit creators.
 const issuer=(await sql`SELECT m.user_id FROM pos_booth_members m JOIN pos_admins u ON u.id=m.user_id AND u.deleted_at IS NULL
  WHERE m.booth_id=${invite.booth_id} AND m.user_id=${invite.issued_by} AND m.status='active' AND m.role IN ('owner','manager')`).rows[0];
 if(!issuer)fail('발급 권한이 종료된 초대입니다.',409);
 const joined=(await sql`SELECT 1 FROM pos_event_artists e JOIN pos_stock_owners o ON o.id=e.owner_id
  WHERE e.project_id=${invite.project_id} AND e.status='active' AND o.linked_user_id=${userId} AND o.link_status='linked' LIMIT 1`).rows.length>0;
 return {invite,joined};
}

export async function previewEventInvite(sql,userId,{token}) {
 const {invite,joined}=await inviteForToken(sql,token,userId);
 const operators=(await sql`SELECT m.user_id,COALESCE(NULLIF(u.nickname,''),u.id) AS name FROM pos_booth_members m JOIN pos_admins u ON u.id=m.user_id AND u.deleted_at IS NULL
  WHERE m.booth_id=${invite.booth_id} AND m.status='active' AND m.role IN ('owner','manager') ORDER BY (m.user_id=${invite.issued_by}) DESC,m.user_id`).rows;
 const details=(await sql`SELECT d.venue,sp.starts_on::text,sp.ends_on::text FROM pos_projects p LEFT JOIN pos_event_details d ON d.project_id=p.id
  LEFT JOIN pos_event_stock_policy sp ON sp.project_id=p.id WHERE p.id=${invite.project_id}`).rows[0]||{};
 return {invitation:{eventName:invite.event_name,boothName:invite.booth_name==='기본 부스'?'':invite.booth_name,expiresAt:invite.expires_at,joined,
  operatorName:operators[0]?.name||'',operatorOthers:Math.max(0,operators.length-1),venue:details.venue||'',startsOn:details.starts_on||null,endsOn:details.ends_on||null}};
}

export async function acceptEventInvite(sql,userId,{token,acceptSharedStock}) {
 if(acceptSharedStock!==true)fail('부스와 재고를 공동 관리하는 참여에 동의해주세요.',400);
 const candidate=(await inviteForToken(sql,token,userId)).invite;
 await sql`SELECT id FROM pos_admins WHERE id=${userId} FOR UPDATE`;
 await sql`SELECT id FROM pos_booths WHERE id=${candidate.booth_id} FOR UPDATE`;
 await sql`SELECT id FROM pos_event_invites WHERE id=${candidate.id} FOR UPDATE`;
 const {invite,joined}=await inviteForToken(sql,token,userId);
 const result={joined:true,projectId:invite.project_id,boothId:invite.booth_id,eventName:invite.event_name};
 if(joined)return result;
 // The accepting account's own creator profile becomes the event creator.
 let profile=(await sql`SELECT o.id FROM pos_stock_owners o JOIN pos_owner_members m ON m.owner_id=o.id AND m.user_id=${userId}
  WHERE o.linked_user_id=${userId} AND o.link_status='linked' ORDER BY o.id LIMIT 1`).rows[0];
 if(!profile){
  const account=(await sql`SELECT nickname FROM pos_admins WHERE id=${userId}`).rows[0];
  await createArtistProfile(sql,userId,{name:(account?.nickname||'').trim().slice(0,80)||userId.slice(0,80)});
  profile=(await sql`SELECT id FROM pos_stock_owners WHERE linked_user_id=${userId} AND link_status='linked' ORDER BY id LIMIT 1`).rows[0];
 }
 const relation=(await sql`SELECT status FROM pos_booth_artists WHERE booth_id=${invite.booth_id} AND owner_id=${profile.id} FOR UPDATE`).rows[0];
 if(relation?.status==='ending')fail('참여 종료 정리 중인 제작자입니다.',409);
 await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status,stock_management_confirmed) VALUES(${invite.booth_id},${profile.id},'active',TRUE)
  ON CONFLICT(booth_id,owner_id) DO UPDATE SET status='active',stock_management_confirmed=TRUE`;
 await sql`INSERT INTO pos_event_artists(project_id,owner_id,status,version,joined_at) VALUES(${invite.project_id},${profile.id},'active',1,NOW())
  ON CONFLICT(project_id,owner_id) DO UPDATE SET status='active',version=pos_event_artists.version+1,joined_at=NOW()`;
 // 초대로 참여한 제작자의 행사 권한은 항상 판매 참여자(seller)다.
 await sql`INSERT INTO pos_event_staff(project_id,user_id,role,status,version,changed_by) VALUES(${invite.project_id},${userId},'seller','active',1,${invite.issued_by})
  ON CONFLICT(project_id,user_id) DO UPDATE SET role='seller',status='active',version=pos_event_staff.version+1,changed_by=EXCLUDED.changed_by`;
 await sql`INSERT INTO pos_artist_link_audit(id,owner_id,booth_id,actor_id,action) VALUES(${randomUUID()},${profile.id},${invite.booth_id},${userId},'event_invite_accepted')`;
 return result;
}

export async function removeEventArtist(sql,userId,payload) {
 const {projectId,boothId,ownerId,version,requestId}=payload;
 if(!/^[a-f0-9-]{36}$/i.test(requestId||'')||!Number.isSafeInteger(version))fail('제작자 삭제 요청을 확인해주세요.',400);
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 const fingerprint=hash({userId,action:'removeEventArtist',payload});
 const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.fingerprint!==fingerprint)fail('같은 요청의 내용이 다릅니다.',409);return prior.result;}
 const participation=(await sql`SELECT e.*,o.linked_user_id FROM pos_event_artists e JOIN pos_stock_owners o ON o.id=e.owner_id WHERE e.project_id=${projectId} AND e.owner_id=${ownerId} FOR UPDATE OF e`).rows[0];
 if(!participation||participation.status!=='active')fail('행사 참여 제작자를 찾을 수 없습니다.',404);
 if(participation.version!==version)fail('참여 제작자가 변경되었습니다. 새로고침해주세요.',409);
 const key=hash([boothId,'event-unassigned']),unassignedId=`unassigned-owner:${key}`;
 await sql`INSERT INTO pos_stock_owners(id,kind,display_name,origin_booth_id,legacy_key) VALUES(${unassignedId},'unverified','미지정',${boothId},${unassignedId}) ON CONFLICT DO NOTHING`;
 await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${boothId},${unassignedId},'proxy') ON CONFLICT DO NOTHING`;
 await sql`INSERT INTO pos_event_artists(project_id,owner_id) VALUES(${projectId},${unassignedId}) ON CONFLICT DO NOTHING`;
 const recipientId='unassigned-recipient:'+key;
 await sql`INSERT INTO pos_recipients(id,booth_id,legacy_creator,display_name,owner_id) VALUES(${recipientId},${boothId},${unassignedId},'미지정',${unassignedId}) ON CONFLICT(booth_id,legacy_creator) DO NOTHING`;
 const recipient=(await sql`SELECT id FROM pos_recipients WHERE booth_id=${boothId} AND legacy_creator=${unassignedId}`).rows[0];
 await sql`INSERT INTO pos_event_recipients(project_id,legacy_creator,recipient_id) VALUES(${projectId},${unassignedId},${recipient.id}) ON CONFLICT DO NOTHING`;
 const products=(await sql`SELECT product_id FROM pos_event_product_identities WHERE project_id=${projectId} AND owner_id=${ownerId} FOR UPDATE`).rows.map(p=>p.product_id);
 await sql`UPDATE pos_inventory SET version=version+1 WHERE (admin_id,id) IN (SELECT admin_id,inventory_id FROM pos_inventory_links WHERE project_id=${projectId} AND product_id=ANY(${products}::text[]))`;
 await sql`UPDATE pos_event_product_identities SET owner_id=${unassignedId},recipient_id=${recipient.id} WHERE project_id=${projectId} AND owner_id=${ownerId}`;
 await sql`UPDATE pos_products SET creator_name='미지정',updated_at=NOW() WHERE project_id=${projectId} AND id=ANY(${products}::text[])`;
 await sql`UPDATE pos_event_artists SET status='ended',version=version+1 WHERE project_id=${projectId} AND owner_id=${ownerId}`;
 // Keep independent booth roles and any other active creator profile's role intact.
 if(participation.linked_user_id&&!(await sql`SELECT o.id FROM pos_event_artists e JOIN pos_stock_owners o ON o.id=e.owner_id WHERE e.project_id=${projectId} AND e.status='active' AND o.linked_user_id=${participation.linked_user_id}`).rows.length)await sql`UPDATE pos_event_staff SET status='ended',version=version+1 WHERE project_id=${projectId} AND user_id=${participation.linked_user_id}`;
 await sql`INSERT INTO pos_event_archives(project_id,revision,snapshot) VALUES(${projectId},${'creator-delete:'+requestId},'{}'::jsonb) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision`;
 const result={removed:true,removedOwnerId:ownerId,productIds:products,...await eventAccessView(sql,userId,{projectId,boothId})};
 await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}
