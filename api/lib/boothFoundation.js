import {assertStockDelegation,initStockDelegation} from './stockDelegation.js';
import { createHash, randomUUID } from 'node:crypto';

const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const id = (kind, ...keys) => `${kind}:${createHash('sha256').update(JSON.stringify(keys)).digest('hex')}`;
const canonical = value => value?.toJSON ? canonical(value.toJSON()) : Array.isArray(value) ? value.map(canonical)
  : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const nameOf = value => String(value || '').trim() || '미지정';

// This is an additive, explicitly invoked migration. Ordinary POS requests must
// never migrate an entire production account as a side effect of reading it.
export async function initBoothFoundation(sql) {
  await sql`ALTER TABLE pos_projects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booths (
    id TEXT PRIMARY KEY, legacy_admin_id TEXT NOT NULL UNIQUE REFERENCES pos_admins(id),
    name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'collaborative' CHECK(kind IN ('collaborative','enterprise')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_members (
    booth_id TEXT NOT NULL REFERENCES pos_booths(id), user_id TEXT NOT NULL REFERENCES pos_admins(id),
    role TEXT NOT NULL CHECK(role IN ('owner','manager','seller','viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended')), PRIMARY KEY(booth_id,user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_stock_owners (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('artist','organization','unverified')),
    display_name TEXT NOT NULL, origin_booth_id TEXT NOT NULL REFERENCES pos_booths(id),
    legacy_key TEXT NOT NULL, UNIQUE(origin_booth_id,legacy_key),
    linked_user_id TEXT REFERENCES pos_admins(id), link_status TEXT NOT NULL DEFAULT 'unlinked' CHECK(link_status IN ('unlinked','linked')),
    CONSTRAINT pos_stock_owners_link_check CHECK((link_status='unlinked' AND linked_user_id IS NULL) OR (link_status='linked' AND linked_user_id IS NOT NULL)))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_owner_members (
    owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id), user_id TEXT NOT NULL REFERENCES pos_admins(id),
    PRIMARY KEY(owner_id,user_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_artists (
    booth_id TEXT NOT NULL REFERENCES pos_booths(id), owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id),
    status TEXT NOT NULL CHECK(status IN ('proxy','active','ending','ended')), PRIMARY KEY(booth_id,owner_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory_owners (
    admin_id TEXT NOT NULL, inventory_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id),
    PRIMARY KEY(admin_id,inventory_id), FOREIGN KEY(admin_id,inventory_id) REFERENCES pos_inventory(admin_id,id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_booths (
    project_id TEXT PRIMARY KEY REFERENCES pos_projects(id), booth_id TEXT NOT NULL REFERENCES pos_booths(id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_recipients (
    id TEXT PRIMARY KEY, booth_id TEXT NOT NULL REFERENCES pos_booths(id),
    legacy_creator TEXT NOT NULL, display_name TEXT NOT NULL, owner_id TEXT REFERENCES pos_stock_owners(id),
    UNIQUE(booth_id,legacy_creator))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_recipients (
    project_id TEXT NOT NULL REFERENCES pos_projects(id), legacy_creator TEXT NOT NULL,
    recipient_id TEXT NOT NULL REFERENCES pos_recipients(id), PRIMARY KEY(project_id,legacy_creator))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_product_identities (
    project_id TEXT NOT NULL REFERENCES pos_projects(id), product_id TEXT NOT NULL,
    owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id), recipient_id TEXT NOT NULL REFERENCES pos_recipients(id),
    resolution TEXT NOT NULL CHECK(resolution IN ('inventory','legacy_unlinked')), PRIMARY KEY(project_id,product_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_inventory_openings (
    admin_id TEXT NOT NULL, inventory_id TEXT NOT NULL, snapshot JSONB NOT NULL, fingerprint TEXT NOT NULL,
    PRIMARY KEY(admin_id,inventory_id), FOREIGN KEY(admin_id,inventory_id) REFERENCES pos_inventory(admin_id,id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_migrations (
    booth_id TEXT PRIMARY KEY REFERENCES pos_booths(id), source_fingerprint TEXT NOT NULL,
    source_snapshot JSONB NOT NULL, report JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS pos_booth_sale_history (
    project_id TEXT NOT NULL REFERENCES pos_projects(id), sale_id TEXT NOT NULL, snapshot JSONB,
    voided BOOLEAN NOT NULL DEFAULT FALSE, PRIMARY KEY(project_id,sale_id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_owner_commands (
    owner_id TEXT NOT NULL REFERENCES pos_stock_owners(id), request_id TEXT NOT NULL,
    actor_id TEXT NOT NULL REFERENCES pos_admins(id), booth_id TEXT REFERENCES pos_booths(id),
    fingerprint TEXT NOT NULL, result JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(owner_id,request_id))`;
  await retireArtistProfiles(sql);
}

// 제작자의 계정 연결은 pos_stock_owners 한 행에 둔다. 기존 pos_artist_profiles의
// 연결 정보를 옮긴 뒤 테이블은 롤백용으로 이름만 바꿔 보존한다.
export async function retireArtistProfiles(sql) {
  const has=async()=>{
    const row=(await sql`SELECT to_regclass('pos_stock_owners') AS owners,to_regclass('pos_artist_profiles') AS profiles,
      EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='pos_stock_owners' AND column_name='link_status') AS folded`).rows[0];
    return row;
  };
  let state=await has();
  if(!state.owners||state.folded&&!state.profiles)return;
  await sql`SELECT pg_advisory_xact_lock(hashtext('pos_retire_artist_profiles'))`;
  state=await has();
  if(state.folded&&!state.profiles)return;
  await sql`ALTER TABLE pos_stock_owners ADD COLUMN IF NOT EXISTS linked_user_id TEXT REFERENCES pos_admins(id)`;
  await sql`ALTER TABLE pos_stock_owners ADD COLUMN IF NOT EXISTS link_status TEXT NOT NULL DEFAULT 'unlinked'`;
  if(state.profiles){
    await sql`UPDATE pos_stock_owners o SET linked_user_id=p.linked_user_id,link_status=p.status FROM pos_artist_profiles p WHERE p.owner_id=o.id`;
    // 기존 profile_id는 legacy_profile_id로 보존하고 owner_id를 새 기준으로 쓴다.
    if(await legacyProfileColumn(sql,'pos_artist_invitations')){
      await sql`ALTER TABLE pos_artist_invitations ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES pos_stock_owners(id)`;
      await sql`UPDATE pos_artist_invitations t SET owner_id=p.owner_id FROM pos_artist_profiles p WHERE p.id=t.profile_id AND t.owner_id IS NULL`;
      await sql`ALTER TABLE pos_artist_invitations ALTER COLUMN owner_id SET NOT NULL`;
      await sql`ALTER TABLE pos_artist_invitations ALTER COLUMN profile_id DROP NOT NULL`;
      await sql`ALTER TABLE pos_artist_invitations RENAME COLUMN profile_id TO legacy_profile_id`;
    }
    if(await legacyProfileColumn(sql,'pos_artist_link_audit')){
      await sql`ALTER TABLE pos_artist_link_audit ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES pos_stock_owners(id)`;
      await sql`UPDATE pos_artist_link_audit t SET owner_id=p.owner_id FROM pos_artist_profiles p WHERE p.id=t.profile_id AND t.owner_id IS NULL`;
      await sql`ALTER TABLE pos_artist_link_audit ALTER COLUMN owner_id SET NOT NULL`;
      await sql`ALTER TABLE pos_artist_link_audit ALTER COLUMN profile_id DROP NOT NULL`;
      await sql`ALTER TABLE pos_artist_link_audit RENAME COLUMN profile_id TO legacy_profile_id`;
    }
    await sql`ALTER TABLE pos_artist_profiles RENAME TO pos_artist_profiles_retired`;
  }
  const check=(await sql`SELECT 1 FROM pg_constraint WHERE conname='pos_stock_owners_link_check'`).rows.length;
  if(!check)await sql`ALTER TABLE pos_stock_owners ADD CONSTRAINT pos_stock_owners_link_check CHECK((link_status='unlinked' AND linked_user_id IS NULL) OR (link_status='linked' AND linked_user_id IS NOT NULL))`;
  const statusCheck=(await sql`SELECT 1 FROM pg_constraint WHERE conname='pos_stock_owners_link_status_check'`).rows.length;
  if(!statusCheck)await sql`ALTER TABLE pos_stock_owners ADD CONSTRAINT pos_stock_owners_link_status_check CHECK(link_status IN ('unlinked','linked'))`;
}

