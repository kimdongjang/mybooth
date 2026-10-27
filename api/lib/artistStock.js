import {initStockDelegation,assertStockDelegation,stockDelegationAllowed} from './stockDelegation.js';
import {createHash,randomUUID} from 'node:crypto';
import {authorizeBooth,authorizeOwnerStock,inventoryBalance,sharedInventorySource} from './boothFoundation.js';
import {initArtistLinking,createBoothArtist,createArtistProfile} from './artistLinking.js';
import {eventPermissions,authorizeEvent} from './eventAccess.js';

const fail=(message,status=409)=>{throw Object.assign(new Error(message),{status});};
const integer=(n,min=0)=>Number.isSafeInteger(n)&&n>=min&&n<=2147483647;
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const stockId=row=>'stock:'+hash([row.admin_id,row.id]);
const validId=v=>typeof v==='string'&&v.length>0&&v.length<=200;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);

export async function initArtistStock(sql) {
  await initArtistLinking(sql);await initStockDelegation(sql);
  if((await sql`SELECT to_regclass('pos_shared_stock_commands') AS name`).rows[0]?.name)return;
  await sql`CREATE TABLE IF NOT EXISTS pos_shared_stock_items (
    id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,inventory_id TEXT NOT NULL,UNIQUE(admin_id,inventory_id),
    FOREIGN KEY(admin_id,inventory_id) REFERENCES pos_inventory(admin_id,id))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_event_stock_policy (
    project_id TEXT PRIMARY KEY REFERENCES pos_projects(id),starts_on DATE NOT NULL,ends_on DATE NOT NULL,
    CHECK(ends_on>=starts_on))`;
  await sql`CREATE TABLE IF NOT EXISTS pos_shared_stock_commands (
    id TEXT PRIMARY KEY,actor_id TEXT NOT NULL REFERENCES pos_admins(id),owner_id TEXT REFERENCES pos_stock_owners(id),
    booth_id TEXT REFERENCES pos_booths(id),project_id TEXT REFERENCES pos_projects(id),
    fingerprint TEXT NOT NULL,result JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
}

async function itemFor(sql,ownerId,id) {
  const items=(await sql`SELECT i.* FROM pos_inventory i JOIN pos_inventory_owners o ON o.admin_id=i.admin_id AND o.inventory_id=i.id WHERE o.owner_id=${ownerId}`).rows;
  const row=items.find(i=>stockId(i)===id);
  if(!row)fail('제작자 재고를 찾을 수 없습니다.',404);
  return row;
}

async function ownerAccess(sql,userId,ownerId,boothId) {
  const owner=(await sql`SELECT o.*,p.linked_user_id FROM pos_stock_owners o JOIN pos_artist_profiles p ON p.owner_id=o.id WHERE o.id=${ownerId}`).rows[0];
  if(!owner)fail('제작자를 찾을 수 없습니다.',404);
  const own=(await sql`SELECT owner_id FROM pos_owner_members WHERE user_id=${userId} AND owner_id=${ownerId}`).rows.length>0;
  if(!own&&!boothId)fail('제작자 재고 관리 권한이 없습니다.',403);
  return {owner,own};
}

async function lockScope(sql,userId,ownerId,boothId,item,projectIds=[],allowEnding=false,quantityWrite=true) {
  if(item?.product?.removedAt)fail('제거된 재고는 변경할 수 없습니다.');
  const {owner,own}=await ownerAccess(sql,userId,ownerId,boothId);
  const booth=boothId?(await sql`SELECT * FROM pos_booths WHERE id=${boothId}`).rows[0]:null;
  const events=projectIds.length?(await sql`SELECT admin_id FROM pos_projects WHERE id=ANY(${projectIds}::text[])`).rows:[];
  const admins=[userId,item?.admin_id,booth?.legacy_admin_id,owner.linked_user_id,...events.map(e=>e.admin_id)].filter(Boolean);
  // The canonical inventory custodian participates in every event sale lock.
  await sql`SELECT id FROM pos_admins WHERE id=ANY(${admins}::text[]) ORDER BY id FOR UPDATE`;
  if(own) {
    await authorizeOwnerStock(sql,userId,ownerId);
    if(boothId) {
      const relation=(await sql`SELECT status FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${ownerId} FOR UPDATE`).rows[0];
      if(!relation||!['active','proxy',...(allowEnding?['ending','ended']:[])].includes(relation.status))fail('참여 제작자의 재고가 아닙니다.',403);
    }
  }
  else if(allowEnding) {
    await authorizeBooth(sql,userId,boothId,'manage');
    if(!(await sql`SELECT owner_id FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${ownerId} AND status IN ('active','proxy','ending') FOR UPDATE`).rows.length)fail('참여 제작자의 재고가 아닙니다.',403);
  } else if(projectIds.length&&(await sql`SELECT to_regclass('pos_event_staff') AS name`).rows[0]?.name) {
    for(const projectId of projectIds)await authorizeEvent(sql,userId,projectId,'configure',boothId);
    if(!(await sql`SELECT owner_id FROM pos_booth_artists WHERE owner_id=${ownerId} AND booth_id=${boothId} AND status IN ('active','proxy')`).rows.length)fail('참여 제작자의 재고가 아닙니다.',403);
  } else await authorizeOwnerStock(sql,userId,ownerId,boothId);
  if(quantityWrite&&!own)await assertStockDelegation(sql,userId,ownerId,boothId,allowEnding);
  if(projectIds.length) await sql`SELECT id FROM pos_projects WHERE id=ANY(${projectIds}::text[]) ORDER BY id FOR UPDATE`;
  await sql`SELECT id FROM pos_stock_owners WHERE id=${ownerId} FOR UPDATE`;
  if(item)await sql`SELECT id FROM pos_inventory WHERE admin_id=${item.admin_id} AND id=${item.id} FOR UPDATE`;
  return {owner,own,booth};
}

async function eventAccess(sql,userId,ownerId,projectId,boothId,{returning=false}={}) {
  await sql`SELECT b.id FROM pos_booths b JOIN pos_event_booths e ON e.booth_id=b.id WHERE e.project_id=${projectId} FOR UPDATE OF b`;
  await sql`SELECT a.owner_id FROM pos_booth_artists a JOIN pos_event_booths e ON e.booth_id=a.booth_id WHERE e.project_id=${projectId} AND a.owner_id=${ownerId} FOR UPDATE OF a`;
  await sql`SELECT project_id FROM pos_event_stock_policy WHERE project_id=${projectId} FOR UPDATE`;
  const row=(await sql`SELECT e.*,b.id AS booth_id,b.status AS booth_status,
    m.role,m.status AS member_status,a.status AS participation,
    p.starts_on::text,p.ends_on::text,
    (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date BETWEEN p.starts_on AND p.ends_on AS event_day,
    (SELECT closed_at FROM pos_event_settlements WHERE project_id=e.id) AS closed_at
    FROM pos_projects e JOIN pos_event_booths eb ON eb.project_id=e.id JOIN pos_booths b ON b.id=eb.booth_id
    LEFT JOIN pos_booth_members m ON m.booth_id=b.id AND m.user_id=${userId}
    LEFT JOIN pos_booth_artists a ON a.booth_id=b.id AND a.owner_id=${ownerId}
    LEFT JOIN pos_event_stock_policy p ON p.project_id=e.id WHERE e.id=${projectId} AND e.deleted_at IS NULL`).rows[0];
  if(!row||(boothId&&boothId!==row.booth_id))fail('행사를 찾을 수 없습니다.',404);
  let operator=row.member_status==='active'&&['owner','manager'].includes(row.role);
  if((await sql`SELECT to_regclass('pos_event_artists') AS name`).rows[0]?.name) {
    const event=await eventPermissions(sql,userId,projectId);operator=event.permissions.canConfigure;
    const participating=(await sql`SELECT owner_id FROM pos_event_artists WHERE project_id=${projectId} AND owner_id=${ownerId} AND status='active'`).rows.length;
    const originalStock=operator&&(await sql`SELECT l.product_id FROM pos_inventory_links l JOIN pos_inventory_owners o ON o.admin_id=l.admin_id AND o.inventory_id=l.inventory_id WHERE l.project_id=${projectId} AND o.owner_id=${ownerId} LIMIT 1`).rows.length;
    if(!participating&&!originalStock)fail('이번 행사에 참여하지 않은 제작자입니다.',403);
  }
  if(!operator) {
    const own=(await sql`SELECT owner_id FROM pos_owner_members WHERE owner_id=${ownerId} AND user_id=${userId}`).rows.length;
    if(!own)fail('행사 재고 관리 권한이 없습니다.',403);
    if(!row.starts_on||row.event_day)fail('행사 기간 또는 일정 미설정 행사에서는 운영자만 재고를 관리할 수 있습니다.',403);
  }
  if(!['active','proxy',...(returning?['ending']:[])].includes(row.participation))fail('참여 제작자의 재고가 아닙니다.',403);
  if(row.booth_status!=='active'||row.closed_at||(!returning&&row.archived_at))fail('종료·보관·정산 마감 상태를 확인해주세요.');
  return row;
}

async function replay(sql,userId,action,payload) {
  if(!uuid(payload.requestId))fail('요청 ID를 확인해주세요.',400);
  const fingerprint=hash({userId,action,payload});
  const prior=(await sql`SELECT * FROM pos_shared_stock_commands WHERE id=${payload.requestId}`).rows[0];
  if(prior&&(prior.actor_id!==userId||prior.fingerprint!==fingerprint))fail('같은 요청 ID의 내용이 다릅니다.');
  return {fingerprint,result:prior?.result};
}
async function receipt(sql,userId,action,payload,fingerprint,result) {
  const value={action,...result};
  const projectBooth=payload.projectId?(await sql`SELECT booth_id FROM pos_event_booths WHERE project_id=${payload.projectId}`).rows[0]?.booth_id:null;
  await sql`INSERT INTO pos_shared_stock_commands(id,actor_id,owner_id,booth_id,project_id,fingerprint,result)
    VALUES(${payload.requestId},${userId},${payload.ownerId||null},${payload.boothId||projectBooth||null},${payload.projectId||null},${fingerprint},${JSON.stringify(value)}::jsonb)`;
  return value;
}
async function activate(sql,item) {
  await sql`INSERT INTO pos_shared_stock_items(id,admin_id,inventory_id) VALUES(${stockId(item)},${item.admin_id},${item.id}) ON CONFLICT DO NOTHING`;
}

async function projection(sql,item,ownerId,boothId) {
  const source=await sharedInventorySource(sql,item),balance=inventoryBalance(source,item);
  const scopes=(await sql`SELECT e.id,b.booth_id FROM pos_projects e JOIN pos_event_booths b ON b.project_id=e.id WHERE e.deleted_at IS NULL AND e.id=ANY(${source.links.map(l=>l.project_id)}::text[])`).rows;
  return {...item.product,id:stockId(item),inventoryId:item.id,custodianId:item.admin_id,ownerId,name:item.product.name,price:Number(item.product.price||0),version:item.version,
    stockSummary:{sold:balance.allocations.reduce((n,a)=>n+a.sold,0),eventRemaining:balance.allocations.reduce((n,a)=>n+a.remaining,0),unallocated:balance.warehouse,other:Math.max(0,balance.totalStock-balance.warehouse-balance.allocations.reduce((n,a)=>n+a.sold+a.remaining,0))},warehouse:balance.warehouse,totalStock:balance.totalStock,minimumTotalStock:balance.unavailable,remaining:balance.remaining,totalReceived:Number(item.total_received??balance.totalStock),
    allocations:balance.allocations.filter(a=>scopes.some(s=>s.id===a.projectId&&(!boothId||s.booth_id===boothId))).map(a=>({...a,price:Number(source.products.find(p=>p.project_id===a.projectId&&p.id===a.productId)?.price||0)}))};
}

export async function artistStockView(sql,userId,{ownerId,boothId,projectId}) {
  const {own}=await ownerAccess(sql,userId,ownerId,boothId);
  if(own)await authorizeOwnerStock(sql,userId,ownerId);
  else await lockScope(sql,userId,ownerId,boothId,null,projectId?[projectId]:[],!projectId,false);
  const items=(await sql`SELECT i.* FROM pos_inventory i JOIN pos_inventory_owners o ON o.admin_id=i.admin_id AND o.inventory_id=i.id
    WHERE o.owner_id=${ownerId} ORDER BY i.id`).rows.filter(r=>!r.product.removedAt);
  const events=(await sql`SELECT e.id,e.name,e.archived_at,p.starts_on::text,p.ends_on::text,b.id AS booth_id,(SELECT closed_at FROM pos_event_settlements WHERE project_id=e.id) AS closed_at,
    (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date BETWEEN p.starts_on AND p.ends_on AS event_day,
    (m.status='active' AND m.role IN ('owner','manager')) AS operator
    FROM pos_projects e JOIN pos_event_booths eb ON eb.project_id=e.id JOIN pos_booths b ON b.id=eb.booth_id
    JOIN pos_booth_artists a ON a.booth_id=b.id AND a.owner_id=${ownerId} AND a.status IN ('active','proxy','ending')
    LEFT JOIN pos_booth_members m ON m.booth_id=b.id AND m.user_id=${userId}
    LEFT JOIN pos_event_stock_policy p ON p.project_id=e.id WHERE e.deleted_at IS NULL AND (${boothId||null}::text IS NULL OR b.id=${boothId||null}) ORDER BY e.id`).rows;
  const participations=(await sql`SELECT a.booth_id,a.status,b.name FROM pos_booth_artists a JOIN pos_booths b ON b.id=a.booth_id
    WHERE a.owner_id=${ownerId} AND (${boothId||null}::text IS NULL OR a.booth_id=${boothId||null}) ORDER BY a.booth_id`).rows;
  const commands=(await sql`SELECT id,actor_id,created_at,result FROM pos_shared_stock_commands WHERE owner_id=${ownerId}
    AND (${boothId||null}::text IS NULL OR booth_id=${boothId||null}) ORDER BY created_at DESC,id`).rows;
  const hiddenCommands=new Set(commands.flatMap(c=>c.result.commandIds||[]));
  const history=commands.filter(c=>!hiddenCommands.has(c.id)).map(c=>({id:c.id,actorId:c.actor_id,at:c.created_at,action:c.result.action,
    inventoryId:c.result.inventory?.id||c.result.id,name:c.result.inventory?.name,change:c.result.change,
    changes:(c.result.changes||[]).filter(change=>!boothId||events.some(e=>e.id===change.projectId))}));
  let visibleEvents=events;
  if((await sql`SELECT to_regclass('pos_event_artists') AS name`).rows[0]?.name) {
    visibleEvents=[];
    for(const e of events) {
      const access=await eventPermissions(sql,userId,e.id);
      const participation=(await sql`SELECT owner_id FROM pos_event_artists WHERE project_id=${e.id} AND owner_id=${ownerId} AND status='active'`).rows.length;
      const retained=access.permissions.canConfigure&&(await sql`SELECT l.product_id FROM pos_inventory_links l JOIN pos_inventory_owners o ON o.admin_id=l.admin_id AND o.inventory_id=l.inventory_id WHERE l.project_id=${e.id} AND o.owner_id=${ownerId} LIMIT 1`).rows.length;
      if(participation||retained)visibleEvents.push({...e,operator:access.permissions.canConfigure});
    }
  }
  let inventory=await Promise.all(items.map(item=>projection(sql,item,ownerId,boothId)));
  if(projectId)inventory=inventory.map(item=>({...item,allocations:item.allocations.filter(a=>a.projectId===projectId)}));
  const quantityEditable=await stockDelegationAllowed(sql,userId,ownerId,boothId);
  let quantityReadOnlyReason=null;
  if(!quantityEditable){const preference=(await sql`SELECT u.allow_operator_stock FROM pos_artist_profiles p LEFT JOIN pos_admins u ON u.id=p.linked_user_id WHERE p.owner_id=${ownerId}`).rows[0];quantityReadOnlyReason=preference?.allow_operator_stock===false?'제작자가 재고 수정을 허용하지 않았어요 (조회만 가능)':'재고 수정 권한이 없어 조회만 가능합니다.';}
  inventory=inventory.map(item=>({...item,quantityEditable,quantityReadOnlyReason}));
  return {ownerId,quantityEditable,participations,inventory,history:projectId?[]:history,
    events:visibleEvents.filter(e=>!projectId||e.id===projectId).map(e=>({...e,canReturn:Boolean(quantityEditable&&!e.closed_at&&(e.operator||e.starts_on&&!e.event_day)),detailEditable:Boolean(!e.archived_at&&!e.closed_at&&(e.operator||e.starts_on&&!e.event_day)),artistEditable:Boolean(quantityEditable&&e.starts_on&&!e.event_day&&!e.archived_at&&!e.closed_at),operator:Boolean(e.operator&&quantityEditable&&!e.archived_at&&!e.closed_at)}))};
}

async function bindIdentity(sql,owner,boothId,projectId,productId) {
  let recipient=(await sql`SELECT * FROM pos_recipients WHERE booth_id=${boothId} AND owner_id=${owner.id} ORDER BY id LIMIT 1`).rows[0];
  if(!recipient) {
    const display=owner.display_name;
    const collision=(await sql`SELECT id FROM pos_recipients WHERE booth_id=${boothId} AND legacy_creator=${display}`).rows.length;
    const alias=collision?`${display} (${hash(owner.id).slice(0,8)})`:display;
    recipient=(await sql`INSERT INTO pos_recipients(id,booth_id,legacy_creator,display_name,owner_id)
      VALUES(${'recipient:'+hash([boothId,owner.id])},${boothId},${alias},${display},${owner.id}) RETURNING *`).rows[0];
  }
  await sql`INSERT INTO pos_event_recipients(project_id,legacy_creator,recipient_id) VALUES(${projectId},${recipient.legacy_creator},${recipient.id}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO pos_event_product_identities(project_id,product_id,owner_id,recipient_id,resolution)
    VALUES(${projectId},${productId},${owner.id},${recipient.id},'inventory') ON CONFLICT DO NOTHING`;
}

async function setAllocation(sql,userId,owner,item,projectId,quantity,boothId,price) {
  const source=await sharedInventorySource(sql,item),balance=inventoryBalance(source,item);
  const previous=balance.allocations.find(a=>a.projectId===projectId);
  const delta=quantity-(previous?.initial||0);
  const event=await eventAccess(sql,userId,owner.id,projectId,boothId,{returning:delta<0});
  if(event.participation==='ending'&&price!=null&&previous&&price!==Number(source.products.find(p=>p.project_id===projectId&&p.id===previous.productId)?.price))fail('참여 종료 정리 중에는 행사 가격을 변경할 수 없습니다.');
  if(item.product.removedAt)fail('제거된 재고입니다.');
  if(item.stock<delta||previous&&previous.remaining+delta<0)fail('미배정 재고 또는 행사 잔량이 부족합니다.',400);
  if(!integer(quantity)||!integer(price??item.product.price??0))fail('배정 수량과 가격은 0 이상의 정수여야 합니다.',400);
  let productId=previous?.productId;
  if(!productId) {
    productId=randomUUID();
    await sql`INSERT INTO pos_products(project_id,id,name,price,stock,stock_qty,initial_stock_qty,creator_name,goods_type,vtuber_name,genre,is_active)
      VALUES(${projectId},${productId},${item.product.name},${price??Number(item.product.price||0)},0,0,0,${owner.display_name},${item.product.goodsType||item.product.name},${item.product.vtuberName||''},${item.product.genre||''},TRUE)`;
    await sql`INSERT INTO pos_inventory_links(project_id,product_id,admin_id,inventory_id) VALUES(${projectId},${productId},${item.admin_id},${item.id})`;
  }
  const remaining=(previous?.remaining||0)+delta;
  await sql`UPDATE pos_products SET stock=${remaining},stock_qty=${remaining},initial_stock_qty=${quantity},
    price=COALESCE(${price??null}::integer,price),is_active=TRUE,updated_at=NOW() WHERE project_id=${projectId} AND id=${productId}`;
  await sql`UPDATE pos_inventory SET stock=stock-${delta},version=version+1 WHERE admin_id=${item.admin_id} AND id=${item.id}`;
  await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
  await bindIdentity(sql,owner,event.booth_id,projectId,productId);
  return {projectId,productId,before:previous?.initial||0,after:quantity,warehouseDelta:-delta};
}

export async function createArtistStock(sql,userId,payload) {
  const {ownerId,boothId,projectId,name,price,quantity}=payload;
  const access=await ownerAccess(sql,userId,ownerId,boothId);
  const sourceAdmin=access.owner.linked_user_id||(await sql`SELECT legacy_admin_id FROM pos_booths WHERE id=${access.owner.origin_booth_id}`).rows[0]?.legacy_admin_id;
  if(!sourceAdmin)fail('제작자 보관 계정을 확인해주세요.');
  const {owner}=await lockScope(sql,userId,ownerId,boothId,{admin_id:sourceAdmin,id:''},projectId?[projectId]:[]);
  const prior=await replay(sql,userId,'createArtistStock',payload);if(prior.result)return prior.result;
  if(typeof name!=='string'||!name.trim()||name.trim().length>100||!integer(price)||!integer(quantity))fail('상품명·정수 가격·수량을 확인해주세요.',400);
  if(projectId)await eventAccess(sql,userId,ownerId,projectId,boothId);
  const item=(await sql`INSERT INTO pos_inventory(admin_id,id,product,stock,total_received)
    VALUES(${sourceAdmin},${randomUUID()},${JSON.stringify({name:name.trim(),goodsType:String(payload.goodsType||name).slice(0,100),vtuberName:String(payload.vtuberName||'').slice(0,100),genre:String(payload.genre||'').slice(0,100),cost:integer(payload.cost)?payload.cost:0,price,creatorName:owner.display_name,createdAt:new Date().toISOString()})}::jsonb,${quantity},${quantity}) RETURNING *`).rows[0];
  await sql`INSERT INTO pos_inventory_owners(admin_id,inventory_id,owner_id) VALUES(${sourceAdmin},${item.id},${ownerId})`;
  await activate(sql,item);
  let allocation;
  if(projectId)allocation=await setAllocation(sql,userId,owner,item,projectId,quantity,boothId,price);
  const saved=(await sql`SELECT * FROM pos_inventory WHERE admin_id=${item.admin_id} AND id=${item.id}`).rows[0];
  return receipt(sql,userId,'createArtistStock',payload,prior.fingerprint,{inventory:await projection(sql,saved,ownerId,boothId),allocation,change:{before:0,after:quantity,reason:'receipt'}});
}

export async function setArtistAllocation(sql,userId,payload) {
  const {ownerId,boothId,id,projectId,quantity,version,price,fromProjectId}=payload;
  if(!validId(projectId)||!integer(quantity)||!integer(version)||price!=null&&!integer(price)||fromProjectId&&!validId(fromProjectId))fail('배정 정보를 확인해주세요.',400);
  let item=await itemFor(sql,ownerId,id);
  const before=inventoryBalance(await sharedInventorySource(sql,item),item).allocations.find(a=>a.projectId===projectId);
  const returning=!fromProjectId&&before&&quantity<before.initial;
  const {owner}=await lockScope(sql,userId,ownerId,boothId,item,[projectId,...(fromProjectId?[fromProjectId]:[])],returning,Boolean(fromProjectId||!before||quantity!==before.initial));
  const prior=await replay(sql,userId,'setArtistAllocation',payload);if(prior.result)return prior.result;
  item=await itemFor(sql,ownerId,id);
  if(item.version!==version)fail('재고가 변경되었습니다. 새로고침해주세요.');
  await activate(sql,item);
  const changes=[];
  if(fromProjectId) {
    if(fromProjectId===projectId)fail('서로 다른 행사를 선택해주세요.',400);
    const balance=inventoryBalance(await sharedInventorySource(sql,item),item);
    const source=balance.allocations.find(a=>a.projectId===fromProjectId);
    if(!source||!integer(payload.moveQuantity,1)||source.remaining<payload.moveQuantity)fail('이동할 행사 잔량이 부족합니다.',400);
    changes.push(await setAllocation(sql,userId,owner,item,fromProjectId,source.initial-payload.moveQuantity,boothId));
    item=await itemFor(sql,ownerId,id);
  }
  changes.push(await setAllocation(sql,userId,owner,item,projectId,quantity,boothId,price));
  const saved=await itemFor(sql,ownerId,id);
  return receipt(sql,userId,'setArtistAllocation',payload,prior.fingerprint,{inventory:await projection(sql,saved,ownerId,boothId),changes});
}

export async function adjustArtistStock(sql,userId,payload) {
  const {ownerId,boothId,id,version,totalStock,reason='correction'}=payload;
  let item=await itemFor(sql,ownerId,id);
  await lockScope(sql,userId,ownerId,boothId,item);
  const prior=await replay(sql,userId,'adjustArtistStock',payload);if(prior.result)return prior.result;
  item=await itemFor(sql,ownerId,id);
  if(!integer(version)||!integer(totalStock)||!['receipt','correction'].includes(reason))fail('총재고와 사유를 확인해주세요.',400);
  if(item.version!==version)fail('재고가 변경되었습니다. 새로고침해주세요.');
  const balance=inventoryBalance(await sharedInventorySource(sql,item),item),delta=totalStock-balance.totalStock;
  if(totalStock<balance.unavailable||reason==='receipt'&&delta<0)fail(`현재 최소 ${balance.unavailable}개까지 설정할 수 있습니다. 행사 배정·판매·차감 수량을 먼저 확인해주세요.`,400);
  const received=Number(item.total_received??balance.totalStock)+(reason==='receipt'?Math.max(0,delta):0);
  if(!integer(received)||balance.remaining+delta>received)fail('추가 수량은 입고로 기록해주세요.',400);
  await activate(sql,item);
  await sql`UPDATE pos_inventory SET stock=${totalStock-balance.unavailable},total_received=${received},version=version+1 WHERE admin_id=${item.admin_id} AND id=${item.id}`;
  if(delta)await sql`INSERT INTO pos_inventory_adjustments(admin_id,inventory_id,id,delta,reason) VALUES(${item.admin_id},${item.id},${payload.requestId},${delta},${reason})`;
  if(payload.projectId)await authorizeEvent(sql,userId,payload.projectId,'manage',boothId);
  return receipt(sql,userId,'adjustArtistStock',payload,prior.fingerprint,{inventory:await projection(sql,await itemFor(sql,ownerId,id),ownerId,boothId),change:{before:balance.totalStock,after:totalStock,delta,reason}});
}

export async function saveArtistProduct(sql,userId,payload) {
  const {ownerId,boothId,id,version,product}=payload;
  let item=await itemFor(sql,ownerId,id);
  const {owner,own}=await lockScope(sql,userId,ownerId,boothId,item,[],false,false);
  if(owner.linked_user_id&&!own)fail('연결된 제작자의 상품 정보는 제작자가 수정합니다.',403);
  const prior=await replay(sql,userId,'saveArtistProduct',payload);if(prior.result)return prior.result;
  item=await itemFor(sql,ownerId,id);
  if(item.version!==version)fail('상품이 변경되었습니다. 새로고침해주세요.');
  if(!product||typeof product.name!=='string'||!product.name.trim()||product.name.length>200||!integer(product.price)||!integer(product.cost??0))fail('상품명·가격·원가를 확인해주세요.',400);
  const next={...item.product,name:product.name.trim(),price:product.price,cost:product.cost??0};
  for(const key of ['goodsType','vtuberName','genre'])if(Object.hasOwn(product,key)){if(typeof product[key]!=='string'||product[key].length>200)fail('상품 정보를 확인해주세요.',400);next[key]=product[key];}
  if(Object.hasOwn(product,'imageUrl')) {
    const prefix=`inventory/${encodeURIComponent(item.admin_id)}/${encodeURIComponent(item.id)}/`;
    if(product.imageUrl&&!String(product.imageUrl).includes(prefix)&&!String(product.imageUrl).startsWith('/local-images/'))fail('상품 이미지 경로를 확인해주세요.',400);
    next.imageUrl=product.imageUrl;
  }
  await sql`UPDATE pos_inventory SET product=${JSON.stringify(next)}::jsonb,version=version+1 WHERE admin_id=${item.admin_id} AND id=${item.id}`;
  await sql`UPDATE pos_products p SET name=${next.name},goods_type=${next.goodsType||next.name},vtuber_name=${next.vtuberName||''},genre=${next.genre||''},image_url=${next.imageUrl||null}
    FROM pos_inventory_links l WHERE l.project_id=p.project_id AND l.product_id=p.id AND l.admin_id=${item.admin_id} AND l.inventory_id=${item.id}`;
  return receipt(sql,userId,'saveArtistProduct',payload,prior.fingerprint,{inventory:await projection(sql,await itemFor(sql,ownerId,id),ownerId,boothId)});
}

export async function importArtistStock(sql,userId,payload) {
  const {ownerId,boothId,products}=payload;
  await lockScope(sql,userId,ownerId,boothId,null);
  const prior=await replay(sql,userId,'importArtistStock',payload);if(prior.result)return prior.result;
  if(!Array.isArray(products)||!products.length||products.length>500||new Set(products.map(p=>p.id)).size!==products.length)fail('일괄 등록 상품을 확인해주세요.',400);
  const inventory=[];
  for(const product of products) {
    const h=hash([payload.requestId,product.id]);
    const requestId=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
    const result=await createArtistStock(sql,userId,{...product,ownerId,boothId,quantity:product.stock,requestId});
    inventory.push({...result.inventory,importId:product.id});
  }
  return receipt(sql,userId,'importArtistStock',payload,prior.fingerprint,{inventory});
}

export async function saveEventStockSchedule(sql,userId,payload) {
  const {boothId,projectId,startsOn,endsOn}=payload;
  await authorizeBooth(sql,userId,boothId,'manage');
  if(!(await sql`SELECT project_id FROM pos_event_booths WHERE project_id=${projectId} AND booth_id=${boothId}`).rows.length)fail('부스의 행사가 아닙니다.',404);
  await sql`SELECT id FROM pos_projects WHERE id=${projectId} FOR UPDATE`;
  const prior=await replay(sql,userId,'saveEventStockSchedule',payload);if(prior.result)return prior.result;
  const valid=value=>typeof value==='string'&&value>='0001-01-01'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
  if(!valid(startsOn)||!valid(endsOn)||endsOn<startsOn)fail('행사 시작일과 종료일을 확인해주세요.',400);
  await sql`INSERT INTO pos_event_stock_policy(project_id,starts_on,ends_on) VALUES(${projectId},${startsOn}::date,${endsOn}::date)
    ON CONFLICT(project_id) DO UPDATE SET starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on`;
  return receipt(sql,userId,'saveEventStockSchedule',{...payload,ownerId:null},prior.fingerprint,{schedule:{projectId,startsOn,endsOn}});
}

export async function joinArtistBooth(sql,userId,payload) {
  const {ownerId,boothId}=payload;
  await lockScope(sql,userId,ownerId,undefined,null,[],false,false);
  const prior=await replay(sql,userId,'joinArtistBooth',payload);if(prior.result)return prior.result;
  if(!(await sql`SELECT id FROM pos_booths WHERE id=${boothId} AND status='active'`).rows.length)fail('참여할 부스를 확인해주세요.',404);
  const current=(await sql`SELECT status FROM pos_booth_artists WHERE owner_id=${ownerId} AND booth_id=${boothId}`).rows[0];
  if(current?.status==='ending')fail('종료 정리 중인 참여 관계입니다.');
  await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${boothId},${ownerId},'active') ON CONFLICT(booth_id,owner_id) DO UPDATE SET status='active',stock_management_confirmed=TRUE`;
  return receipt(sql,userId,'joinArtistBooth',payload,prior.fingerprint,{joined:true});
}

export async function artistStockMovements(sql,userId,{ownerId,boothId,projectId}) {
  if(projectId){
   await authorizeEvent(sql,userId,projectId,'read',boothId);
   const access=await eventPermissions(sql,userId,projectId);
   if(!access.permissions.canConfigure&&!access.permissions.ownerIds.includes(ownerId))fail('제작자 재고 조회 권한이 없습니다.',403);
   const rows=(await sql`SELECT m.* FROM pos_stock_movements m WHERE m.request->>'projectId'=${projectId} AND m.request->>'ownerId'=${ownerId} ORDER BY m.created_at DESC,m.id`).rows;
   return {movements:rows.map(row=>({...row,request:{...row.request,inventoryId:row.request.stockId||row.request.inventoryId}}))};
  }
  const {own}=await ownerAccess(sql,userId,ownerId,boothId);
  if(own)await authorizeOwnerStock(sql,userId,ownerId);
  else await lockScope(sql,userId,ownerId,boothId,null,[],true,false);
  const rows=(await sql`SELECT m.*,i.id AS inventory_id,i.admin_id AS custodian_id,i.product FROM pos_stock_movements m
    JOIN pos_inventory_owners o ON o.admin_id=m.admin_id AND o.inventory_id=m.request->>'inventoryId'
    JOIN pos_inventory i ON i.admin_id=o.admin_id AND i.id=o.inventory_id
    WHERE o.owner_id=${ownerId} AND COALESCE(m.request->>'projectId','')='' ORDER BY m.created_at DESC,m.id`).rows;
  return {movements:rows.map(row=>({id:row.id,created_at:row.created_at,request:{inventoryId:stockId({admin_id:row.custodian_id,id:row.inventory_id}),projectId:null,productName:row.request.productName||row.product.name,quantity:row.request.quantity,reason:row.request.reason,memo:row.request.memo||''}}))};
}

export async function recordArtistStockLoss(sql,userId,payload) {
  const {ownerId,boothId,id,projectId,version,quantity,reason,memo=''}=payload;
  if(typeof memo!=='string'||memo.length>500)fail('판매처·메모는 500자 이내로 입력해주세요.',400);
  let item=await itemFor(sql,ownerId,id);
  const {owner}=await lockScope(sql,userId,ownerId,boothId,item,projectId?[projectId]:[]);
  const prior=await replay(sql,userId,'recordArtistStockLoss',payload);if(prior.result)return prior.result;
  item=await itemFor(sql,ownerId,id);
  if(!integer(quantity,1)||!integer(version)||!['damage','loss','external'].includes(reason)||reason==='external'&&projectId)fail('차감 사유·위치·수량을 확인해주세요.',400);
  if(item.version!==version)fail('재고가 변경되었습니다. 새로고침해주세요.');
  let productId=null,adminId=item.admin_id;
  const balance=inventoryBalance(await sharedInventorySource(sql,item),item);
  if(projectId) {
    const event=await eventAccess(sql,userId,owner.id,projectId,boothId);
    const allocation=balance.allocations.find(a=>a.projectId===projectId);
    if(!allocation||allocation.remaining<quantity)fail('행사 잔량이 부족합니다.',400);
    productId=allocation.productId;adminId=event.admin_id;
    await sql`UPDATE pos_products SET stock=COALESCE(stock_qty,stock)-${quantity},stock_qty=COALESCE(stock_qty,stock)-${quantity},initial_stock_qty=${allocation.initial},updated_at=NOW() WHERE project_id=${projectId} AND id=${productId}`;
    await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
  } else {
    if(item.stock<quantity)fail('미배정 잔량이 부족합니다.',400);
    await sql`UPDATE pos_inventory SET stock=stock-${quantity} WHERE admin_id=${item.admin_id} AND id=${item.id}`;
  }
  await activate(sql,item);
  await sql`UPDATE pos_inventory SET version=version+1 WHERE admin_id=${item.admin_id} AND id=${item.id}`;
  const request={inventoryId:item.id,projectId:projectId||null,productId,reason,quantity,ownerId,stockId:id,productName:item.product.name,memo};
  await sql`INSERT INTO pos_stock_movements(admin_id,id,request) VALUES(${adminId},${payload.requestId},${JSON.stringify(request)}::jsonb)`;
  return receipt(sql,userId,'recordArtistStockLoss',payload,prior.fingerprint,{inventory:await projection(sql,await itemFor(sql,ownerId,id),ownerId,boothId),change:{reason,quantity,projectId:projectId||null}});
}

export async function leaveArtistBooth(sql,userId,payload) {
  const {ownerId,boothId}=payload;
  await lockScope(sql,userId,ownerId,boothId,null,[],true,false);
  const prior=await replay(sql,userId,'leaveArtistBooth',payload);if(prior.result)return prior.result;
  const events=(await sql`SELECT DISTINCT e.project_id FROM pos_event_recipients e JOIN pos_recipients r ON r.id=e.recipient_id WHERE r.owner_id=${ownerId} AND r.booth_id=${boothId}`).rows;
  let unsettled=false;
  for(const event of events) {
    const aliases=(await sql`SELECT r.legacy_creator FROM pos_recipients r JOIN pos_event_recipients e ON e.recipient_id=r.id WHERE r.owner_id=${ownerId} AND e.project_id=${event.project_id}`).rows.map(r=>r.legacy_creator);
    const closure=(await sql`SELECT * FROM pos_event_settlements WHERE project_id=${event.project_id}`).rows[0];
    const live=(await sql`SELECT id FROM pos_sales WHERE project_id=${event.project_id} LIMIT 1`).rows.length;
    if(live&&!closure?.closed_at){unsettled=true;continue;}
    if(closure?.closed_at)for(const row of closure.snapshot.rows.filter(r=>aliases.includes(r.creator))) {
      const ledger=(await sql`SELECT payments FROM pos_settlements WHERE project_id=${event.project_id} AND creator=${row.creator}`).rows[0];
      if(row.net-(ledger?.payments||[]).reduce((sum,p)=>sum+p.amount,0)>0)unsettled=true;
    }
  }
  const outstanding=(await sql`SELECT p.id FROM pos_event_product_identities i JOIN pos_event_booths b ON b.project_id=i.project_id
    JOIN pos_products p ON p.project_id=i.project_id AND p.id=i.product_id WHERE i.owner_id=${ownerId} AND b.booth_id=${boothId} AND COALESCE(p.stock_qty,p.stock)>0 LIMIT 1`).rows.length;
  const status=outstanding||unsettled?'ending':'ended';
  if(!(await sql`UPDATE pos_booth_artists SET status=${status} WHERE booth_id=${boothId} AND owner_id=${ownerId} RETURNING owner_id`).rows.length)fail('참여 관계를 찾을 수 없습니다.',404);
  return receipt(sql,userId,'leaveArtistBooth',payload,prior.fingerprint,{participation:{boothId,status}});
}


// The API wraps profile, participation, stock and receipts in one transaction.
export async function registerEventArtistProduct(sql,userId,payload) {
 const {projectId,boothId,requestId,artistName}=payload;
 if(!uuid(requestId))fail('요청 ID를 확인해주세요.',400);
 const access=await authorizeEvent(sql,userId,projectId,'read',boothId);
 if(!access.permissions.canConfigure&&(artistName!==undefined||!access.permissions.ownerIds.includes(payload.ownerId)))fail('이 행사의 상품 등록 권한이 없습니다.',403);
 const fingerprint=hash({userId,action:'registerEventArtistProduct',payload});
 const prior=(await sql`SELECT * FROM pos_event_access_commands WHERE id=${requestId}`).rows[0];
 if(prior){if(prior.actor_id!==userId||prior.project_id!==projectId||prior.fingerprint!==fingerprint)fail('같은 요청 ID의 내용이 다릅니다.');return prior.result;}
 let ownerId=payload.ownerId;
 if(artistName!==undefined) {
  if(ownerId)fail('제작자 선택과 직접 입력 중 하나를 사용해주세요.',400);
  await authorizeEvent(sql,userId,projectId,'manage',boothId);
  const {profileId}=await createBoothArtist(sql,userId,{boothId,name:artistName});
  ownerId=(await sql`SELECT owner_id FROM pos_artist_profiles WHERE id=${profileId}`).rows[0].owner_id;
 } else if(ownerId===`admin:${userId}`) {
  await authorizeEvent(sql,userId,projectId,'manage',boothId);
  const account=(await sql`SELECT nickname FROM pos_admins WHERE id=${userId}`).rows[0];
  const home=await createArtistProfile(sql,userId,{name:account.nickname||'관리자'});
  ownerId=home.profiles.find(p=>p.id.startsWith('personal-artist:')).owner_id;
 }
 const participant=(await sql`SELECT status FROM pos_event_artists WHERE project_id=${projectId} AND owner_id=${ownerId}`).rows[0];
 if(participant?.status!=='active') {
  await authorizeEvent(sql,userId,projectId,'manage',boothId);
  if(participant)fail('참여 종료된 제작자는 행사 관리에서 다시 추가해주세요.');
  const profile=(await sql`SELECT p.id FROM pos_artist_profiles p JOIN pos_booth_artists a ON a.owner_id=p.owner_id
   WHERE p.owner_id=${ownerId} AND a.booth_id=${boothId} AND a.status IN ('active','proxy')`).rows[0];
  const admin=(await sql`SELECT p.id FROM pos_artist_profiles p JOIN pos_booth_members m ON m.user_id=p.linked_user_id
   WHERE p.owner_id=${ownerId} AND m.booth_id=${boothId} AND m.status='active' AND m.role IN ('owner','manager')`).rows[0];
  if(!profile&&!admin)fail('행사에 등록된 제작자 또는 관리자를 선택해주세요.',403);
  await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${boothId},${ownerId},'active') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO pos_event_artists(project_id,owner_id) VALUES(${projectId},${ownerId})`;
 }
 const key=hash({requestId,action:'createArtistStock'});
 const stockRequestId=`${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20,32)}`;
 const result=await createArtistStock(sql,userId,{...payload,ownerId,artistName:undefined,requestId:stockRequestId});
 await sql`INSERT INTO pos_event_access_commands(id,actor_id,project_id,fingerprint,result) VALUES(${requestId},${userId},${projectId},${fingerprint},${JSON.stringify(result)}::jsonb)`;
 return result;
}


export async function saveEventArtistProduct(sql,userId,payload) {
 const {ownerId,boothId,id,version,projectId,product}=payload;
 let item=await itemFor(sql,ownerId,id);
 await lockScope(sql,userId,ownerId,boothId,item,[projectId],false,false);
 const prior=await replay(sql,userId,'saveEventArtistProduct',payload);if(prior.result)return prior.result;
 if(item.version!==version)fail('상품이 변경되었습니다. 새로고침해주세요.');
 await eventAccess(sql,userId,ownerId,projectId,boothId);
 if(!product||!integer(product.price))fail('행사 판매가를 확인해주세요.',400);
 if(product.creatorName!==item.product.creatorName)fail('제작자 매핑은 행사 관리에서 변경해주세요.',400);
 const subId=step=>{const key=hash({requestId:payload.requestId,step});return `${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20,32)}`;};
 if(['name','vtuberName','goodsType','genre'].some(key=>product[key]!==item.product[key])) {
  await saveArtistProduct(sql,userId,{ownerId,boothId,id,version,product:{...item.product,...product,price:item.product.price},requestId:subId('original')});
  item=await itemFor(sql,ownerId,id);
 }
 const balance=inventoryBalance(await sharedInventorySource(sql,item),item);
 const allocation=balance.allocations.find(row=>row.projectId===projectId);
 if(!allocation)fail('행사 배정 상품을 찾을 수 없습니다.',404);
 await setArtistAllocation(sql,userId,{ownerId,boothId,id,version:item.version,projectId,quantity:allocation.initial,price:product.price,requestId:subId('price')});
 const result={inventory:await projection(sql,await itemFor(sql,ownerId,id),ownerId,boothId)};
 return receipt(sql,userId,'saveEventArtistProduct',payload,prior.fingerprint,result);
}


export async function setEventProductCreator(sql,userId,payload) {
 const {ownerId,boothId,id,projectId,version,creatorOwnerId}=payload;
 let item=await itemFor(sql,ownerId,id);
 await lockScope(sql,userId,ownerId,boothId,item,[projectId],false,false);
 await authorizeEvent(sql,userId,projectId,'manage',boothId);
 const prior=await replay(sql,userId,'setEventProductCreator',payload);if(prior.result)return prior.result;
 if(item.version!==version)fail('상품이 변경되었습니다. 새로고침해주세요.');
 await eventAccess(sql,userId,ownerId,projectId,boothId);
 const allocation=inventoryBalance(await sharedInventorySource(sql,item),item).allocations.find(row=>row.projectId===projectId);
 if(!allocation)fail('행사 배정 상품을 찾을 수 없습니다.',404);
 let creator;
 if(creatorOwnerId==null){
  const key=hash([boothId,'event-unassigned']);
  const unassignedId=`unassigned-owner:${key}`,profileId=`unassigned-profile:${key}`;
  await sql`INSERT INTO pos_stock_owners(id,kind,display_name,origin_booth_id,legacy_key) VALUES(${unassignedId},'unverified','미지정',${boothId},${unassignedId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO pos_artist_profiles(id,owner_id) VALUES(${profileId},${unassignedId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO pos_booth_artists(booth_id,owner_id,status) VALUES(${boothId},${unassignedId},'proxy') ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO pos_event_artists(project_id,owner_id) VALUES(${projectId},${unassignedId}) ON CONFLICT DO NOTHING`;
  creator=(await sql`SELECT * FROM pos_stock_owners WHERE id=${unassignedId}`).rows[0];
 }else{
  creator=(await sql`SELECT o.* FROM pos_stock_owners o JOIN pos_artist_profiles p ON p.owner_id=o.id
   JOIN pos_event_artists e ON e.owner_id=o.id AND e.project_id=${projectId} AND e.status='active'
   JOIN pos_booth_artists a ON a.owner_id=o.id AND a.booth_id=${boothId} AND a.status IN ('active','proxy') WHERE o.id=${creatorOwnerId} FOR UPDATE OF o,p,e,a`).rows[0];
  if(!creator||creator.display_name==='미지정')fail('행사에 참여한 제작자를 선택해주세요.',403);
 }
 const before=(await sql`SELECT owner_id,recipient_id FROM pos_event_product_identities WHERE project_id=${projectId} AND product_id=${allocation.productId} FOR UPDATE`).rows[0];
 await bindIdentity(sql,creator,boothId,projectId,allocation.productId);
 const recipient=(await sql`SELECT id FROM pos_recipients WHERE booth_id=${boothId} AND owner_id=${creator.id} ORDER BY id LIMIT 1`).rows[0];
 await sql`UPDATE pos_event_product_identities SET owner_id=${creator.id},recipient_id=${recipient.id} WHERE project_id=${projectId} AND product_id=${allocation.productId}`;
 await sql`UPDATE pos_products SET creator_name=${creator.display_name},updated_at=NOW() WHERE project_id=${projectId} AND id=${allocation.productId}`;
 await sql`UPDATE pos_inventory SET version=version+1 WHERE admin_id=${item.admin_id} AND id=${item.id}`;
 await sql`INSERT INTO pos_event_archives(project_id,revision,snapshot) VALUES(${projectId},${'creator:'+payload.requestId},'{}'::jsonb) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision`;
 await sql`UPDATE pos_projects SET updated_at=NOW() WHERE id=${projectId}`;
 return receipt(sql,userId,'setEventProductCreator',payload,prior.fingerprint,{inventory:await projection(sql,await itemFor(sql,ownerId,id),ownerId,boothId),creator:{ownerId:creator.id,name:creator.display_name},change:{before,after:{owner_id:creator.id,recipient_id:recipient.id}}});
}

export async function removeArtistStock(sql,userId,payload){
 const {ownerId,boothId,id,version}=payload;
 let item=await itemFor(sql,ownerId,id);
 const {owner,own}=await lockScope(sql,userId,ownerId,boothId,null,[],false,false);
 if(owner.linked_user_id&&!own)fail('연결된 제작자의 상품은 제작자가 삭제합니다.',403);
 const prior=await replay(sql,userId,'removeArtistStock',payload);if(prior.result)return prior.result;
 item=await itemFor(sql,ownerId,id);
 if(item.product.removedAt)fail('이미 제거된 상품입니다.');
 if(item.version!==version)fail('상품이 변경되었습니다. 새로고침해주세요.');
 const active=(await sql`SELECT p.id FROM pos_inventory_links l JOIN pos_products p ON p.project_id=l.project_id AND p.id=l.product_id JOIN pos_projects e ON e.id=l.project_id WHERE l.admin_id=${item.admin_id} AND l.inventory_id=${item.id} AND e.archived_at IS NULL AND COALESCE(p.is_active,TRUE)=TRUE`).rows;
 if(active.length)fail('활성 행사에 등록된 상품이 있습니다. 행사 판매 설정에서 먼저 제거해주세요.');
 await sql`UPDATE pos_inventory SET product=${JSON.stringify({...item.product,removedAt:new Date().toISOString()})}::jsonb,version=version+1 WHERE admin_id=${item.admin_id} AND id=${item.id}`;
 return receipt(sql,userId,'removeArtistStock',payload,prior.fingerprint,{removed:true,id,change:{reason:'remove'}});
}

export async function saveArtistStockPlan(sql,userId,payload){
 const {ownerId,boothId,id,version,totalStock,allocations=[]}=payload;
 if(payload.currentProjectId){if(!validId(payload.currentProjectId)||!Array.isArray(allocations)||allocations.some(a=>a?.projectId!==payload.currentProjectId))fail('현재 행사 배정만 변경할 수 있습니다.',403);}
 if(!integer(totalStock)||!integer(version)||!Array.isArray(allocations)||allocations.length>200||allocations.some(a=>!a||!validId(a.projectId)||!integer(a.quantity))||new Set(allocations.map(a=>a.projectId)).size!==allocations.length)fail('총재고와 행사별 정수 수량을 확인해주세요.',400);
 let item=await itemFor(sql,ownerId,id);
 await lockScope(sql,userId,ownerId,boothId,item,[],false,false);
 if(payload.currentProjectId)await authorizeEvent(sql,userId,payload.currentProjectId,'read',boothId);
 const prior=await replay(sql,userId,'saveArtistStockPlan',payload);if(prior.result)return prior.result;
 if(payload.currentProjectId)await eventAccess(sql,userId,ownerId,payload.currentProjectId,boothId,{returning:true});
 item=await itemFor(sql,ownerId,id);if(item.version!==version)fail('재고가 변경되었습니다. 새로고침해주세요.');
 const balance=inventoryBalance(await sharedInventorySource(sql,item),item);
 const changes=allocations.map(a=>({...a,before:balance.allocations.find(b=>b.projectId===a.projectId)?.initial||0})).filter(a=>a.quantity!==a.before);
 const minimum=balance.unavailable+changes.reduce((n,a)=>n+a.quantity-a.before,0);
 if(totalStock<minimum)fail(`현재 배정 계획에서는 총재고가 최소 ${minimum}개여야 합니다.`,400);
 const commandIds=[],results=[];
 const stepId=step=>{const key=hash({requestId:payload.requestId,step});return `${key.slice(0,8)}-${key.slice(8,12)}-${key.slice(12,16)}-${key.slice(16,20)}-${key.slice(20,32)}`;};
 const apply=async a=>{
  const row=await eventAccess(sql,userId,ownerId,a.projectId,boothId,{returning:a.quantity<a.before});
  const today=(await sql`SELECT (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date::text AS day`).rows[0].day;
  if((row.archived_at||row.ends_on&&row.ends_on<today)&&a.quantity>a.before)fail('종료된 행사는 잔여 수량 회수만 가능합니다.',409);
  const requestId=stepId(a.projectId);commandIds.push(requestId);item=await itemFor(sql,ownerId,id);
  const result=await setArtistAllocation(sql,userId,{ownerId,boothId,id,version:item.version,projectId:a.projectId,quantity:a.quantity,requestId});results.push(...result.changes);
 };
 for(const a of changes.filter(a=>a.quantity<a.before))await apply(a);
 if(totalStock!==balance.totalStock){item=await itemFor(sql,ownerId,id);const requestId=stepId('total');commandIds.push(requestId);await adjustArtistStock(sql,userId,{ownerId,boothId,id,version:item.version,totalStock,reason:totalStock>balance.totalStock?'receipt':'correction',requestId});}
 for(const a of changes.filter(a=>a.quantity>a.before))await apply(a);
 return receipt(sql,userId,'saveArtistStockPlan',payload.currentProjectId?{...payload,projectId:payload.currentProjectId}:payload,prior.fingerprint,{inventory:await projection(sql,await itemFor(sql,ownerId,id),ownerId,boothId),commandIds,change:{before:balance.totalStock,after:totalStock,delta:totalStock-balance.totalStock,reason:'plan'},changes:results});
}
