import {initStockDelegation} from './stockDelegation.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { initBoothFoundation, retireArtistProfiles, ownerIdOf, authorizeBooth, migratedBooth, migrateLegacyBooth, legacySnapshot, foundationReport } from './boothFoundation.js';
import { eventState } from './eventSettlement.js';
import { eventSettlementPreview } from '../../src/utils/eventSettlement.js';
import { settlementMoneyEntries } from '../../src/utils/settlementEntries.js';

const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const digest=token=>createHash('sha256').update(token).digest('hex');
const name=value=>{
  if(typeof value!=='string' || !value.trim() || value.trim().length>80) fail('이름은 1~80자로 입력해주세요.',400);
  return value.trim();
};

export async function initArtistLinking(sql) {
  const schema=(await sql`SELECT to_regclass('pos_artist_invitations') AS invitations,to_regclass('pos_artist_link_audit') AS audit`).rows[0];
  // Both tables and the nullable origin are installed in the same transaction.
  // Established reads must not reacquire schema locks for every artist page.
  if(schema?.invitations && schema?.audit) {await retireArtistProfiles(sql);return;}
  await initBoothFoundation(sql);
  // A personal artist exists independently of a booth. Legacy origins stay intact.
  const origin=(await sql`SELECT attnotnull FROM pg_attribute WHERE attrelid='pos_stock_owners'::regclass AND attname='origin_booth_id'`).rows[0];
  if(origin?.attnotnull) await sql`ALTER TABLE pos_stock_owners ALTER COLUMN origin_booth_id DROP NOT NULL`;
  await sql`CREATE TABLE IF NOT EXISTS pos_artist_invitations (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id),
    booth_id TEXT NOT NULL REFERENCES pos_booths(id), issued_by TEXT NOT NULL REFERENCES pos_admins(id),
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), revoked_at TIMESTAMPTZ,
    accepted_by TEXT REFERENCES pos_admins(id), accepted_at TIMESTAMPTZ,
    CHECK((accepted_by IS NULL)=(accepted_at IS NULL)))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_artist_link_audit (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id),
    booth_id TEXT REFERENCES pos_booths(id), actor_id TEXT NOT NULL REFERENCES pos_admins(id),
    invitation_id TEXT REFERENCES pos_artist_invitations(id), action TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
}

async function audit(sql,actorId,ownerId,boothId,action,invitationId=null) {
  await sql`INSERT INTO pos_artist_link_audit(id,owner_id,booth_id,actor_id,invitation_id,action)
    VALUES(${randomUUID()},${ownerId},${boothId},${actorId},${invitationId},${action})`;
}

export async function artistHome(sql,userId) {
  // 제작자 id가 응답의 id다. 화면 호환을 위해 owner_id도 같은 값으로 보낸다.
  const profiles=(await sql`SELECT o.id,o.id AS owner_id,o.display_name,o.origin_booth_id
    FROM pos_stock_owners o JOIN pos_owner_members m ON m.owner_id=o.id AND m.user_id=${userId}
    WHERE o.linked_user_id=${userId} AND o.link_status='linked' ORDER BY o.id`).rows;
  const booths=(await sql`SELECT b.id,b.name,m.role FROM pos_booths b
    JOIN pos_booth_members m ON m.booth_id=b.id WHERE m.user_id=${userId} AND m.status='active' ORDER BY b.id`).rows;
  const links=(await sql`SELECT a.owner_id AS profile_id,a.booth_id,a.actor_id,a.action,a.created_at FROM pos_artist_link_audit a
    JOIN pos_stock_owners o ON o.id=a.owner_id WHERE o.linked_user_id=${userId} ORDER BY a.created_at,a.id`).rows;
  const defaultBooth=await migratedBooth(sql,userId);
  const sharedTable=(await sql`SELECT to_regclass('pos_shared_stock_items') AS name`).rows[0]?.name;
  const shared=sharedTable&&(await sql`SELECT id FROM pos_shared_stock_items WHERE admin_id=${userId} LIMIT 1`).rows.length;
  return {profiles,booths,links,compatibility:{restoreAllowed:!defaultBooth&&!shared,
    deleteAllowed:!defaultBooth && !profiles.length && !booths.some(b=>b.role==='owner')}};
}

export async function createArtistProfile(sql,userId,payload) {
  // Deterministic personal identity makes an uncertain retry safe. Claimed legacy
  // profiles remain distinct; never use a name to merge them.
  await sql`SELECT id FROM pos_admins WHERE id=${userId} FOR UPDATE`;
  const ownerId=`personal-owner:${digest(userId)}`;
  const displayName=name(payload.name);
  const existing=(await sql`SELECT id FROM pos_stock_owners WHERE id=${ownerId}`).rows[0];
  if(!existing) {
    await sql`INSERT INTO pos_stock_owners(id,kind,display_name,origin_booth_id,legacy_key,linked_user_id,link_status) VALUES(${ownerId},'artist',${displayName},NULL,${ownerId},${userId},'linked')`;
    await sql`INSERT INTO pos_owner_members(owner_id,user_id) VALUES(${ownerId},${userId})`;
    await audit(sql,userId,ownerId,null,'profile_created');
  }
  return artistHome(sql,userId);
}

export async function createFirstBooth(sql,userId,payload) {
  await sql`SELECT id FROM pos_admins WHERE id=${userId} FOR UPDATE`;
  const displayName=name(payload.name);
  let booth=await migratedBooth(sql,userId);
  if(booth) {await authorizeBooth(sql,userId,booth.id,'owner');return {booth:{id:booth.id,name:booth.name}};}
  const source=await legacySnapshot(sql,userId);
  if(source.projects.length || source.inventory.length) fail('기존 자료가 있는 계정은 먼저 호환 이관을 진행해주세요.');
  const profile=(await sql`SELECT id AS owner_id FROM pos_stock_owners WHERE linked_user_id=${userId} AND link_status='linked' ORDER BY id LIMIT 1`).rows[0];
  if(!profile) fail('제작자 프로필을 먼저 만들어주세요.');
  const result=await migrateLegacyBooth(sql,userId,{dryRun:false,expectedFingerprint:foundationReport(source).fingerprint});
  await sql`UPDATE pos_booths SET name=${displayName} WHERE id=${result.boothId}`;
  await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${result.boothId},${profile.owner_id},'active') ON CONFLICT DO NOTHING`;
  return {booth:{id:result.boothId,name:displayName}};
}