async function legacyProfileColumn(sql,table) {
  if(!await available(sql,table))return false;
  return (await sql`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=${table} AND column_name='profile_id'`).rows.length>0;
}

// 이전 화면이 보낸 프로필 ID도 제작자 ID로 해석한다.
export async function ownerIdOf(sql,id) {
  if(typeof id!=='string'||!id)return null;
  if((await sql`SELECT id FROM pos_stock_owners WHERE id=${id}`).rows.length)return id;
  if(!await available(sql,'pos_artist_profiles_retired'))return null;
  return (await sql`SELECT owner_id FROM pos_artist_profiles_retired WHERE id=${id}`).rows[0]?.owner_id||null;
}

async function available(sql, table) {
  return Boolean((await sql`SELECT to_regclass(${table}) AS name`).rows[0]?.name);
}

// Fixed table names only; data from the caller is always parameterized.
export async function legacySnapshot(sql, adminId) {
  // An additive nullable deletion marker must not look like a source-data
  // mutation when an older schema is migrated. Non-null markers remain hashed.
  const projects = (await sql`SELECT * FROM pos_projects WHERE admin_id=${adminId} ORDER BY id`).rows.map(row=>({...row,deleted_at:row.deleted_at??null}));
  const inventory = (await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} ORDER BY id`).rows;
  const products = (await sql`SELECT p.* FROM pos_products p JOIN pos_projects e ON e.id=p.project_id WHERE e.admin_id=${adminId} ORDER BY p.project_id,p.id`).rows;
  const bundles = (await sql`SELECT p.* FROM pos_bundles p JOIN pos_projects e ON e.id=p.project_id WHERE e.admin_id=${adminId} ORDER BY p.project_id,p.id`).rows;
  const sales = (await sql`SELECT p.* FROM pos_sales p JOIN pos_projects e ON e.id=p.project_id WHERE e.admin_id=${adminId} ORDER BY p.project_id,p.id`).rows;
  const links = (await sql`SELECT * FROM pos_inventory_links WHERE admin_id=${adminId} ORDER BY project_id,product_id`).rows;
  const receipts = (await sql`SELECT r.* FROM pos_sale_receipts r JOIN pos_projects e ON e.id=r.project_id WHERE e.admin_id=${adminId} ORDER BY r.project_id,r.id`).rows;
  const settlements = await available(sql,'pos_settlements') ? (await sql`SELECT * FROM pos_settlements WHERE admin_id=${adminId} ORDER BY project_id,creator`).rows : [];
  const closures = await available(sql,'pos_event_settlements') ? (await sql`SELECT * FROM pos_event_settlements WHERE admin_id=${adminId} ORDER BY project_id`).rows : [];
  const adjustments=(await sql`SELECT * FROM pos_inventory_adjustments WHERE admin_id=${adminId} ORDER BY id`).rows;
  const transfers=(await sql`SELECT * FROM pos_inventory_transfers WHERE admin_id=${adminId} ORDER BY id`).rows;
  const movements=(await sql`SELECT * FROM pos_stock_movements WHERE admin_id=${adminId} ORDER BY id`).rows;
  const numbers=(await sql`SELECT * FROM pos_inventory_numbers WHERE admin_id=${adminId}`).rows;
  const restoreReceipts=(await sql`SELECT * FROM pos_account_restores WHERE admin_id=${adminId} ORDER BY id`).rows;
  const settlementCommands=await available(sql,'pos_settlement_commands') ? (await sql`SELECT * FROM pos_settlement_commands WHERE admin_id=${adminId} ORDER BY id`).rows : [];
  const archives=(await sql`SELECT * FROM pos_event_archives WHERE project_id IN (SELECT id FROM pos_projects WHERE admin_id=${adminId}) OR snapshot->'project'->>'admin_id'=${adminId} ORDER BY project_id`).rows;
  return { projects, inventory, products, bundles, sales, links, receipts, settlements, closures, adjustments, transfers, movements, numbers, restoreReceipts, settlementCommands, archives };
}

export function foundationReport(source) {
  const issues = [];
  const names = new Set(source.inventory.map(row => nameOf(row.product.creatorName)));
  if (names.has('미지정')) issues.push({ code: 'UNASSIGNED_CREATOR' });
  for (const row of source.inventory) {
    const linked = source.links.filter(link => link.inventory_id===row.id);
    const allocations = linked.map(link => source.products.find(p=>p.project_id===link.project_id && p.id===link.product_id));
    if (allocations.some(p=>!p)) issues.push({ code:'MISSING_ALLOCATION', inventoryId:row.id });
    const remaining = Number(row.stock) + allocations.reduce((sum,p)=>sum+Number(p?.stock_qty ?? p?.stock ?? 0),0);
    if (!Number.isSafeInteger(remaining) || remaining<0) issues.push({ code:'INVALID_BALANCE', inventoryId:row.id });
    if (row.total_received==null) issues.push({ code:'ESTIMATED_RECEIPTS', inventoryId:row.id });
  }
  for (const product of source.products) if (!source.links.some(l=>l.project_id===product.project_id && l.product_id===product.id)) issues.push({code:'UNLINKED_PRODUCT',projectId:product.project_id,productId:product.id});
  return {
    version:1, fingerprint:hash(source),
    counts:Object.fromEntries(Object.entries(source).map(([key,rows])=>[key,rows.length])),
    totals:{ warehouse:source.inventory.reduce((s,r)=>s+Number(r.stock),0),
      eventRemaining:source.products.reduce((s,r)=>s+Number(r.stock_qty ?? r.stock),0),
      eventInitial:source.products.reduce((s,r)=>s+Number(r.initial_stock_qty ?? r.stock_qty ?? r.stock),0),
      sales:source.sales.reduce((s,r)=>s+Number(r.total),0),
      deductions:source.settlements.reduce((s,r)=>s+r.deductions.reduce((n,x)=>n+x.amount,0),0),
      paid:source.settlements.reduce((s,r)=>s+r.payments.reduce((n,x)=>n+x.amount,0),0) },
    closureFingerprint:hash(source.closures), issues,
    ownershipVerified:false,
  };
}

// Pure projection of legacy counters. A zero legacy opening may still have
// remaining stock/sales; preserve the same baseline used by inventoryState.
export function inventoryBalance(source,row) {
  const allocations=source.links.filter(l=>l.inventory_id===row.id).map(link=>{
    const product=source.products.find(p=>p.project_id===link.project_id && p.id===link.product_id);
    if(!product) fail('행사 재고 연결을 확인해주세요.');
    let sold=0,estimated=false;
    for(const sale of source.sales.filter(s=>s.project_id===product.project_id)) for(const line of sale.lines || []) {
      if(line.type==='product' && line.id===product.id) sold+=Number(line.qty);
      if(line.type==='bundle') {
        const components=line.subItems || source.bundles.find(b=>b.project_id===sale.project_id && b.id===line.id)?.items || [];
        if(!line.subItems) estimated=true;
        for(const item of components) if(item.productId===product.id) sold+=Number(item.qty)*Number(line.qty);
      }
    }
    const remaining=Number(product.stock_qty ?? product.stock);
    const initial=Math.max(Number(product.initial_stock_qty ?? remaining),remaining+sold);
    const loss=(source.movements || []).filter(m=>m.request.projectId===product.project_id && m.request.productId===product.id).reduce((s,m)=>s+Number(m.request.quantity),0);
    return {projectId:product.project_id,productId:product.id,initial,remaining,sold,loss,historicalDeduction:initial-remaining-sold-loss,estimated};
  });
  const unavailable=allocations.reduce((s,a)=>s+a.initial,0)+Number(source.warehouseDeductions||0);
  return {warehouse:Number(row.stock),totalStock:Number(row.stock)+unavailable,
    remaining:Number(row.stock)+allocations.reduce((s,a)=>s+a.remaining,0),unavailable,allocations};
}

export async function migrateLegacyBooth(sql, adminId, { dryRun = true, expectedFingerprint } = {}) {
  // Caller owns BEGIN/COMMIT. Lock the account before either source reads or DDL.
  if (!(await sql`SELECT id FROM pos_admins WHERE id=${adminId} AND deleted_at IS NULL FOR UPDATE`).rows.length) fail('인증이 필요합니다.',401);
  await sql`SELECT id FROM pos_projects WHERE admin_id=${adminId} ORDER BY id FOR UPDATE`;
  const source = await legacySnapshot(sql,adminId);
  const report = foundationReport(source);
  if (dryRun) return { dryRun:true, report };
  if (expectedFingerprint !== report.fingerprint) fail('이관 대상이 변경되었습니다. 미리보기를 다시 확인해주세요.');
  if (report.issues.some(issue=>issue.code==='INVALID_BALANCE' || issue.code==='MISSING_ALLOCATION')) fail('재고 불일치를 확인한 뒤 이관해주세요.');
  await initBoothFoundation(sql);
  const boothId = id('booth',adminId);
  await sql`INSERT INTO pos_booths(id,legacy_admin_id,name) VALUES(${boothId},${adminId},'기본 부스') ON CONFLICT DO NOTHING`;
  // Re-running the migration must never reactivate revoked membership.
  await sql`INSERT INTO pos_booth_members(booth_id,user_id,role) VALUES(${boothId},${adminId},'owner') ON CONFLICT DO NOTHING`;
  await reconcileBoothFoundation(sql,adminId,source);
  const after = foundationReport(await legacySnapshot(sql,adminId));
  if (after.fingerprint!==report.fingerprint) fail('이관 중 원본 데이터가 변경되었습니다.');
  await sql`INSERT INTO pos_booth_migrations(booth_id,source_fingerprint,source_snapshot,report)
    VALUES(${boothId},${report.fingerprint},${JSON.stringify(source)}::jsonb,${JSON.stringify(report)}::jsonb) ON CONFLICT DO NOTHING`;
  return { dryRun:false, boothId, report:after };
}

export async function migratedBooth(sql, adminId) {
  if (!await available(sql,'pos_booths')) return null;
  return (await sql`SELECT * FROM pos_booths WHERE legacy_admin_id=${adminId}`).rows[0] || null;
}

export async function reconcileBoothFoundation(sql, adminId, snapshot) {
  const booth = await migratedBooth(sql,adminId);
  if (!booth) return null;
  const source = snapshot || await legacySnapshot(sql,adminId);
  const ownerFor = async creator => {
    const key = nameOf(creator), ownerId=id('owner',booth.id,key);
    // A name is a candidate only, never proof of ownership or a linked identity.
    await sql`INSERT INTO pos_stock_owners(id,kind,display_name,origin_booth_id,legacy_key)
      VALUES(${ownerId},'unverified',${key},${booth.id},${key}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${booth.id},${ownerId},'proxy') ON CONFLICT DO NOTHING`;
    return ownerId;
  };
  for (const row of source.inventory) {
    const existing=(await sql`SELECT owner_id FROM pos_inventory_owners WHERE admin_id=${adminId} AND inventory_id=${row.id}`).rows[0];
    const ownerId=existing?.owner_id || await ownerFor(row.product.creatorName);
    await sql`INSERT INTO pos_inventory_owners(admin_id,inventory_id,owner_id) VALUES(${adminId},${row.id},${ownerId}) ON CONFLICT DO NOTHING`;
    const opening={...inventoryBalance(source,row),totalReceived:row.total_received,estimated:row.total_estimated};
    await sql`INSERT INTO pos_inventory_openings(admin_id,inventory_id,snapshot,fingerprint) VALUES(${adminId},${row.id},${JSON.stringify(opening)}::jsonb,${hash(opening)}) ON CONFLICT DO NOTHING`;
  }
  for (const event of source.projects) {
    await sql`INSERT INTO pos_event_booths(project_id,booth_id) VALUES(${event.id},${booth.id}) ON CONFLICT DO NOTHING`;
    const names=new Set();
    const known=(await sql`SELECT i.product_id,r.legacy_creator FROM pos_event_product_identities i JOIN pos_recipients r ON r.id=i.recipient_id WHERE i.project_id=${event.id}`).rows;
    for (const product of source.products.filter(p=>p.project_id===event.id)) names.add(known.find(row=>row.product_id===product.id)?.legacy_creator || nameOf(product.creator_name));
    for (const sale of source.sales.filter(s=>s.project_id===event.id)) for(const line of sale.lines || []) {
      if(line.type==='product') names.add(nameOf(line.settlementCreator ?? line.creatorName));
      for(const item of line.subItems || []) names.add(nameOf(item.settlementCreator ?? item.creatorName));
    }
    for(const row of source.settlements.filter(s=>s.project_id===event.id)) names.add(row.creator);
    for(const closure of source.closures.filter(s=>s.project_id===event.id)) for(const row of closure.snapshot?.rows || []) names.add(row.creator);
    for(const creator of names) {
      const existingRecipient=(await sql`SELECT id FROM pos_recipients WHERE booth_id=${booth.id} AND legacy_creator=${creator}`).rows[0];
      if(existingRecipient) {
        await sql`INSERT INTO pos_event_recipients(project_id,legacy_creator,recipient_id) VALUES(${event.id},${creator},${existingRecipient.id}) ON CONFLICT DO NOTHING`;
        continue;
      }
      const ownerId=await ownerFor(creator), recipientId=id('recipient',booth.id,creator);
      await sql`INSERT INTO pos_recipients(id,booth_id,legacy_creator,display_name,owner_id) VALUES(${recipientId},${booth.id},${creator},${creator},${ownerId}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO pos_event_recipients(project_id,legacy_creator,recipient_id) VALUES(${event.id},${creator},${recipientId}) ON CONFLICT DO NOTHING`;
    }
    for(const product of source.products.filter(p=>p.project_id===event.id)) {
      if(known.some(row=>row.product_id===product.id))continue;
      const link=source.links.find(l=>l.project_id===event.id && l.product_id===product.id);
      const ref=link?(await sql`SELECT owner_id FROM pos_inventory_owners WHERE admin_id=${adminId} AND inventory_id=${link.inventory_id}`).rows[0]:null;
      const ownerId=ref?.owner_id || await ownerFor(product.creator_name);
      // The inventory owner is stable across display-name changes. Use that
      // owner's original recipient instead of creating a new payment identity.
      const owner=(await sql`SELECT legacy_key FROM pos_stock_owners WHERE id=${ownerId}`).rows[0];
      const creator=owner.legacy_key, recipientId=id('recipient',booth.id,creator);
      await sql`INSERT INTO pos_recipients(id,booth_id,legacy_creator,display_name,owner_id) VALUES(${recipientId},${booth.id},${creator},${creator},${ownerId}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO pos_event_recipients(project_id,legacy_creator,recipient_id) VALUES(${event.id},${creator},${recipientId}) ON CONFLICT DO NOTHING`;
      await sql`INSERT INTO pos_event_product_identities(project_id,product_id,owner_id,recipient_id,resolution)
        VALUES(${event.id},${product.id},${ownerId},${recipientId},${ref?'inventory':'legacy_unlinked'}) ON CONFLICT DO NOTHING`;
    }
  }
  for(const sale of source.sales) await sql`INSERT INTO pos_booth_sale_history(project_id,sale_id,snapshot)
    VALUES(${sale.project_id},${sale.id},${JSON.stringify(sale)}::jsonb) ON CONFLICT DO NOTHING`;
  for(const receipt of source.receipts.filter(r=>r.voided)) await sql`INSERT INTO pos_booth_sale_history(project_id,sale_id,voided)
    VALUES(${receipt.project_id},${receipt.id},TRUE) ON CONFLICT(project_id,sale_id) DO UPDATE SET voided=TRUE`;
  return booth;
}

export async function productIdentity(sql,projectId,productId,boothId) {
  const row=(await sql`SELECT i.owner_id,i.recipient_id,r.legacy_creator
    FROM pos_event_product_identities i JOIN pos_recipients r ON r.id=i.recipient_id AND r.booth_id=${boothId}
    WHERE i.project_id=${projectId} AND i.product_id=${productId}`).rows[0];
  if(!row) fail('상품 소유자와 수취인 연결을 확인해주세요.');
  return {ownerId:row.owner_id,recipientId:row.recipient_id,creatorName:row.legacy_creator,settlementCreator:row.legacy_creator};
}

export async function decorateEventProducts(sql,adminId,projectId,products) {
  if(!await migratedBooth(sql,adminId)) return products;
  const mappings=(await sql`SELECT i.product_id,i.owner_id,i.recipient_id,r.legacy_creator,o.display_name,o.linked_user_id,u.nickname
    FROM pos_event_product_identities i JOIN pos_recipients r ON r.id=i.recipient_id JOIN pos_stock_owners o ON o.id=i.owner_id LEFT JOIN pos_admins u ON u.id=o.linked_user_id AND u.deleted_at IS NULL
    WHERE i.project_id=${projectId}`).rows;
  return products.map(product=>{const row=mappings.find(m=>m.product_id===product.id);return row?{...product,
    ownerId:row.owner_id,recipientId:row.recipient_id,settlementCreator:row.legacy_creator,eventCreator:row.display_name==='미지정'&&!row.linked_user_id?null:{ownerId:row.owner_id,name:row.display_name==='미지정'?(row.nickname||row.linked_user_id):row.display_name,linked:Boolean(row.linked_user_id)}}:product;});
}

const roles = {
  read:['owner','manager','seller','viewer'], sell:['owner','manager','seller'],
  manage:['owner','manager'], owner:['owner'],
};
export async function authorizeBooth(sql, userId, boothId, capability='read') {
  if (!roles[capability]) fail('허용되지 않은 권한입니다.',403);
  if(!await available(sql,'pos_booths')) fail('부스에 접근할 수 없습니다.',404);
  // Lock all authentication principals before shared resources. The legacy
  // custodian lock serializes old and new API clients on the same stock.
  const booth=(await sql`SELECT * FROM pos_booths WHERE id=${boothId}`).rows[0];
  if(!booth) fail('부스에 접근할 수 없습니다.',404);
  await sql`SELECT id FROM pos_admins WHERE id IN (${userId},${booth.legacy_admin_id}) ORDER BY id FOR UPDATE`;
  const active=(await sql`SELECT id FROM pos_admins WHERE id=${userId} AND deleted_at IS NULL`).rows[0];
  const member=(await sql`SELECT role FROM pos_booth_members WHERE booth_id=${boothId} AND user_id=${userId} AND status='active' FOR UPDATE`).rows[0];
  if(!active || !member || !roles[capability].includes(member.role)) fail('부스 작업 권한이 없습니다.',403);
  const current=(await sql`SELECT * FROM pos_booths WHERE id=${boothId} FOR UPDATE`).rows[0];
  if(current.status!=='active' && capability!=='read') fail('종료된 부스입니다.');
  return {...current,role:member.role};
}

export async function authorizeOwnerStock(sql,userId,ownerId,boothId) {
  // Owners may access their stock without a booth; booth operators need an
  // active/proxy participation relation. Never expose another booth's rows.
  if(!boothId) {
    await sql`SELECT id FROM pos_admins WHERE id=${userId} AND deleted_at IS NULL FOR UPDATE`;
    const row=(await sql`SELECT m.owner_id FROM pos_owner_members m JOIN pos_admins a ON a.id=m.user_id
      WHERE m.owner_id=${ownerId} AND m.user_id=${userId} AND a.deleted_at IS NULL`).rows[0];
    if(!row) fail('재고 관리 권한이 없습니다.',403);
    return;
  }
  await authorizeBooth(sql,userId,boothId,'manage');
  const row=(await sql`SELECT owner_id FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${ownerId} AND status IN ('active','proxy') FOR UPDATE`).rows[0];
  if(!row) fail('참여 제작자의 재고가 아닙니다.',403);
}

export async function adjustOwnerStock(sql,userId,payload) {
  const {ownerId,inventoryId,boothId,requestId,version,totalStock,reason='correction'}=payload;
  if(typeof ownerId!=='string' || typeof inventoryId!=='string' || typeof requestId!=='string' || !/^[a-f0-9-]{36}$/i.test(requestId)
    || !Number.isSafeInteger(version) || version<0 || !Number.isSafeInteger(totalStock) || totalStock<0 || totalStock>2147483647
    || !['receipt','correction'].includes(reason)) fail('재고 수정 요청을 확인해주세요.',400);
  const ref=(await sql`SELECT admin_id FROM pos_inventory_owners WHERE owner_id=${ownerId} AND inventory_id=${inventoryId}`).rows;
  // Legacy IDs are only unique within an account. Ambiguous IDs are not guessed.
  if(ref.length!==1) fail('소유자 상품을 찾을 수 없거나 식별자가 중복됩니다.',404);
  const adminId=ref[0].admin_id;
  const booth=boothId?(await sql`SELECT legacy_admin_id FROM pos_booths WHERE id=${boothId}`).rows[0]:null;
  await sql`SELECT id FROM pos_admins WHERE id IN (${userId},${adminId},${booth?.legacy_admin_id || adminId}) ORDER BY id FOR UPDATE`;
  await authorizeOwnerStock(sql,userId,ownerId,boothId);
  await initStockDelegation(sql);await assertStockDelegation(sql,userId,ownerId,boothId);
  const fingerprint=hash({actorId:userId,ownerId,inventoryId,boothId:boothId || null,version,totalStock,reason});
  const prior=(await sql`SELECT fingerprint,result FROM pos_owner_commands WHERE owner_id=${ownerId} AND request_id=${requestId}`).rows[0];
  if(prior){if(prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.');return prior.result;}
  await sql`SELECT id FROM pos_projects WHERE admin_id=${adminId} ORDER BY id FOR UPDATE`;
  const item=(await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} AND id=${inventoryId} FOR UPDATE`).rows[0];
  if(!item || item.product.removedAt) fail('제거된 재고는 수정할 수 없습니다.');
  if(item.version!==version) fail('재고가 변경되었습니다. 새로고침해주세요.');
  const balance=inventoryBalance(await sharedInventorySource(sql,item),item);
  const allocated=balance.unavailable;
  const before=Number(item.stock)+allocated, delta=totalStock-before;
  if(totalStock<allocated || (reason==='receipt' && delta<0)) fail('판매·배정된 수량보다 총재고를 줄일 수 없습니다.',400);
  const received=Number(item.total_received ?? before)+(reason==='receipt'?Math.max(0,delta):0);
  const remaining=balance.remaining+delta;
  if(remaining>received) fail('추가 수량은 입고로 기록해주세요.',400);
  await sql`UPDATE pos_inventory SET stock=${totalStock-allocated},total_received=${received},version=version+1 WHERE admin_id=${adminId} AND id=${inventoryId}`;
  if(delta) await sql`INSERT INTO pos_inventory_adjustments(admin_id,inventory_id,id,delta,reason) VALUES(${adminId},${inventoryId},${requestId},${delta},${reason})`;
  const result={ownerId,inventoryId,version:version+1,totalStock,warehouse:totalStock-allocated,
    change:{before,after:totalStock,delta,reason,actorId:userId,boothId:boothId || null}};
  await sql`INSERT INTO pos_owner_commands(owner_id,request_id,actor_id,booth_id,fingerprint,result)
    VALUES(${ownerId},${requestId},${userId},${boothId || null},${fingerprint},${JSON.stringify(result)}::jsonb)`;
  return result;
}

export async function ownerStockView(sql,userId,ownerId,boothId) {
  await authorizeOwnerStock(sql,userId,ownerId,boothId);
  const items=(await sql`SELECT i.*
    FROM pos_inventory_owners o JOIN pos_inventory i ON i.admin_id=o.admin_id AND i.id=o.inventory_id
    WHERE o.owner_id=${ownerId} ORDER BY i.admin_id,i.id`).rows;
  return {ownerId,inventory:await Promise.all(items.map(async row=>{const balance=inventoryBalance(await sharedInventorySource(sql,row),row);return {inventoryId:row.id,name:row.product.name,version:row.version,
    warehouse:balance.warehouse,totalStock:balance.totalStock,unavailable:balance.unavailable,totalReceived:row.total_received};}))};
}

export async function sharedInventorySource(sql,row) {
  const links=(await sql`SELECT * FROM pos_inventory_links WHERE admin_id=${row.admin_id} AND inventory_id=${row.id}`).rows;
  const products=(await sql`SELECT p.* FROM pos_products p JOIN pos_inventory_links l ON l.project_id=p.project_id AND l.product_id=p.id WHERE l.admin_id=${row.admin_id} AND l.inventory_id=${row.id}`).rows;
  const sales=(await sql`SELECT s.* FROM pos_sales s WHERE s.project_id IN (SELECT project_id FROM pos_inventory_links WHERE admin_id=${row.admin_id} AND inventory_id=${row.id})`).rows;
  const bundles=(await sql`SELECT b.* FROM pos_bundles b WHERE b.project_id IN (SELECT project_id FROM pos_inventory_links WHERE admin_id=${row.admin_id} AND inventory_id=${row.id})`).rows;
  const movements=(await sql`SELECT m.* FROM pos_stock_movements m WHERE m.request->>'projectId' IN (SELECT project_id FROM pos_inventory_links WHERE admin_id=${row.admin_id} AND inventory_id=${row.id})
    OR (m.admin_id=${row.admin_id} AND m.request->>'inventoryId'=${row.id} AND m.request->>'projectId' IS NULL)`).rows;
  const warehouseDeductions=movements.filter(m=>!m.request.projectId).reduce((sum,m)=>sum+Number(m.request.quantity||0),0);
  return {links,products,sales,bundles,movements,warehouseDeductions};
}

export async function resolveRecipient(sql, projectId, recipientId) {
  const row=(await sql`SELECT legacy_creator,recipient_id FROM pos_event_recipients WHERE project_id=${projectId} AND recipient_id=${recipientId}`).rows[0];
  if(!row) fail('행사 정산 수취인을 찾을 수 없습니다.',404);
  return row;
}

export async function authorizeOriginalProduct(sql,userId,adminId,inventoryId,boothId) {
  const row=(await sql`SELECT o.owner_id,s.origin_booth_id,s.link_status AS status FROM pos_inventory_owners o
    JOIN pos_stock_owners s ON s.id=o.owner_id
    WHERE o.admin_id=${adminId} AND o.inventory_id=${inventoryId}`).rows[0];
  if(!row) fail('상품 소유자 연결을 확인해주세요.');
  if((await sql`SELECT owner_id FROM pos_owner_members WHERE owner_id=${row.owner_id} AND user_id=${userId}`).rows.length) return;
  const proxy=(await sql`SELECT owner_id FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${row.owner_id} AND status='proxy'`).rows.length;
  if(row.status==='unlinked' && row.origin_booth_id===boothId && proxy) return;
  fail('제작자 상품 정보의 수정 권한이 없습니다.',403);
}

export const legacyStockActions=['saveInventory','createEventProduct','importInventory','transferInventory','recordStockMovement'];

export async function guardLegacyStock(sql,userId,booth,action,payload,source) {
  const inventoryId=payload.inventoryId || (action==='saveInventory'?payload.product?.id:null);
  const item=source?.inventory.find(row=>row.id===inventoryId);
  if(!item) return;
  const ref=(await sql`SELECT owner_id FROM pos_inventory_owners WHERE admin_id=${booth.legacy_admin_id} AND inventory_id=${inventoryId}`).rows[0];
  if(!ref) fail('재고 소유자 연결을 확인해주세요.');
  let needsActive=action==='transferInventory' && payload.direction==='allocate'
    || action==='recordStockMovement' && !payload.projectId;
  if(action==='saveInventory') {
    const before=inventoryBalance(source,item);
    needsActive=payload.allocationPlan ? payload.allocationPlan.totalStock!==before.totalStock
      || (payload.allocationPlan.allocations || []).some(row=>row.quantity>(before.allocations.find(a=>a.projectId===row.projectId && a.productId===row.productId)?.initial || 0))
      : Number(payload.product?.stock)!==Number(item.stock);
  }
  if(needsActive)await authorizeOwnerStock(sql,userId,ref.owner_id,booth.id);
  const quantityWrite=needsActive||action==='transferInventory'||action==='recordStockMovement'||action==='saveInventory'&&Boolean(payload.allocationPlan);
  if(quantityWrite){await initStockDelegation(sql);await assertStockDelegation(sql,userId,ref.owner_id,booth.id,!needsActive);}
}

export async function recordLegacyStockChanges(sql,userId,booth,action,before,after) {
  for(const item of after.inventory) {
    const previous=before.inventory.find(row=>row.id===item.id);
    const from=previous?inventoryBalance(before,previous):{warehouse:0,totalStock:0,remaining:0,unavailable:0,allocations:[]};
    const to=inventoryBalance(after,item);
    if(hash(from)===hash(to)) continue;
    const ref=(await sql`SELECT owner_id FROM pos_inventory_owners WHERE admin_id=${booth.legacy_admin_id} AND inventory_id=${item.id}`).rows[0];
    const result={ownerId:ref.owner_id,inventoryId:item.id,action,change:{actorId:userId,boothId:booth.id,before:from,after:to}};
    await sql`INSERT INTO pos_owner_commands(owner_id,request_id,actor_id,booth_id,fingerprint,result)
      VALUES(${ref.owner_id},${'legacy:'+randomUUID()},${userId},${booth.id},${hash(result)},${JSON.stringify(result)}::jsonb)`;
  }
}

export async function imageScope(sql,userId,{boothId,inventoryId,projectId,productId,ownerId}) {
  if(ownerId&&inventoryId&&!projectId&&!productId) {
    await authorizeOwnerStock(sql,userId,ownerId,boothId);
    const refs=(await sql`SELECT admin_id FROM pos_inventory_owners WHERE owner_id=${ownerId} AND inventory_id=${inventoryId}`).rows;
    if(refs.length!==1)fail('상품 소유자를 확인해주세요.',404);
    await authorizeOriginalProduct(sql,userId,refs[0].admin_id,inventoryId,boothId);
    return refs[0].admin_id;
  }
  const original=await migratedBooth(sql,userId);
  if(!boothId && !original) return userId;
  const booth=await authorizeBooth(sql,userId,boothId || original.id,'manage');
  let sourceId=inventoryId;
  if(projectId) {
    if(!(await sql`SELECT project_id FROM pos_event_booths WHERE booth_id=${booth.id} AND project_id=${projectId}`).rows.length) fail('부스의 행사가 아닙니다.',404);
    sourceId=(await sql`SELECT inventory_id FROM pos_inventory_links WHERE admin_id=${booth.legacy_admin_id} AND project_id=${projectId} AND product_id=${productId}`).rows[0]?.inventory_id;
  }
  if(sourceId) await authorizeOriginalProduct(sql,userId,booth.legacy_admin_id,sourceId,booth.id);
  else if(userId!==booth.legacy_admin_id) fail('상품 소유자 연결을 확인해주세요.');
  return booth.legacy_admin_id;
}

export async function recipientMap(sql,adminId) {
  if(!await migratedBooth(sql,adminId)) return [];
  return (await sql`SELECT r.* FROM pos_event_recipients r JOIN pos_projects p ON p.id=r.project_id WHERE p.admin_id=${adminId} ORDER BY r.project_id,r.legacy_creator`).rows;
}

export async function foundationBackup(sql,adminId) {
  const booth=await migratedBooth(sql,adminId);
  if(!booth) {
    if(!await available(sql,'pos_shared_stock_items'))return null;
    const shared=(await sql`SELECT * FROM pos_shared_stock_items WHERE admin_id=${adminId} ORDER BY id`).rows;
    if(!shared.length)return null;
    return {version:2,boothId:null,tables:{pos_shared_stock_items:shared,
      pos_inventory_owners:(await sql`SELECT * FROM pos_inventory_owners WHERE admin_id=${adminId} ORDER BY inventory_id`).rows,
      pos_owner_members:(await sql`SELECT * FROM pos_owner_members WHERE user_id=${adminId} ORDER BY owner_id`).rows,
      pos_stock_owners:(await sql`SELECT o.* FROM pos_stock_owners o JOIN pos_owner_members m ON m.owner_id=o.id WHERE m.user_id=${adminId} ORDER BY o.id`).rows,
      pos_shared_stock_commands:(await sql`SELECT c.* FROM pos_shared_stock_commands c JOIN pos_owner_members m ON m.owner_id=c.owner_id WHERE m.user_id=${adminId} ORDER BY c.created_at,c.id`).rows}};
  }
  const tables={pos_booths:[booth]};
  tables.pos_booth_members=(await sql`SELECT * FROM pos_booth_members WHERE booth_id=${booth.id} ORDER BY user_id`).rows;
  tables.pos_inventory_owners=(await sql`SELECT * FROM pos_inventory_owners WHERE admin_id=${adminId} ORDER BY inventory_id`).rows;
  tables.pos_stock_owners=(await sql`SELECT * FROM pos_stock_owners WHERE origin_booth_id=${booth.id} OR id IN (SELECT owner_id FROM pos_booth_artists WHERE booth_id=${booth.id}) ORDER BY id`).rows;
  tables.pos_owner_members=(await sql`SELECT p.* FROM pos_owner_members p JOIN pos_stock_owners o ON o.id=p.owner_id WHERE o.origin_booth_id=${booth.id} OR o.id IN (SELECT owner_id FROM pos_booth_artists WHERE booth_id=${booth.id}) ORDER BY p.owner_id,p.user_id`).rows;
  tables.pos_booth_artists=(await sql`SELECT * FROM pos_booth_artists WHERE booth_id=${booth.id} ORDER BY owner_id`).rows;
  tables.pos_event_booths=(await sql`SELECT * FROM pos_event_booths WHERE booth_id=${booth.id} ORDER BY project_id`).rows;
  tables.pos_recipients=(await sql`SELECT * FROM pos_recipients WHERE booth_id=${booth.id} ORDER BY id`).rows;
  tables.pos_event_recipients=await recipientMap(sql,adminId);
  tables.pos_event_product_identities=(await sql`SELECT i.* FROM pos_event_product_identities i JOIN pos_event_booths e ON e.project_id=i.project_id WHERE e.booth_id=${booth.id} ORDER BY i.project_id,i.product_id`).rows;
  tables.pos_inventory_openings=(await sql`SELECT * FROM pos_inventory_openings WHERE admin_id=${adminId} ORDER BY inventory_id`).rows;
  tables.pos_booth_migrations=(await sql`SELECT * FROM pos_booth_migrations WHERE booth_id=${booth.id}`).rows;
  tables.pos_booth_sale_history=(await sql`SELECT h.* FROM pos_booth_sale_history h JOIN pos_event_booths e ON e.project_id=h.project_id WHERE e.booth_id=${booth.id} ORDER BY h.project_id,h.sale_id`).rows;
  // Only commands issued in this booth; cross-booth audit rows are not exported.
  tables.pos_owner_commands=(await sql`SELECT * FROM pos_owner_commands WHERE booth_id=${booth.id} ORDER BY owner_id,request_id`).rows;
  if(await available(sql,'pos_artist_invitations')) {
    // Backups keep linking provenance, never a reusable invitation secret/hash.
    tables.pos_artist_invitations=(await sql`SELECT id,owner_id,booth_id,issued_by,expires_at,created_at,revoked_at,accepted_by,accepted_at FROM pos_artist_invitations WHERE booth_id=${booth.id} ORDER BY id`).rows;
    tables.pos_artist_link_audit=(await sql`SELECT * FROM pos_artist_link_audit WHERE booth_id=${booth.id} ORDER BY created_at,id`).rows;
  }
  if(await available(sql,'pos_shared_stock_commands')) {
    tables.pos_event_stock_policy=(await sql`SELECT p.* FROM pos_event_stock_policy p JOIN pos_event_booths b ON b.project_id=p.project_id WHERE b.booth_id=${booth.id} ORDER BY p.project_id`).rows;
    const projects=new Set(tables.pos_event_booths.map(e=>e.project_id));
    const commands=(await sql`SELECT c.* FROM pos_shared_stock_commands c WHERE c.booth_id=${booth.id} OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(COALESCE(c.result->'changes','[]'::jsonb)) change
      JOIN pos_event_booths e ON e.project_id=change->>'projectId' WHERE e.booth_id=${booth.id}) ORDER BY c.created_at,c.id`).rows;
    tables.pos_shared_stock_commands=commands.map(command=>{
      const result={...command.result};
      if(result.inventory)result.inventory={...result.inventory,allocations:(result.inventory.allocations||[]).filter(a=>projects.has(a.projectId))};
      if(result.changes)result.changes=result.changes.filter(c=>projects.has(c.projectId));
      return {...command,booth_id:command.booth_id===booth.id?booth.id:null,project_id:projects.has(command.project_id)?command.project_id:null,result};
    });
    tables.pos_shared_stock_items=(await sql`SELECT DISTINCT s.* FROM pos_shared_stock_items s LEFT JOIN pos_inventory_links l ON l.admin_id=s.admin_id AND l.inventory_id=s.inventory_id
      LEFT JOIN pos_event_booths b ON b.project_id=l.project_id WHERE s.admin_id=${adminId} OR b.booth_id=${booth.id} ORDER BY s.id`).rows;
    tables.shared_inventory_sources=(await sql`SELECT DISTINCT i.admin_id,i.id,i.stock,i.version,i.total_received,o.owner_id,
      jsonb_build_object('name',i.product->>'name','price',i.product->'price') AS product
      FROM pos_inventory i JOIN pos_inventory_owners o ON o.admin_id=i.admin_id AND o.inventory_id=i.id
      JOIN pos_shared_stock_items s ON s.admin_id=i.admin_id AND s.inventory_id=i.id
      JOIN pos_inventory_links l ON l.admin_id=i.admin_id AND l.inventory_id=i.id JOIN pos_event_booths b ON b.project_id=l.project_id
      WHERE b.booth_id=${booth.id} ORDER BY i.admin_id,i.id`).rows;
  }
  if(await available(sql,'pos_booth_contract_policy')) {
    tables.pos_booth_contract_policy=(await sql`SELECT * FROM pos_booth_contract_policy WHERE booth_id=${booth.id}`).rows;
    tables.pos_booth_contract_commands=(await sql`SELECT * FROM pos_booth_contract_commands WHERE booth_id=${booth.id} ORDER BY created_at,id`).rows;
  }
  if(await available(sql,'pos_event_artists')) {
    tables.pos_event_artists=(await sql`SELECT a.* FROM pos_event_artists a JOIN pos_event_booths e ON e.project_id=a.project_id WHERE e.booth_id=${booth.id} ORDER BY a.project_id,a.owner_id`).rows;
    tables.pos_event_staff=(await sql`SELECT a.* FROM pos_event_staff a JOIN pos_event_booths e ON e.project_id=a.project_id WHERE e.booth_id=${booth.id} ORDER BY a.project_id,a.user_id`).rows;
    tables.pos_event_access_commands=(await sql`SELECT a.* FROM pos_event_access_commands a JOIN pos_event_booths e ON e.project_id=a.project_id WHERE e.booth_id=${booth.id} ORDER BY a.created_at,a.id`).rows;
    tables.pos_booth_management_commands=(await sql`SELECT * FROM pos_booth_management_commands WHERE booth_id=${booth.id} ORDER BY created_at,id`).rows;
  }
  return {version:1,boothId:booth.id,tables};
}

export async function decorateSharedInventory(sql,adminId,items) {
  if(!await available(sql,'pos_shared_stock_items'))return items;
  const shared=(await sql`SELECT inventory_id FROM pos_shared_stock_items WHERE admin_id=${adminId}`).rows;
  return Promise.all(items.map(async item=>{
    if(!shared.some(s=>s.inventory_id===item.id))return item;
    const row=(await sql`SELECT * FROM pos_inventory WHERE admin_id=${adminId} AND id=${item.id}`).rows[0];
    const balance=inventoryBalance(await sharedInventorySource(sql,row),row);
    return {...item,totalStock:balance.totalStock,remainingStock:balance.remaining};
  }));
}

export async function protectMigratedLifecycle(sql,adminId,action) {
  if(!['deleteAccount','restoreAccount','clearSales'].includes(action)) return;
  if(await migratedBooth(sql,adminId)) fail('부스 이력을 보존해야 하는 작업입니다. 부스 보관 또는 별도 데이터 복구 절차를 이용해주세요.');
  if(await available(sql,'pos_shared_stock_items') && (await sql`SELECT id FROM pos_shared_stock_items WHERE admin_id=${adminId} LIMIT 1`).rows.length) fail('제작자 공유 재고 이력을 보존해야 하는 작업입니다. 별도 복구 절차를 이용해주세요.');
  if(action==='deleteAccount' && await available(sql,'pos_booths')) {
    const owner=(await sql`SELECT booth_id FROM pos_booth_members WHERE user_id=${adminId} AND role='owner' AND status='active'`).rows;
    const assets=(await sql`SELECT owner_id FROM pos_owner_members WHERE user_id=${adminId}`).rows;
    if(owner.length || assets.length) fail('부스 소유권과 제작자 자산을 정리한 뒤 탈퇴해주세요.');
  }
}

export async function lockSharedStockCustodians(sql,userId,boothId,projectId) {
  if(!await available(sql,'pos_shared_stock_items'))return;
  const sources=(await sql`SELECT DISTINCT l.admin_id FROM pos_inventory_links l JOIN pos_shared_stock_items s ON s.admin_id=l.admin_id AND s.inventory_id=l.inventory_id
    JOIN pos_event_booths e ON e.project_id=l.project_id WHERE e.booth_id=${boothId} AND (${projectId||null}::text IS NULL OR l.project_id=${projectId||null})`).rows;
  const booth=(await sql`SELECT legacy_admin_id FROM pos_booths WHERE id=${boothId}`).rows[0];
  await sql`SELECT id FROM pos_admins WHERE id=ANY(${[userId,booth?.legacy_admin_id,...sources.map(s=>s.admin_id)].filter(Boolean)}::text[]) ORDER BY id FOR UPDATE`;
}

export async function guardSharedStockWrites(sql,adminId,req,userId=adminId) {
  if(req.method!=='POST')return;
  const action=req.body?.action,payload=req.body?.payload||{},projectId=req.body?.projectId||payload.projectId;
  if(action==='deleteProject'&&await available(sql,'pos_inventory_owners')){
    const owners=(await sql`SELECT DISTINCT o.owner_id,e.booth_id FROM pos_inventory_links l JOIN pos_inventory_owners o ON o.admin_id=l.admin_id AND o.inventory_id=l.inventory_id JOIN pos_event_booths e ON e.project_id=l.project_id JOIN pos_products p ON p.project_id=l.project_id AND p.id=l.product_id WHERE l.project_id=${projectId} AND COALESCE(p.stock_qty,p.stock)>0`).rows;
    for(const owner of owners)await assertStockDelegation(sql,userId,owner.owner_id,owner.booth_id,true);
    return;
  }
  if(!await available(sql,'pos_shared_stock_items'))return;
  if(['finalizeSale','voidSale'].includes(action)) {
    if(action==='voidSale')return;
    if((await sql`SELECT id FROM pos_sale_receipts WHERE project_id=${projectId} AND id=${payload.localOrderId||''}`).rows.length)return;
    const productIds=(payload.cart||[]).flatMap(line=>line.type==='product'?[line.id]:[]);
    const bundleIds=(payload.cart||[]).filter(line=>line.type==='bundle').map(line=>line.id);
    const bundles=(await sql`SELECT items FROM pos_bundles WHERE project_id=${projectId} AND id=ANY(${bundleIds}::text[])`).rows;
    productIds.push(...bundles.flatMap(b=>b.items.map(item=>item.productId)));
    const ended=(await sql`SELECT i.product_id FROM pos_event_product_identities i JOIN pos_event_booths e ON e.project_id=i.project_id
      LEFT JOIN pos_booth_artists a ON a.booth_id=e.booth_id AND a.owner_id=i.owner_id
      WHERE i.project_id=${projectId} AND i.product_id=ANY(${productIds}::text[]) AND (a.status IS NULL OR a.status NOT IN ('active','proxy'))`).rows;
    if(ended.length)fail('참여가 종료된 제작자 상품은 새로 판매할 수 없습니다.',403);
    return;
  }
  if(!['saveInventory','transferInventory','saveEventProduct','removeInventory','recordStockMovement','replaceProducts','resetDefaults'].includes(action))return;
  const inventoryId=payload.inventoryId||payload.product?.id;
  const source=inventoryId&&(await sql`SELECT s.id FROM pos_shared_stock_items s WHERE s.admin_id=${adminId}
    AND (${inventoryId||null}::text IS NULL OR s.inventory_id=${inventoryId||null}) LIMIT 1`).rows.length;
  const event=projectId&&(await sql`SELECT s.id FROM pos_shared_stock_items s JOIN pos_inventory_links l ON l.admin_id=s.admin_id AND l.inventory_id=s.inventory_id
    WHERE l.project_id=${projectId} AND (${payload.productId||null}::text IS NULL OR l.product_id=${payload.productId||null}) LIMIT 1`).rows.length;
  if(source||event)fail('공유 재고는 제작자 재고 화면에서 관리해주세요.');
}

export function boothCapability(req) {
  const action=req.body?.action;
  if(req.method==='GET' || ['listInventory','listStockMovements'].includes(action)) return action==='listInventory' || action==='listStockMovements' ? 'manage' : 'read';
  if(['finalizeSale','voidSale'].includes(action)) return 'sell';
  if(['backupAccount','restoreAccount','deleteAccount','deleteProject'].includes(action)) return 'owner';
  return 'manage';
}

export async function boothContracts(sql,boothId) {
  if(!boothId||!await available(sql,'pos_booth_contract_policy'))return {legacyWritesClosed:false,version:0};
  const row=(await sql`SELECT version,legacy_writes_closed FROM pos_booth_contract_policy WHERE booth_id=${boothId}`).rows[0];
  return {legacyWritesClosed:row?.legacy_writes_closed||false,version:row?.version||0};
}

export async function enforceBoothContract(sql,booth,req,{settlement=false}={}) {
  const policy=await boothContracts(sql,booth?.id);
  if(!policy.legacyWritesClosed||req.method!=='POST')return policy;
  if(req.body?.boothId!==booth.id)fail('구형 부스 쓰기 계약이 종료되었습니다. 부스 ID를 포함한 최신 요청이 필요합니다.',410);
  const action=req.body?.action;
  if(settlement&&['saveDeductions','addPayment','reversePayment','completeRecipientSettlement'].includes(action)) {
    if(!req.body.recipientId||Object.hasOwn(req.body,'creator'))fail('이름 기반 정산 쓰기가 종료되었습니다. 수취인 ID를 사용해주세요.',410);
  }
  if(['finalizeSale','voidSale'].includes(action)&&req.body?.protocolVersion!==2)fail('구형 주문 쓰기가 종료되었습니다. 미전송 주문 원본을 보존하고 복구 절차를 이용해주세요.',410);
  return policy;
}