export async function createBoothArtist(sql,userId,{boothId,name:displayName}) {
  await authorizeBooth(sql,userId,boothId,'manage');
  const key=name(displayName);
  if(key==='미지정') fail('실제 제작자명을 입력해주세요.',400);
  // Same mapping as legacy reconciliation; a later source item cannot spawn a
  // second identity for the explicitly created proxy artist.
  const ownerId=`owner:${digest(JSON.stringify([boothId,key]))}`;
  const created=(await sql`INSERT INTO pos_stock_owners(id,kind,display_name,origin_booth_id,legacy_key)
    VALUES(${ownerId},'unverified',${key},${boothId},${key}) ON CONFLICT DO NOTHING RETURNING id`).rows.length>0;
  await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${boothId},${ownerId},'proxy') ON CONFLICT DO NOTHING`;
  if(created) await audit(sql,userId,ownerId,boothId,'profile_created');
  return {profileId:ownerId,ownerId};
}

export async function boothArtists(sql,userId,boothId) {
  await authorizeBooth(sql,userId,boothId,'manage');
  const profiles=(await sql`SELECT o.id,o.id AS owner_id,o.link_status AS status,o.display_name,a.status AS participation
    FROM pos_booth_artists a JOIN pos_stock_owners o ON o.id=a.owner_id WHERE a.booth_id=${boothId} ORDER BY o.display_name,o.id`).rows;
  const invitations=(await sql`SELECT id,owner_id AS profile_id,expires_at,created_at,revoked_at,accepted_at
    FROM pos_artist_invitations WHERE booth_id=${boothId} ORDER BY created_at DESC`).rows;
  const auditRows=(await sql`SELECT owner_id AS profile_id,actor_id,action,created_at FROM pos_artist_link_audit WHERE booth_id=${boothId} ORDER BY created_at,id`).rows;
  return {profiles,invitations,audit:auditRows};
}

export async function issueArtistInvitation(sql,userId,{boothId,profileId}) {
  await authorizeBooth(sql,userId,boothId,'manage');
  const ownerId=await ownerIdOf(sql,profileId);
  const profile=(await sql`SELECT o.* FROM pos_stock_owners o
    JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=${boothId}
    WHERE o.id=${ownerId} AND a.status='proxy' AND o.origin_booth_id=${boothId} FOR UPDATE OF o`).rows[0];
  if(!profile || profile.link_status!=='unlinked') fail('초대할 미연동 제작자를 확인해주세요.');
  if(profile.display_name==='미지정') fail('미지정 자료의 소유자를 먼저 확인해주세요.');
  // Reissue revokes every outstanding token for this creator in this booth.
  const superseded=(await sql`UPDATE pos_artist_invitations SET revoked_at=NOW() WHERE owner_id=${ownerId} AND booth_id=${boothId} AND revoked_at IS NULL AND accepted_at IS NULL RETURNING id`).rows;
  for(const old of superseded) await audit(sql,userId,ownerId,boothId,'invitation_revoked',old.id);
  const token=randomBytes(32).toString('hex'),invitationId=randomUUID();
  const row=(await sql`INSERT INTO pos_artist_invitations(id,token_hash,owner_id,booth_id,issued_by,expires_at)
    VALUES(${invitationId},${digest(token)},${ownerId},${boothId},${userId},NOW()+INTERVAL '7 days') RETURNING id,expires_at`).rows[0];
  await audit(sql,userId,ownerId,boothId,'invitation_issued',invitationId);
  return {invitation:{...row,token}};
}

async function invitationForToken(sql,token) {
  if(typeof token!=='string' || !/^[a-f0-9]{64}$/.test(token)) fail('사용할 수 없는 초대입니다.',404);
  const invite=(await sql`SELECT i.*,i.expires_at<=NOW() AS expired,b.name AS booth_name,b.legacy_admin_id,b.status AS booth_status
    FROM pos_artist_invitations i JOIN pos_booths b ON b.id=i.booth_id WHERE i.token_hash=${digest(token)}`).rows[0];
  if(!invite) fail('사용할 수 없는 초대입니다.',404);
  return invite;
}

async function validateInvitation(sql,invite,userId) {
  if(invite.accepted_by) {
    if(invite.accepted_by!==userId) fail('이미 사용된 초대입니다.');
    return;
  }
  if(invite.revoked_at || invite.expired || invite.booth_status!=='active') fail('만료되거나 철회된 초대입니다.');
  // Revoked issuer privileges invalidate outstanding invitations as well.
  const issuer=(await sql`SELECT m.user_id FROM pos_booth_members m JOIN pos_admins u ON u.id=m.user_id
    WHERE m.booth_id=${invite.booth_id} AND m.user_id=${invite.issued_by} AND m.status='active'
    AND m.role IN ('owner','manager') AND u.deleted_at IS NULL`).rows[0];
  if(!issuer) fail('발급 권한이 종료된 초대입니다.');
  const participation=(await sql`SELECT owner_id FROM pos_booth_artists WHERE booth_id=${invite.booth_id}
    AND owner_id=${invite.owner_id} AND status='proxy'`).rows[0];
  if(!participation) fail('제작자 참여 상태가 변경되었습니다.');
}

export async function previewArtistInvitation(sql,userId,{token}) {
  await initStockDelegation(sql);
  const invite=await invitationForToken(sql,token);
  await validateInvitation(sql,invite,userId);
  const profile=(await sql`SELECT id,link_status AS status,linked_user_id,display_name FROM pos_stock_owners WHERE id=${invite.owner_id}`).rows[0];
  if(profile.linked_user_id && profile.linked_user_id!==userId) fail('이미 연결된 제작자입니다.');
  return {allowOperatorStock:(await sql`SELECT allow_operator_stock FROM pos_admins WHERE id=${userId}`).rows[0]?.allow_operator_stock!==false,invitation:{id:invite.id,profileId:profile.id,artistName:profile.display_name,boothName:invite.booth_name,
    expiresAt:invite.expires_at,accepted:Boolean(invite.accepted_by)}};
}

export async function acceptArtistInvitation(sql,userId,payload) {
  await initStockDelegation(sql);
  if(payload.acceptSharedStock!==true) fail('부스와 총재고를 공동 관리하는 연결에 동의해주세요.',400);
  const candidate=await invitationForToken(sql,payload.token);
  // Match legacy POS lock order: authentication principals, then shared rows.
  await sql`SELECT id FROM pos_admins WHERE id IN (${userId},${candidate.legacy_admin_id},${candidate.issued_by}) ORDER BY id FOR UPDATE`;
  await sql`SELECT id FROM pos_booths WHERE id=${candidate.booth_id} FOR UPDATE`;
  await sql`SELECT id FROM pos_stock_owners WHERE id=${candidate.owner_id} FOR UPDATE`;
  await sql`SELECT id FROM pos_artist_invitations WHERE id=${candidate.id} FOR UPDATE`;
  const invite=await invitationForToken(sql,payload.token);
  await validateInvitation(sql,invite,userId);
  if(invite.accepted_by===userId) return {linked:true,profileId:invite.owner_id};
  if(payload.allowOperatorStock!==undefined){if(typeof payload.allowOperatorStock!=='boolean')fail('재고관리 허용 설정을 확인해주세요.',400);await sql`UPDATE pos_admins SET allow_operator_stock=${payload.allowOperatorStock} WHERE id=${userId}`;}
  const profile=(await sql`SELECT * FROM pos_stock_owners WHERE id=${invite.owner_id}`).rows[0];
  if(profile.link_status!=='unlinked' || profile.linked_user_id) fail('이미 연결된 제작자입니다.');
  await sql`UPDATE pos_stock_owners SET link_status='linked',linked_user_id=${userId},kind='artist' WHERE id=${profile.id}`;
  await sql`INSERT INTO pos_owner_members(owner_id,user_id) VALUES(${profile.id},${userId}) ON CONFLICT DO NOTHING`;
  await sql`UPDATE pos_booth_artists SET status='active',stock_management_confirmed=TRUE WHERE booth_id=${invite.booth_id} AND owner_id=${profile.id}`;
  await sql`UPDATE pos_artist_invitations SET accepted_by=${userId},accepted_at=NOW() WHERE id=${invite.id}`;
  await audit(sql,userId,profile.id,invite.booth_id,'profile_linked',invite.id);
  return {linked:true,profileId:profile.id};
}

export async function revokeArtistInvitation(sql,userId,{boothId,invitationId}) {
  await authorizeBooth(sql,userId,boothId,'manage');
  const row=(await sql`SELECT * FROM pos_artist_invitations WHERE id=${invitationId} AND booth_id=${boothId} FOR UPDATE`).rows[0];
  if(!row || row.accepted_at) fail('철회할 초대를 확인해주세요.');
  if(!row.revoked_at) {
    await sql`UPDATE pos_artist_invitations SET revoked_at=NOW() WHERE id=${invitationId}`;
    await audit(sql,userId,row.owner_id,boothId,'invitation_revoked',row.id);
  }
  return {revoked:true};
}

export async function artistHistory(sql,userId) {
  const home=await artistHome(sql,userId);
  const recipients=(await sql`SELECT r.id,r.booth_id,r.legacy_creator,r.owner_id,o.display_name
    FROM pos_recipients r JOIN pos_stock_owners o ON o.id=r.owner_id
    JOIN pos_owner_members m ON m.owner_id=o.id AND m.user_id=${userId}
    WHERE o.linked_user_id=${userId} AND o.link_status='linked'`).rows;
  const events=(await sql`SELECT DISTINCT e.id,e.name,b.id AS booth_id,b.name AS booth_name,b.legacy_admin_id
    FROM pos_projects e JOIN pos_event_booths eb ON eb.project_id=e.id JOIN pos_booths b ON b.id=eb.booth_id
    JOIN pos_event_recipients er ON er.project_id=e.id JOIN pos_recipients r ON r.id=er.recipient_id
    JOIN pos_stock_owners o ON o.id=r.owner_id JOIN pos_owner_members m ON m.owner_id=o.id
    WHERE o.linked_user_id=${userId} AND m.user_id=${userId} AND o.link_status='linked' ORDER BY e.id`).rows;
  const result=[];
  for(const event of events) {
    const state=await eventState(sql,event.legacy_admin_id,event.id);
    const hasLedger=(await sql`SELECT to_regclass('pos_settlements') AS name`).rows[0]?.name;
    const records=hasLedger?(await sql`SELECT * FROM pos_settlements WHERE admin_id=${event.legacy_admin_id} AND project_id=${event.id}`).rows:[];
    const closure=(await sql`SELECT * FROM pos_event_settlements WHERE admin_id=${event.legacy_admin_id} AND project_id=${event.id}`).rows[0];
    const calculation=closure?.closed_at?closure.snapshot:eventSettlementPreview(state,closure?.costs || [],records);
    const own=recipients.filter(r=>r.booth_id===event.booth_id);
    const byAlias=new Map(own.map(r=>[r.legacy_creator,r]));
    const byProduct=Object.fromEntries(state.products.map(p=>[p.id,p]));
    const sales=[];
    const voided=(await sql`SELECT snapshot FROM pos_booth_sale_history WHERE project_id=${event.id} AND voided=TRUE AND snapshot IS NOT NULL ORDER BY sale_id`).rows;
    const history=[...state.sales.map(sale=>({...sale,voided:false})),...voided.map(row=>({...row.snapshot,voided:true}))];
    for(const sale of history) {
      const entries=(sale.lines || []).flatMap(line=>settlementMoneyEntries(line,byProduct,state.bundles))
        .filter(entry=>byAlias.has(String(entry.creator || '').trim() || '미지정'));
      // Whitelist only own components. Never expose the source order, method,
      // bundle title, other components, or booth totals/customer information.
      if(entries.length) sales.push({time:sale.time,voided:sale.voided,items:entries.map(entry=>({
        recipientId:byAlias.get(String(entry.creator || '').trim() || '미지정').id,
        name:entry.name,quantity:entry.qty,amount:entry.amount}))});
    }
    const rows=(calculation?.rows || []).filter(row=>byAlias.has(row.creator)).map(row=>{
      const recipient=byAlias.get(row.creator),record=records.find(r=>r.creator===row.creator);
      const payments=(record?.payments || []).map(p=>({id:p.id,amount:p.amount,paidAt:p.paidAt}));
      const paid=payments.reduce((sum,p)=>sum+p.amount,0);
      return {recipientId:recipient.id,ownerId:recipient.owner_id,artistName:recipient.display_name,gross:row.gross,
        fees:row.fees,net:row.net,shares:(row.shares || []).map(s=>({label:s.label,amount:s.amount})),
        paid,pending:Math.max(0,row.net-paid),payments};
    });
    result.push({projectId:event.id,eventName:event.name,boothId:event.booth_id,boothName:event.booth_name,
      closedAt:closure?.closed_at || null,rows,sales});
  }
  return {...home,events:result};
}
