import * as stockDelegation from '../api/lib/stockDelegation.js';
import * as storageContract from '../api/lib/storageContract.js';
import {replaceStorageNames,restoreStorageNames,storageShape} from '../api/lib/storageMigration.js';
import * as eventAccess from '../api/lib/eventAccess.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import * as foundation from '../api/lib/boothFoundation.js';
import * as artistLinking from '../api/lib/artistLinking.js';
import * as artistStock from '../api/lib/artistStock.js';
import * as contractRetirement from '../api/lib/contractRetirement.js';
import * as accountInventory from '../api/lib/accountInventory.js';
import * as eventSettlement from '../api/lib/eventSettlement.js';
import * as defaults from '../api/lib/defaultData.js';
import { hashPassword } from '../api/lib/auth.js';
import { settlementMoneyEntries } from '../src/utils/settlementEntries.js';
import { eventSettlementPreview } from '../src/utils/eventSettlement.js';

async function fixture() {
  const db=new PGlite();
  await db.exec("CREATE TABLE pos_admins(id TEXT PRIMARY KEY);INSERT INTO pos_admins VALUES('a'),('b'),('c')");
  const sql=(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
  const pool={connect:async()=>({sql,query:(query,values)=>db.query(query,values),release(){}})};
  const auth={hashPassword,assertPostgresConnectionString(){},requireAuth(req,res){if(req.adminId)return{id:req.adminId};res.status(401).json({error:'Unauthorized'});return null;},validateAdminPassword:async(_id,password)=>password==='test-password'};
  const modules={};
  for(const [name,file] of Object.entries({pos:'pos.js',booths:'booths.js',settlements:'settlements.js'})) {
    const context=vm.createContext({URL,crypto:globalThis.crypto});
    const mod=new vm.SourceTextModule(await readFile(new URL(`../api/${file}`,import.meta.url),'utf8'),{context});
    await mod.link(specifier=>{
      const exports=specifier==='@vercel/postgres'?{sql:pool}:specifier.endsWith('/auth.js')?auth:
        specifier.endsWith('/stockDelegation.js')?stockDelegation:specifier.endsWith('/storageContract.js')?storageContract:specifier.endsWith('/eventAccess.js')?eventAccess:specifier.endsWith('/boothFoundation.js')?foundation:specifier.endsWith('/artistLinking.js')?artistLinking:specifier.endsWith('/artistStock.js')?artistStock:specifier.endsWith('/contractRetirement.js')?contractRetirement:specifier.endsWith('/accountInventory.js')?accountInventory:
        specifier.endsWith('/eventSettlement.js')?eventSettlement:specifier.endsWith('/settlementEntries.js')?{settlementMoneyEntries}:defaults;
      return new vm.SyntheticModule(Object.keys(exports),function(){for(const [key,value] of Object.entries(exports))this.setExport(key,value);},{context});
    });
    await mod.evaluate();modules[name]=mod.namespace;
  }
  const invoke=async(name,action=null,payload={},adminId='a',extra={})=>{
    const result={};
    const req={adminId,method:action?'POST':'GET',query:{},body:action?{action,payload}:undefined,...extra};
    await modules[name].default(req,{status(code){result.status=code;return this;},json(value){result.body=JSON.parse(JSON.stringify(value));return this;}});
    return result;
  };
  const event=(await invoke('pos','createProject',{name:'원본 행사'})).body.project.id;
  const registered=await invoke('pos','createEventProduct',{projectId:event,product:{id:'p',name:'무료 상품',goodsType:'키링',vtuberName:'',creatorName:'작가',genre:'',price:0,stockQty:10}});
  assert.equal(registered.status,200,JSON.stringify(registered.body));
  const item=(await invoke('pos','listInventory')).body.inventory[0];
  await db.query("INSERT INTO pos_settlements(admin_id,project_id,creator,version,deductions,payments) VALUES('a',$1,'작가',1,'[]','[]')",[event]).catch(async()=>{
    // The real settlements API creates its own additive tables.
    await invoke('settlements');
    await db.query("INSERT INTO pos_settlements(admin_id,project_id,creator,version,deductions,payments) VALUES('a',$1,'작가',1,'[]','[]')",[event]);
  });
  const migrate=async()=>{
    const preview=await invoke('booths','previewLegacy');assert.equal(preview.status,200,JSON.stringify(preview.body));
    const result=await invoke('booths','migrateLegacy',{password:'test-password',expectedFingerprint:preview.body.report.fingerprint});
    assert.equal(result.status,200,JSON.stringify(result.body));return result.body;
  };
  return{db,sql,invoke,migrate,event,item};
}

test('new-client event creation establishes its operator booth and appears in workspace while preserving earlier source data',async()=>{
 const f=await fixture();try{
  const before=await foundation.legacySnapshot(f.sql,'a');
  const created=await f.invoke('pos','createProject',{},'a',{body:{action:'createProject',protocolVersion:2,payload:{name:'새 행사',venue:'킨텍스',startsOn:'2026-12-05',endsOn:'2026-12-06'}}});
  assert.equal(created.status,201,JSON.stringify(created.body));assert.ok(created.body.project.boothId);
  const home=await f.invoke('booths',null,{},'a',{query:{workspace:'home'}});assert.equal(home.status,200,JSON.stringify(home.body));
  const event=home.body.events.find(e=>e.id===created.body.project.id);assert.ok(event);assert.equal(event.venue,'킨텍스');assert.equal(event.startsOn,'2026-12-05');assert.equal(event.endsOn,'2026-12-06');assert.equal(event.permissions.operator,true);assert.equal(event.permissions.canManage,true);assert.equal(event.permissions.canSell,true);
  assert.ok(home.body.events.some(e=>e.id===f.event),'previous unlinked own event is preserved and linked');
  const other=await f.invoke('booths',null,{},'b',{query:{workspace:'home'}});assert.equal(other.body.events.some(e=>e.id===event.id),false);
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.sales,before.sales);assert.deepEqual(after.settlements,before.settlements);
  const second=await f.invoke('pos','createProject',{},'a',{body:{action:'createProject',protocolVersion:2,boothId:event.boothId,payload:{name:'두 번째 행사'}}});assert.equal(second.status,201,JSON.stringify(second.body));
  const refreshed=await f.invoke('booths',null,{},'a',{query:{workspace:'home'}});assert.equal(refreshed.body.events.find(e=>e.id===second.body.project.id).permissions.operator,true);
  const denied=await f.invoke('pos','createProject',{},'b',{body:{action:'createProject',protocolVersion:2,boothId:event.boothId,payload:{name:'권한 없음'}}});assert.equal(denied.status,403);
 }finally{await f.db.close();}
});

test('artist movement history keeps personal scope, memo and stable IDs without changing event sales',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const profile=(await f.sql`SELECT id,id AS owner_id FROM pos_stock_owners ORDER BY id`).rows[0];
  const invite=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});
  assert.equal((await f.invoke('booths','acceptArtistInvitation',{token:invite.body.invitation.token,acceptSharedStock:true},'b')).status,200);
  const created=await f.invoke('booths','createArtistStock',{ownerId:profile.owner_id,name:'외부 판매 상품',quantity:10,price:0,requestId:crypto.randomUUID()},'b');assert.equal(created.status,200,JSON.stringify(created.body));
  const item=created.body.inventory;
  const sales=(await foundation.legacySnapshot(f.sql,'a')).sales;
  const payload={ownerId:profile.owner_id,id:item.id,version:item.version,quantity:2,reason:'external',memo:'윗치폼 판매',requestId:crypto.randomUUID()};
  const saved=await f.invoke('booths','recordArtistStockLoss',payload,'b');assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.inventory.warehouse,8);
  assert.deepEqual((await f.invoke('booths','recordArtistStockLoss',payload,'b')).body,saved.body);
  const history=await f.invoke('booths',null,{},'b',{query:{artists:'movements',ownerId:profile.owner_id}});assert.equal(history.status,200,JSON.stringify(history.body));assert.equal(history.body.movements.length,1);
  assert.equal(history.body.movements[0].request.inventoryId,item.id);assert.equal(history.body.movements[0].request.memo,'윗치폼 판매');assert.equal(history.body.movements[0].request.productName,'외부 판매 상품');
  assert.equal((await f.invoke('booths',null,{},'c',{query:{artists:'movements',ownerId:profile.owner_id}})).status,403);
  assert.equal((await f.invoke('booths','recordArtistStockLoss',{...payload,version:saved.body.inventory.version,memo:'x'.repeat(501),requestId:crypto.randomUUID()},'b')).status,400);
  assert.deepEqual((await foundation.legacySnapshot(f.sql,'a')).sales,sales);
 }finally{await f.db.close();}
});

test('contract retirement requires scope, owner, password, a fresh report and queue checks; reopening preserves subsequent transactions',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const read=()=>f.invoke('booths',null,{},'a',{query:{contracts:'legacy',boothId}});
    let report=(await read()).body;assert.equal(report.ready,true);
    const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
    const request={boothId,version:report.policy.version,expectedFingerprint:report.fingerprint,closed:true,requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('booths','changeLegacyContracts',request)).status,403);
    assert.equal((await f.invoke('booths','changeLegacyContracts',{...request,password:'test-password'})).status,409);
    assert.equal((await f.invoke('booths','changeLegacyContracts',{...request,password:'test-password',queuesChecked:true},'b')).status,403);
    const command={...request,password:'test-password',queuesChecked:true};
    let result=await f.invoke('booths','changeLegacyContracts',command);assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal((await f.invoke('booths','changeLegacyContracts',command)).status,200);
    assert.equal((await f.invoke('booths','changeLegacyContracts',{...command,closed:false})).status,409);
    assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a')),before);
    const oldSale={localOrderId:'retired-legacy',method:'cash',total:0,cart:[{type:'product',id:'p',qty:1,unitPrice:0,creatorName:'작가'}]};
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',projectId:f.event,payload:oldSale}})).status,410);
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body:{boothId,action:'finalizeSale',projectId:f.event,payload:oldSale}})).status,410);
    const newSale={boothId,protocolVersion:2,actorId:'a',projectId:f.event,action:'finalizeSale',payload:{...oldSale,localOrderId:'new-after-retirement'}};
    const sold=await f.invoke('pos','finalizeSale',{},'a',{body:newSale});assert.equal(sold.status,200,JSON.stringify(sold.body));
    assert.equal((await f.invoke('pos','createProject',{name:'범위 누락'})).status,410);
    const mappings=await foundation.recipientMap(f.sql,'a');const recipientId=mappings[0].recipient_id;
    const fee={action:'saveDeductions',projectId:f.event,version:1,deductions:[],requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('settlements','saveDeductions',{},'a',{body:{...fee,boothId,creator:'작가'}})).status,410);
    const saved=await f.invoke('settlements','saveDeductions',{},'a',{body:{...fee,boothId,recipientId}});assert.equal(saved.status,200,JSON.stringify(saved.body));
    const complete={action:'completeRecipientSettlement',projectId:f.event,version:2,paidAt:'2026-10-29',requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('settlements',complete.action,{},'a',{body:{...complete,boothId,creator:'작가'}})).status,410);
    assert.equal((await f.invoke('settlements',complete.action,{},'a',{body:{...complete,recipientId}})).status,410);
    assert.equal((await f.invoke('settlements',complete.action,{},'a',{body:{...complete,boothId,recipientId}})).status,409); // Correct scope reaches the not-started guard.
    const afterSale=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
    report=(await read()).body;
    const reopened=await f.invoke('booths','changeLegacyContracts',{boothId,password:'test-password',version:report.policy.version,expectedFingerprint:report.fingerprint,closed:false,requestId:crypto.randomUUID()});assert.equal(reopened.status,200,JSON.stringify(reopened.body));
    assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a')),afterSale);
    assert.equal((await f.invoke('pos',null,{},'a',{query:{projectId:f.event}})).body.sales.length,1);
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',projectId:f.event,payload:oldSale}})).status,200);
    const backup=await foundation.foundationBackup(f.sql,'a');assert.equal(backup.tables.pos_booth_contract_commands.length,2);assert.ok(!JSON.stringify(backup).includes('test-password'));
  }finally{await f.db.close();}
});

test('retirement detects missing mappings and changed source; command failures roll policy back for safe retry',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const read=()=>f.invoke('booths',null,{},'a',{query:{contracts:'legacy',boothId}});
    let report=(await read()).body;
    const command={boothId,password:'test-password',version:report.policy.version,expectedFingerprint:report.fingerprint,closed:true,queuesChecked:true,requestId:crypto.randomUUID()};
    await f.db.query("UPDATE pos_projects SET name='변경 행사' WHERE id=$1",[f.event]);
    assert.equal((await f.invoke('booths','changeLegacyContracts',command)).status,409);
    report=(await read()).body;
    await f.db.exec("CREATE FUNCTION reject_contract() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;CREATE TRIGGER reject_contract BEFORE INSERT ON pos_booth_contract_commands FOR EACH ROW EXECUTE FUNCTION reject_contract()");
    const retry={...command,expectedFingerprint:report.fingerprint};
    assert.equal((await f.invoke('booths','changeLegacyContracts',retry)).status,500);
    assert.equal((await read()).body.policy.legacyWritesClosed,false);
    await f.db.exec('DROP TRIGGER reject_contract ON pos_booth_contract_commands');
    assert.equal((await f.invoke('booths','changeLegacyContracts',retry)).status,200);
    await f.db.query('DELETE FROM pos_event_product_identities WHERE project_id=$1',[f.event]);
    report=(await read()).body;assert.equal(report.ready,false);assert.ok(report.issues.some(i=>i.code==='MISSING_PRODUCT_IDENTITY'));
  }finally{await f.db.close();}
});

test('artist invitations require an operator, explicit consent and one account; linking preserves every source row',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
    const list=await f.invoke('booths',null,{},'a',{query:{artists:'participants',boothId}});
    assert.equal(list.status,200,JSON.stringify(list.body));
    const profileId=list.body.profiles[0].id,ownerId=list.body.profiles[0].owner_id;
    assert.equal((await f.invoke('booths','issueArtistInvitation',{boothId,profileId},'b')).status,403);
    const issued=await f.invoke('booths','issueArtistInvitation',{boothId,profileId});assert.equal(issued.status,200,JSON.stringify(issued.body));
    const token=issued.body.invitation.token;
    const stored=(await f.db.query('SELECT * FROM pos_artist_invitations')).rows[0];
    assert.notEqual(stored.token_hash,token);assert.equal(stored.token_hash.length,64);assert.ok(!JSON.stringify(stored).includes(token));
    const preview=await f.invoke('booths','previewArtistInvitation',{token},'b');assert.equal(preview.status,200);assert.equal(preview.body.invitation.artistName,'작가');
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token},'b')).status,400);
    const accepted=await f.invoke('booths','acceptArtistInvitation',{token,acceptSharedStock:true},'b');assert.equal(accepted.status,200,JSON.stringify(accepted.body));
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token,acceptSharedStock:true},'b')).status,200);
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token,acceptSharedStock:true},'c')).status,409);
    assert.equal((await f.invoke('booths','revokeArtistInvitation',{boothId,invitationId:stored.id})).status,409);
    assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a')),before);
    assert.equal((await f.invoke('booths',null,{},'b',{query:{ownerId}})).status,200);
    assert.equal((await f.invoke('booths',null,{},'a',{query:{ownerId,boothId}})).status,200);
    assert.equal((await f.invoke('pos',null,{},'b',{query:{boothId,projectId:f.event}})).status,403);
    assert.equal((await f.invoke('booths',null,{},'b',{query:{artists:'participants',boothId}})).status,403);
    assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM pos_artist_link_audit WHERE action='profile_linked'")).rows[0].n),1);
    const backup=await foundation.foundationBackup(f.sql,'a');assert.ok(!JSON.stringify(backup).includes(token));assert.ok(!JSON.stringify(backup).includes(stored.token_hash));
  }finally{await f.db.close();}
});

test('operator event creation adds one artist stock; event-day artist edits fail and operators retain direct control',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const profile=(await f.invoke('booths','createArtistProfile',{name:'본인 작가'},'b')).body.profiles[0];
    assert.equal((await f.invoke('booths','joinArtistBooth',{ownerId:profile.owner_id,boothId,requestId:crypto.randomUUID()},'b')).status,200);
    const create={ownerId:profile.owner_id,boothId,projectId:f.event,name:'a 작품',price:0,quantity:20,requestId:crypto.randomUUID()};
    const created=await f.invoke('booths','createArtistStock',create);assert.equal(created.status,200,JSON.stringify(created.body));
    const item=created.body.inventory;assert.equal(item.totalStock,20);assert.equal(item.warehouse,0);assert.equal(item.allocations[0].remaining,20);
    assert.equal((await f.invoke('booths','createArtistStock',create)).body.inventory.id,item.id);
    assert.equal((await f.invoke('booths','createArtistStock',{...create,quantity:21})).status,409);
    assert.equal((await f.invoke('booths','adjustArtistStock',{ownerId:profile.owner_id,id:item.id,version:0,totalStock:25,reason:'receipt',requestId:crypto.randomUUID()},'b')).status,409);
    assert.equal(Number((await f.db.query("SELECT COUNT(*) AS n FROM pos_inventory WHERE product->>'name'='a 작품'")).rows[0].n),1);
    const authorView=await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:profile.owner_id}});assert.equal(authorView.body.inventory[0].totalStock,20);
    const allocate={ownerId:profile.owner_id,id:item.id,projectId:f.event,quantity:10,version:item.version,requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('booths','setArtistAllocation',allocate,'b')).status,403); // no dates: operator only
    const today=(await f.db.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Seoul')::date::text AS day")).rows[0].day;
    const schedule={boothId,projectId:f.event,startsOn:today,endsOn:today,requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('booths','saveEventStockSchedule',schedule,'b')).status,403);
    assert.equal((await f.invoke('booths','saveEventStockSchedule',schedule)).status,200);
    assert.equal((await f.invoke('booths','setArtistAllocation',allocate,'b')).status,403);
    const before=(await f.db.query('SELECT stock_qty FROM pos_products WHERE project_id=$1 AND id=$2',[f.event,created.body.allocation.productId])).rows[0].stock_qty;
    const ownCorrection=await f.invoke('booths','adjustArtistStock',{ownerId:profile.owner_id,id:item.id,version:item.version,totalStock:25,reason:'receipt',requestId:crypto.randomUUID()},'b');
    assert.equal(ownCorrection.status,200,JSON.stringify(ownCorrection.body));
    assert.equal((await f.db.query('SELECT stock_qty FROM pos_products WHERE project_id=$1 AND id=$2',[f.event,created.body.allocation.productId])).rows[0].stock_qty,before);
    const changed=await f.invoke('booths','setArtistAllocation',{...allocate,boothId,version:ownCorrection.body.inventory.version,requestId:crypto.randomUUID()});assert.equal(changed.status,200,JSON.stringify(changed.body));
    assert.equal(changed.body.inventory.totalStock,25);assert.equal(changed.body.inventory.warehouse,15);
    assert.equal((await f.invoke('booths','saveEventStockSchedule',{...schedule,startsOn:'2099-01-01',endsOn:'2099-01-02',requestId:crypto.randomUUID()})).status,200);
    const outside=await f.invoke('booths','setArtistAllocation',{...allocate,quantity:20,version:changed.body.inventory.version,requestId:crypto.randomUUID()},'b');assert.equal(outside.status,200,JSON.stringify(outside.body));
    assert.equal(outside.body.inventory.warehouse,5);
  }finally{await f.db.close();}
});

test('one artist 100/A40/B20: shared event sales, cancel and returns preserve totals and hide other booth allocations',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const p=(await f.invoke('booths','createArtistProfile',{name:'재고 작가'},'b')).body.profiles[0];
    await f.invoke('booths','joinArtistBooth',{ownerId:p.owner_id,boothId,requestId:crypto.randomUUID()},'b');
    await f.invoke('booths','createArtistProfile',{name:'운영 작가'},'c');
    const boothB=(await f.invoke('booths','createFirstBooth',{name:'다른 부스'},'c')).body.booth.id;
    const eventB=(await f.invoke('pos','createProject',{name:'B 행사'},'c')).body.project.id;
    await f.invoke('booths','joinArtistBooth',{ownerId:p.owner_id,boothId:boothB,requestId:crypto.randomUUID()},'b');
    const created=await f.invoke('booths','createArtistStock',{ownerId:p.owner_id,name:'b 작품',price:100,quantity:100,requestId:crypto.randomUUID()},'b');assert.equal(created.status,200,JSON.stringify(created.body));
    const base={ownerId:p.owner_id,id:created.body.inventory.id};
    let allocated=await f.invoke('booths','setArtistAllocation',{...base,boothId,projectId:f.event,quantity:40,version:0,requestId:crypto.randomUUID()});assert.equal(allocated.status,200,JSON.stringify(allocated.body));
    const bAllocation=await f.invoke('booths','setArtistAllocation',{...base,boothId:boothB,projectId:eventB,quantity:20,version:1,requestId:crypto.randomUUID()},'c');assert.equal(bAllocation.status,200,JSON.stringify(bAllocation.body));
    assert.equal(bAllocation.body.inventory.warehouse,40);assert.equal(bAllocation.body.inventory.totalStock,100);
    const sale={localOrderId:'shared-sale',method:'cash',total:500,cart:[{type:'product',id:bAllocation.body.changes[0].productId,qty:5,unitPrice:100}]};
    const sold=await f.invoke('pos','finalizeSale',{},'c',{body:{action:'finalizeSale',projectId:eventB,payload:sale}});assert.equal(sold.status,200,JSON.stringify(sold.body));
    const view=await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:p.owner_id}});assert.equal(view.body.inventory[0].totalStock,100);assert.equal(view.body.inventory[0].remaining,95);
    const staff=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId:p.owner_id,boothId}});
    assert.equal(staff.body.inventory[0].allocations.length,1);assert.ok(!JSON.stringify(staff.body).includes(eventB));
    assert.equal((await f.invoke('booths','setArtistAllocation',{...base,boothId,projectId:eventB,quantity:0,version:2,requestId:crypto.randomUUID()})).status,404);
    assert.equal((await f.invoke('booths','setArtistAllocation',{...base,boothId:boothB,projectId:eventB,quantity:0,version:2,requestId:crypto.randomUUID()},'c')).status,400); // sold 5 cannot return
    const returned=await f.invoke('booths','setArtistAllocation',{...base,boothId:boothB,projectId:eventB,quantity:5,version:2,requestId:crypto.randomUUID()},'c');assert.equal(returned.status,200,JSON.stringify(returned.body));assert.equal(returned.body.inventory.warehouse,55);
    assert.equal((await f.invoke('pos','voidSale',{},'c',{body:{action:'voidSale',projectId:eventB,payload:{id:'shared-sale'}}})).status,200);
    const after=await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:p.owner_id}});assert.equal(after.body.inventory[0].remaining,100);assert.equal(after.body.inventory[0].allocations.find(a=>a.projectId===eventB).remaining,5);
    const over=await f.invoke('booths','setArtistAllocation',{...base,boothId,projectId:f.event,quantity:100,version:3,requestId:crypto.randomUUID()});assert.equal(over.status,400);
    const eventA2=(await f.invoke('pos','createProject',{name:'A 두번째 행사'})).body.project.id;
    for(const projectId of [f.event,eventA2])assert.equal((await f.invoke('booths','saveEventStockSchedule',{boothId,projectId,startsOn:'2099-01-01',endsOn:'2099-01-02',requestId:crypto.randomUUID()})).status,200);
    const move={...base,projectId:eventA2,fromProjectId:f.event,moveQuantity:10,quantity:10,version:3,requestId:crypto.randomUUID()};
    const moved=await f.invoke('booths','setArtistAllocation',move,'b');assert.equal(moved.status,200,JSON.stringify(moved.body));assert.equal(moved.body.inventory.warehouse,55);assert.equal(moved.body.inventory.totalStock,100);
    assert.equal(moved.body.inventory.allocations.find(a=>a.projectId===f.event).initial,30);
    const archive=await foundation.foundationBackup(f.sql,'a');assert.ok(!JSON.stringify(archive).includes(eventB));
    assert.ok(archive.tables.pos_shared_stock_commands.some(c=>c.id===move.requestId));
    const failedMove=await f.invoke('booths','setArtistAllocation',{...move,fromProjectId:eventA2,projectId:f.event,quantity:1000,version:5,requestId:crypto.randomUUID()},'b');assert.equal(failedMove.status,400);
    const unchanged=await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:p.owner_id}});assert.equal(unchanged.body.inventory[0].version,5);assert.equal(unchanged.body.inventory[0].allocations.find(a=>a.projectId===eventA2).initial,10);
    await f.db.query("INSERT INTO pos_event_settlements(admin_id,project_id,closed_at,snapshot) VALUES('a',$1,NOW(),'{\"rows\":[]}'::jsonb)",[eventA2]);
    assert.equal((await f.invoke('booths','setArtistAllocation',{...base,boothId,projectId:eventA2,quantity:15,version:5,requestId:crypto.randomUUID()})).status,409);
  }finally{await f.db.close();}
});

test('shared loss, receipt rollback, legacy bypass and exit keep stock and financial records consistent',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const profile=(await f.invoke('booths','createArtistProfile',{name:'별도 작가'},'b')).body.profiles[0];
    const ownerId=profile.owner_id;
    await f.invoke('booths','joinArtistBooth',{ownerId,boothId,requestId:crypto.randomUUID()},'b');
    const created=await f.invoke('booths','createArtistStock',{ownerId,boothId,name:'차감 상품',price:0,quantity:20,requestId:crypto.randomUUID()});assert.equal(created.status,200,JSON.stringify(created.body));
    const base={ownerId,boothId,id:created.body.inventory.id};
    let result=await f.invoke('booths','setArtistAllocation',{...base,projectId:f.event,quantity:10,version:0,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));
    const source=(await f.db.query('SELECT * FROM pos_shared_stock_items WHERE id=$1',[base.id])).rows[0];
    const originalLedger=JSON.stringify((await f.db.query('SELECT * FROM pos_settlements ORDER BY admin_id,project_id,creator')).rows);
    const loss={...base,projectId:f.event,reason:'damage',quantity:5,version:1,requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('booths','recordArtistStockLoss',loss,'b')).status,403);
    result=await f.invoke('booths','recordArtistStockLoss',loss);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.inventory.remaining,15);assert.equal(result.body.inventory.totalStock,20);
    assert.equal((await f.invoke('booths','recordArtistStockLoss',loss)).status,200);
    result=await f.invoke('booths','recordArtistStockLoss',{...base,reason:'loss',quantity:2,version:2,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.inventory.remaining,13);assert.equal(result.body.inventory.totalStock,20);
    assert.equal(JSON.stringify((await f.db.query('SELECT * FROM pos_settlements ORDER BY admin_id,project_id,creator')).rows),originalLedger);
    const oldEdit=await f.invoke('pos','transferInventory',{projectId:f.event,inventoryId:source.inventory_id,direction:'allocate',qty:1,requestId:crypto.randomUUID()});assert.equal(oldEdit.status,409);
    assert.equal((await f.invoke('pos','restoreAccount',{},'b')).status,409);
    const backup=await f.invoke('pos','backupAccount',{},'b');assert.equal(backup.status,200,JSON.stringify(backup.body));assert.equal(backup.body.backup.data.version,2);
    await f.db.exec("CREATE FUNCTION fail_shared_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END $$;CREATE TRIGGER fail_shared_command BEFORE INSERT ON pos_shared_stock_commands FOR EACH ROW EXECUTE FUNCTION fail_shared_command()");
    const failed={...base,projectId:f.event,quantity:8,version:3,requestId:crypto.randomUUID()};
    assert.equal((await f.invoke('booths','setArtistAllocation',failed)).status,500);
    const after=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId,boothId}});assert.equal(after.body.inventory[0].version,3);assert.equal(after.body.inventory[0].allocations[0].initial,10);
    await f.db.exec('DROP TRIGGER fail_shared_command ON pos_shared_stock_commands');assert.equal((await f.invoke('booths','setArtistAllocation',failed)).status,200);
    result=await f.invoke('booths','leaveArtistBooth',{ownerId,boothId,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.participation.status,'ending');
    assert.equal((await f.invoke('booths','adjustArtistStock',{...base,version:4,totalStock:25,reason:'receipt',requestId:crypto.randomUUID()})).status,403);
    result=await f.invoke('booths','setArtistAllocation',{...base,projectId:f.event,quantity:5,version:4,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.inventory.allocations[0].remaining,0);
    result=await f.invoke('booths','leaveArtistBooth',{ownerId,boothId,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.participation.status,'ended');
    const late=await f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',projectId:f.event,payload:{localOrderId:'late',method:'cash',total:0,cart:[{type:'product',id:after.body.inventory[0].allocations[0].productId,qty:1,unitPrice:0}]}}});assert.equal(late.status,403);
    assert.equal((await f.invoke('booths',null,{},'b',{query:{artists:'history'}})).status,200);
  }finally{await f.db.close();}
});

test('expired, revoked, reissued, ended participation and revoked issuer invitations cannot link',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const profileId=(await f.db.query('SELECT id FROM pos_stock_owners')).rows[0].id;
    const issue=async()=>{const result=await f.invoke('booths','issueArtistInvitation',{boothId,profileId});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.invitation;};
    const accept=invite=>f.invoke('booths','acceptArtistInvitation',{token:invite.token,acceptSharedStock:true},'b');
    let invite=await issue();await f.db.query("UPDATE pos_artist_invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[invite.id]);assert.equal((await accept(invite)).status,409);
    invite=await issue();assert.equal((await f.invoke('booths','revokeArtistInvitation',{boothId,invitationId:invite.id},'c')).status,403);
    assert.equal((await f.invoke('booths','revokeArtistInvitation',{boothId,invitationId:invite.id})).status,200);assert.equal((await accept(invite)).status,409);
    invite=await issue();const replacement=await issue();assert.equal((await accept(invite)).status,409);
    await f.db.query("UPDATE pos_booth_artists SET status='ended' WHERE booth_id=$1",[boothId]);assert.equal((await accept(replacement)).status,409);
    await f.db.query("UPDATE pos_booth_artists SET status='proxy' WHERE booth_id=$1",[boothId]);
    await f.db.query("UPDATE pos_booth_members SET status='ended' WHERE booth_id=$1",[boothId]);assert.equal((await accept(replacement)).status,409);
    assert.equal((await f.db.query('SELECT linked_user_id FROM pos_stock_owners')).rows[0].linked_user_id,null);
    assert.equal(Number((await f.db.query('SELECT COUNT(*) AS n FROM pos_owner_members')).rows[0].n),0);
  }finally{await f.db.close();}
});

test('failed link rolls back profile, membership, participation and token use; the same token can retry',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const profile=(await f.db.query('SELECT *,id AS owner_id FROM pos_stock_owners')).rows[0];
    const issued=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});
    const token=issued.body.invitation.token;
    const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
    await f.db.exec("CREATE FUNCTION reject_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='profile_linked' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_link BEFORE INSERT ON pos_artist_link_audit FOR EACH ROW EXECUTE FUNCTION reject_link()");
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token,acceptSharedStock:true},'b')).status,500);
    assert.equal((await f.db.query('SELECT linked_user_id FROM pos_stock_owners WHERE id=$1',[profile.id])).rows[0].linked_user_id,null);
    assert.equal((await f.db.query('SELECT accepted_by FROM pos_artist_invitations')).rows[0].accepted_by,null);
    assert.equal((await f.db.query('SELECT status FROM pos_booth_artists WHERE owner_id=$1',[profile.owner_id])).rows[0].status,'proxy');
    assert.equal(Number((await f.db.query('SELECT COUNT(*) AS n FROM pos_owner_members')).rows[0].n),0);
    assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a')),before);
    await f.db.exec('DROP TRIGGER reject_link ON pos_artist_link_audit');
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token,acceptSharedStock:true},'b')).status,200);
  }finally{await f.db.close();}
});

test('artist history redacts other bundle components, uses frozen settlements and survives display rename and participation end',async()=>{
  const f=await fixture();try{
    await f.db.query("UPDATE pos_products SET price=100 WHERE project_id=$1",[f.event]);
    await f.invoke('pos','createEventProduct',{projectId:f.event,product:{id:'secret',name:'비공개 상품',goodsType:'키링',creatorName:'다른 작가',price:300,stockQty:10}});
    await f.db.query("INSERT INTO pos_bundles(project_id,id,name,price,items) VALUES($1,'mix','비공개 세트명',400,$2::jsonb)",[f.event,JSON.stringify([{productId:'p',qty:1},{productId:'secret',qty:1}])]);
    await f.migrate();
    const boothId=(await foundation.migratedBooth(f.sql,'a')).id;
    const profile=(await f.db.query("SELECT o.*,o.id AS owner_id FROM pos_stock_owners o WHERE o.display_name='작가'")).rows[0];
    const issued=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token:issued.body.invitation.token,acceptSharedStock:true},'b')).status,200);
    const lines=[{type:'bundle',id:'mix',qty:2,unitPrice:400,name:'비공개 세트명',subItems:[{productId:'p',name:'내 상품',qty:1,unitPrice:100,creatorName:'작가'},{productId:'secret',name:'비공개 상품',qty:1,unitPrice:300,creatorName:'다른 작가'}]}];
    await f.db.query("INSERT INTO pos_sales(project_id,id,time,method,total,lines) VALUES($1,'mixed',NOW(),'transfer',800,$2::jsonb)",[f.event,JSON.stringify(lines)]);
    const costs=[{label:'참가비',memo:'운영 비공개 메모',type:'fixed',value:80,split:'ratio'}];
    const expected=await f.invoke('booths',null,{},'b',{query:{artists:'history'}});
    assert.equal(expected.body.events[0].closedAt,null);assert.equal(expected.body.events[0].rows[0].gross,200);
    const state=await eventSettlement.eventState(f.sql,'a',f.event);
    const frozen={...eventSettlementPreview(state,costs,[]),sales:state.sales};
    await f.db.query("INSERT INTO pos_event_settlements(admin_id,project_id,version,costs,snapshot,closed_at) VALUES('a',$1,1,$2::jsonb,$3::jsonb,NOW())",[f.event,JSON.stringify(costs),JSON.stringify(frozen)]);
    // A changed current cost config must not recalculate a frozen settlement.
    await f.db.query("UPDATE pos_event_settlements SET costs=$1::jsonb WHERE project_id=$2",[JSON.stringify([{...costs[0],value:400}]),f.event]);
    await f.db.query("INSERT INTO pos_booth_sale_history(project_id,sale_id,snapshot,voided) VALUES($1,'voided',$2::jsonb,TRUE)",[f.event,JSON.stringify({time:'2026-10-21T00:00:00Z',method:'transfer',total:800,lines})]);
    await f.db.query("UPDATE pos_settlements SET payments=$1::jsonb WHERE admin_id='a' AND project_id=$2 AND creator='작가'",[JSON.stringify([{id:'payment',amount:100,paidAt:'2026-10-22',memo:'비공개 계좌'}]),f.event]);
    await f.db.query("UPDATE pos_stock_owners SET display_name='바뀐 작가명' WHERE id=$1",[profile.owner_id]);
    await f.db.query("UPDATE pos_booth_artists SET status='ended' WHERE owner_id=$1",[profile.owner_id]);
    const result=await f.invoke('booths',null,{},'b',{query:{artists:'history',adminId:'a',ownerId:'ignored'}});
    assert.equal(result.status,200,JSON.stringify(result.body));
    const event=result.body.events[0];assert.equal(event.rows.length,1);
    assert.equal(event.rows[0].artistName,'바뀐 작가명');assert.equal(event.rows[0].gross,200);assert.equal(event.rows[0].fees,20);
    assert.equal(event.rows[0].paid,100);assert.equal(event.rows[0].pending,80);
    assert.equal(event.rows[0].completed,false);assert.equal(event.finishedAt,null);
    await f.db.query("UPDATE pos_settlements SET payments=$1::jsonb WHERE admin_id='a' AND project_id=$2 AND creator='작가'",[JSON.stringify([{id:'paid',amount:180,paidAt:'2026-10-29'}]),f.event]);
    await f.db.query("UPDATE pos_event_settlements SET history=$1::jsonb WHERE project_id=$2",[JSON.stringify([{action:'finish',at:'2026-10-29T00:00:00Z'}]),f.event]);
    const completed=await f.invoke('booths',null,{},'b',{query:{artists:'history'}});assert.equal(completed.body.events[0].rows[0].completed,true);assert.equal(completed.body.events[0].finishedAt,'2026-10-29T00:00:00Z');
    assert.equal(completed.body.events[0].rows.length,1);
    assert.equal(event.sales[0].items.length,1);assert.equal(event.sales[0].items[0].amount,200);
    assert.equal(event.sales.length,2);assert.equal(event.sales[1].voided,true);
    for(const secret of ['비공개 상품','다른 작가','비공개 세트명','운영 비공개 메모','비공개 계좌','transfer','legacy_admin_id','token_hash']) assert.ok(!JSON.stringify(result.body).includes(secret),secret);
    assert.equal((await f.invoke('booths',null,{},'c',{query:{artists:'history',profileId:profile.id}})).body.events.length,0);
    assert.equal((await f.invoke('booths',null,{},'a',{query:{ownerId:profile.owner_id,boothId}})).status,403);
  }finally{await f.db.close();}
});

test('personal artist is independent of a booth, first booth creation retries safely, and separate booths can link to one user',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const create=await f.invoke('booths','createArtistProfile',{name:'내 이름'},'b');assert.equal(create.status,200,JSON.stringify(create.body));
    const again=await f.invoke('booths','createArtistProfile',{name:'다른 이름'},'b');assert.equal(again.body.profiles.length,1);assert.equal(again.body.profiles[0].display_name,'내 이름');
    assert.equal(again.body.profiles[0].origin_booth_id,null);
    const newBooth=await f.invoke('booths','createFirstBooth',{name:'내 부스'},'b');assert.equal(newBooth.status,200,JSON.stringify(newBooth.body));
    assert.equal((await f.invoke('booths','createFirstBooth',{name:'재시도'},'b')).body.booth.id,newBooth.body.booth.id);
    const backup=await foundation.foundationBackup(f.sql,'b');
    assert.ok(backup.tables.pos_stock_owners.some(o=>o.origin_booth_id===null));
    assert.equal((await f.invoke('booths','createFirstBooth',{name:'자료 보존'},'c')).status,409); // no artist yet
    const proxy=await f.invoke('booths','createBoothArtist',{boothId:newBooth.body.booth.id,name:'작가'},'b');assert.equal(proxy.status,200,JSON.stringify(proxy.body));
    const sourceProfile=(await f.db.query("SELECT o.id FROM pos_stock_owners o WHERE o.origin_booth_id=$1",[boothId])).rows[0].id;
    for(const [bid,pid,operator] of [[boothId,sourceProfile,'a'],[newBooth.body.booth.id,proxy.body.profileId,'b']]) {
      const issued=await f.invoke('booths','issueArtistInvitation',{boothId:bid,profileId:pid},operator);
      assert.equal((await f.invoke('booths','acceptArtistInvitation',{token:issued.body.invitation.token,acceptSharedStock:true},'c')).status,200);
    }
    const home=await f.invoke('booths',null,{},'c',{query:{artists:'history'}});assert.equal(home.body.profiles.length,2);assert.equal(home.body.booths.length,0);
    assert.notEqual(home.body.profiles[0].owner_id,home.body.profiles[1].owner_id);
    const unmapped=await f.invoke('booths','createBoothArtist',{boothId,name:'미지정'});assert.equal(unmapped.status,400);
  }finally{await f.db.close();}
});

test('dry-run does not create migration tables; apply/replay preserve source IDs, stock, settlement and snapshot',async()=>{
  const f=await fixture();try{
    const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
    const preview=await f.invoke('booths','previewLegacy');assert.equal(preview.status,200);
    assert.equal((await f.db.query("SELECT to_regclass('pos_booths') AS name")).rows[0].name,null);
    assert.equal((await f.invoke('booths','migrateLegacy',{expectedFingerprint:before.fingerprint})).status,403);
    assert.equal((await f.invoke('booths','migrateLegacy',{password:'test-password',expectedFingerprint:'stale'})).status,409);
    const migrated=await f.migrate();assert.deepEqual(migrated.report,before);
    const source=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));assert.deepEqual(source,before);
    const again=await f.migrate();assert.equal(again.boothId,migrated.boothId);
    const count=async table=>Number((await f.db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n);
    assert.equal(await count('pos_booths'),1);assert.equal(await count('pos_inventory_openings'),1);
    assert.equal(await count('pos_booth_migrations'),1);assert.equal(await count('pos_recipients'),1);
    const artist=(await f.db.query('SELECT * FROM pos_stock_owners')).rows[0];assert.equal(artist.linked_user_id,null);
    assert.equal((await f.db.query('SELECT kind FROM pos_stock_owners')).rows[0].kind,'unverified');
    const state=await f.invoke('pos',null,{},'a',{query:{projectId:f.event}});
    assert.equal(state.status,200);assert.equal(state.body.boothId,migrated.boothId);assert.equal(state.body.products[0].stock,10);
    assert.equal(state.body.recipientMappings.length,1);
  }finally{await f.db.close();}
});

test('failed migration rolls back all mappings, can retry, and cannot change a different account',async()=>{
  const f=await fixture();try{
    await foundation.initBoothFoundation(f.sql);
    await f.db.exec("CREATE FUNCTION fail_mapping() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;CREATE TRIGGER fail_mapping BEFORE INSERT ON pos_inventory_owners FOR EACH ROW EXECUTE FUNCTION fail_mapping()");
    const preview=(await f.invoke('booths','previewLegacy')).body;
    assert.equal((await f.invoke('booths','migrateLegacy',{password:'test-password',expectedFingerprint:preview.report.fingerprint,adminId:'b'})).status,500);
    assert.equal(Number((await f.db.query('SELECT COUNT(*) AS n FROM pos_booths')).rows[0].n),0);
    assert.equal((await f.db.query('SELECT stock_qty FROM pos_products WHERE project_id=$1',[f.event])).rows[0].stock_qty,10);
    await f.db.exec('DROP TRIGGER fail_mapping ON pos_inventory_owners');await f.migrate();
    assert.deepEqual((await f.db.query('SELECT legacy_admin_id FROM pos_booths')).rows.map(r=>r.legacy_admin_id),['a']);
  }finally{await f.db.close();}
});

test('migrated legacy POS preserves sale IDs, replay/void and historical recipients; lifecycle replacement is rejected',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const sale={localOrderId:'same-offline-id',method:'cash',total:0,cart:[{type:'product',id:'p',name:'무료 상품',creatorName:'작가',qty:2,unitPrice:0}]};
    const extra={body:{action:'finalizeSale',projectId:f.event,payload:sale}};
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',extra)).status,200);
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',extra)).status,200);
    assert.equal((await f.db.query('SELECT stock_qty FROM pos_products WHERE project_id=$1',[f.event])).rows[0].stock_qty,8);
    const foreign=await f.invoke('pos',null,{},'b',{query:{boothId,projectId:f.event}});assert.equal(foreign.status,403);
    const wrongEvent=await f.invoke('pos',null,{},'a',{query:{boothId,projectId:'foreign'}});assert.equal(wrongEvent.status,404);
    for(const action of ['restoreAccount','deleteAccount','clearSales']) {
      const res=await f.invoke('pos',action,{projectId:f.event},'a',{body:{action,projectId:action==='restoreAccount'||action==='deleteAccount'?undefined:f.event,payload:{}}});
      assert.equal(res.status,409,action+JSON.stringify(res.body));
    }
    const mappings=(await foundation.recipientMap(f.sql,'a'));
    const recipient=mappings.find(r=>r.legacy_creator==='작가').recipient_id;
    await f.db.query("UPDATE pos_recipients SET display_name='새 이름' WHERE id=$1",[recipient]);
    const ledger=await f.invoke('settlements');assert.equal(ledger.status,200);assert.equal(ledger.body.settlements[0].recipientId,recipient);
    const command={action:'saveDeductions',projectId:f.event,recipientId:recipient,version:1,requestId:crypto.randomUUID(),deductions:[]};
    const saved=await f.invoke('settlements','saveDeductions',{},'a',{body:command});assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.settlement.recipientId,recipient);
    const cancelled=await f.invoke('pos','voidSale',{},'a',{body:{action:'voidSale',projectId:f.event,payload:{id:'same-offline-id'}}});assert.equal(cancelled.status,200);
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',extra)).body.products[0].stock,10);
  }finally{await f.db.close();}
});

test('artist and active booth operators share total stock; sellers and ended participation cannot edit it',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const {owner_id:ownerId}=(await f.db.query('SELECT owner_id FROM pos_inventory_owners')).rows[0];
    await f.db.query("INSERT INTO pos_booth_members VALUES($1,'b','manager','active'),($1,'c','seller','active')",[boothId]);
    await f.db.query("INSERT INTO pos_owner_members VALUES($1,'b')",[ownerId]);
    const request={ownerId,inventoryId:f.item.id,boothId,requestId:crypto.randomUUID(),version:f.item.version,totalStock:15,reason:'receipt'};
    const result=await f.invoke('booths','adjustOwnerStock',request,'b');assert.equal(result.status,200,JSON.stringify(result.body));
    assert.equal(result.body.warehouse,5);assert.equal(result.body.change.actorId,'b');assert.equal(result.body.change.boothId,boothId);
    assert.deepEqual((await f.invoke('booths','adjustOwnerStock',request,'b')).body,result.body);
    assert.equal((await f.invoke('booths','adjustOwnerStock',{...request,totalStock:16},'b')).status,409);
    assert.equal((await f.invoke('booths','adjustOwnerStock',{...request,requestId:crypto.randomUUID()},'a')).status,409);
    assert.equal((await f.invoke('booths','adjustOwnerStock',{...request,version:result.body.version,totalStock:9,requestId:crypto.randomUUID()},'a')).status,400);
    assert.equal((await f.invoke('booths','adjustOwnerStock',{...request,requestId:crypto.randomUUID()},'c')).status,403);
    await f.db.query("UPDATE pos_booth_artists SET status='ended' WHERE booth_id=$1 AND owner_id=$2",[boothId,ownerId]);
    assert.equal((await f.invoke('booths','adjustOwnerStock',{...request,requestId:crypto.randomUUID()},'a')).status,403);
    const own=await f.invoke('booths','adjustOwnerStock',{...request,boothId:undefined,version:result.body.version,totalStock:14,reason:'correction',requestId:crypto.randomUUID()},'b');
    assert.equal(own.status,200,JSON.stringify(own.body));assert.equal(own.body.warehouse,4);
    const legacyAttempt=await f.invoke('pos','saveInventory',{product:{...f.item,version:own.body.version,stock:5}});
    assert.equal(legacyAttempt.status,403,'old inventory writes cannot bypass ended participation');
    assert.deepEqual((await f.invoke('pos','listInventory')).body.inventory,[],'ended booth cannot read the artist global inventory');
    assert.equal((await f.db.query('SELECT stock_qty FROM pos_products WHERE project_id=$1',[f.event])).rows[0].stock_qty,10);
  }finally{await f.db.close();}
});

test('new orders derive identities on the server, preserve void snapshots and export signed foundation backups',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const identity=(await f.db.query('SELECT * FROM pos_event_product_identities')).rows[0];
    const snapshotBefore=(await f.db.query('SELECT source_fingerprint,source_snapshot FROM pos_booth_migrations')).rows[0];
    const body={protocolVersion:2,actorId:'a',boothId,action:'finalizeSale',projectId:f.event,payload:{localOrderId:'v2-sale',method:'cash',total:0,
      cart:[{type:'product',id:'p',name:'무료 상품',qty:1,unitPrice:0,creatorName:'spoof',ownerId:'foreign',recipientId:'foreign'}]}};
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body:{...body,actorId:'b'}})).status,403);
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body})).status,200);
    const line=(await f.db.query("SELECT lines FROM pos_sales WHERE id='v2-sale'")).rows[0].lines[0];
    assert.equal(line.ownerId,identity.owner_id);assert.equal(line.recipientId,identity.recipient_id);assert.equal(line.creatorName,'작가');
    const voided=await f.invoke('pos','voidSale',{},'a',{body:{protocolVersion:2,actorId:'a',boothId,action:'voidSale',projectId:f.event,payload:{id:'v2-sale'}}});assert.equal(voided.status,200);
    const history=(await f.db.query("SELECT snapshot,voided FROM pos_booth_sale_history WHERE sale_id='v2-sale'")).rows[0];
    assert.equal(history.voided,true);assert.equal(history.snapshot.lines[0].recipientId,identity.recipient_id);
    const item=(await f.invoke('pos','listInventory')).body.inventory[0];
    assert.equal((await f.invoke('pos','saveInventory',{product:{...item,stock:1}})).status,200);
    const audit=(await f.db.query("SELECT actor_id,booth_id,result FROM pos_owner_commands WHERE result->>'action'='saveInventory'")).rows[0];
    assert.equal(audit.actor_id,'a');assert.equal(audit.booth_id,boothId);assert.equal(audit.result.change.after.warehouse,1);
    const backup=(await f.invoke('pos','backupAccount')).body.backup;
    assert.equal(backup.data.version,2);assert.equal(backup.data.foundation.boothId,boothId);assert.match(backup.signature,/^[a-f0-9]{64}$/);
    assert.equal(backup.data.foundation.tables.pos_booth_sale_history[0].voided,true);
    const migration=backup.data.foundation.tables.pos_booth_migrations[0];
    assert.equal(foundation.foundationReport(migration.source_snapshot).fingerprint,migration.source_fingerprint,'JSONB key ordering must not invalidate the stored source fingerprint');
    assert.deepEqual((await f.db.query('SELECT source_fingerprint,source_snapshot FROM pos_booth_migrations')).rows[0],snapshotBefore);
    const account=await f.invoke('pos',null,{},'a',{query:{account:'true'}});
    assert.equal(account.body.compatibility.restoreAllowed,false);
  }finally{await f.db.close();}
});

test('shared operators cannot edit linked artist product originals or inspect another booth allocation',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const ownerId=(await f.db.query('SELECT owner_id FROM pos_inventory_owners')).rows[0].owner_id;
    await f.db.query("UPDATE pos_stock_owners SET link_status='linked',linked_user_id='b' WHERE id=$1",[ownerId]);
    await f.db.query("INSERT INTO pos_owner_members VALUES($1,'b')",[ownerId]);
    const view=await f.invoke('booths',null,{},'a',{query:{ownerId,boothId}});
    assert.equal(view.status,200);assert.equal(view.body.inventory[0].totalStock,10);
    assert.equal(view.body.inventory[0].allocations,undefined);assert.equal(view.body.inventory[0].cost,undefined);
    const inventory=(await f.invoke('pos','listInventory')).body.inventory[0];
    assert.equal(inventory.ownerId,ownerId);assert.ok(inventory.artistId);
    const attempt=await f.invoke('pos','saveInventory',{product:{...inventory,version:inventory.version,name:'운영자의 변경'}});
    assert.equal(attempt.status,403,JSON.stringify(attempt.body));
    await assert.rejects(foundation.imageScope(f.sql,'a',{boothId,inventoryId:f.item.id}),error=>error.status===403);
    await f.db.query("UPDATE pos_booth_members SET status='ended' WHERE booth_id=$1 AND user_id='a'",[boothId]);
    assert.equal((await f.invoke('booths','previewLegacy')).status,403);
    // Personal credentials/profile remain independent of lost booth membership.
    assert.equal((await f.invoke('pos',null,{},'a',{query:{account:'true'}})).status,200);
    assert.equal((await f.invoke('pos','deleteAccount',{confirmId:'b',password:'test-password'},'b')).status,409,'linked artist assets cannot be deleted through an unmigrated personal account');
    await assert.rejects(foundation.imageScope(f.sql,'a',{inventoryId:f.item.id}),error=>error.status===403);
  }finally{await f.db.close();}
});

test('creator display changes do not split recipients or duplicate event cost participants',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const before=(await foundation.recipientMap(f.sql,'a'))[0].recipient_id;
    const item=(await f.invoke('pos','listInventory')).body.inventory[0];
    const saved=await f.invoke('pos','saveInventory',{product:{...item,creatorName:'새 작가명'}});
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    const body={protocolVersion:2,actorId:'a',boothId,action:'finalizeSale',projectId:f.event,payload:{localOrderId:'renamed',method:'cash',total:0,cart:[{type:'product',id:'p',name:'상품',qty:1,unitPrice:0}]}};
    assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body})).status,200);
    const info=await f.invoke('settlements',null,{},'a',{query:{projectId:f.event}});assert.equal(info.status,200);
    assert.equal(info.body.state.products[0].creatorName,'새 작가명');
    const preview=eventSettlementPreview(info.body.state,[{label:'비용',memo:'',type:'fixed',value:10,split:'equal'}],info.body.settlements);
    assert.equal(preview.rows.length,1);assert.equal(preview.rows[0].fees,10);
    assert.equal((await foundation.recipientMap(f.sql,'a')).length,1);
    assert.equal((await foundation.recipientMap(f.sql,'a'))[0].recipient_id,before);
  }finally{await f.db.close();}
});

test('legacy opening projection retains sold counts, unknown deductions and zero-opening baselines',()=>{
  const source={links:[{inventory_id:'i',project_id:'e',product_id:'p'}],products:[{project_id:'e',id:'p',initial_stock_qty:0,stock_qty:4}],sales:[{project_id:'e',lines:[{type:'product',id:'p',qty:2}]}],bundles:[],movements:[]};
  let balance=foundation.inventoryBalance(source,{id:'i',stock:3});
  assert.equal(balance.totalStock,9);assert.equal(balance.remaining,7);assert.equal(balance.unavailable,6);
  source.products[0].initial_stock_qty=8;balance=foundation.inventoryBalance(source,{id:'i',stock:3});
  assert.equal(balance.totalStock,11);assert.equal(balance.allocations[0].historicalDeduction,2);
  source.movements.push({request:{projectId:'e',productId:'p',quantity:1}});
  balance=foundation.inventoryBalance(source,{id:'i',stock:3});assert.equal(balance.allocations[0].historicalDeduction,1);
});
test('event assistants can sell/configure only their assigned event; ordinary artists receive no full POS or settlement access',async()=>{
 const f=await fixture();try {
  const {boothId}=await f.migrate();
  let home=await f.invoke('booths',null,{},'a',{query:{workspace:'home'}});assert.equal(home.status,200,JSON.stringify(home.body));
  const profile=(await f.db.query("SELECT o.id,o.id AS owner_id FROM pos_stock_owners o WHERE o.display_name='작가'" )).rows[0];
  const invite=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});
  assert.equal((await f.invoke('booths','acceptArtistInvitation',{token:invite.body.invitation.token,acceptSharedStock:true},'b')).status,200);
  home=await f.invoke('booths',null,{},'b',{query:{workspace:'home'}});
  assert.equal(home.body.events[0].permissions.canSell,false);assert.equal(home.body.events[0].permissions.ownerIds[0],profile.owner_id);
  assert.equal((await f.invoke('pos',null,{},'b',{query:{boothId,projectId:f.event}})).status,403);
  const grant={boothId,projectId:f.event,targetUserId:'b',role:'assistant',status:'active',version:0,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveEventAccess',grant,'b')).status,403);
  assert.equal((await f.invoke('booths','saveEventAccess',grant)).status,200);
  assert.equal((await f.invoke('booths','saveEventAccess',grant)).status,200);
  assert.equal((await f.invoke('pos',null,{},'b',{query:{boothId,projectId:f.event}})).status,200);
  assert.equal((await f.invoke('settlements',null,{},'b',{query:{boothId,projectId:f.event}})).status,403);
  const day=(await f.db.query("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Seoul')::date::text AS day")).rows[0].day;
  assert.equal((await f.invoke('booths','saveEventStockSchedule',{boothId,projectId:f.event,startsOn:day,endsOn:day,requestId:crypto.randomUUID()})).status,200);
  const stock=(await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:profile.owner_id,boothId,projectId:f.event}})).body;
  assert.equal(stock.events[0].operator,true);
  const own=stock.inventory[0];
  assert.equal((await f.invoke('booths','setArtistAllocation',{ownerId:profile.owner_id,boothId,id:own.id,version:own.version,projectId:f.event,quantity:9,requestId:crypto.randomUUID()},'b')).status,200);
  const other=(await f.invoke('pos','createProject',{name:'다른 행사'},'a',{body:{action:'createProject',boothId,payload:{name:'다른 행사'}}})).body.project.id;
  assert.equal((await f.invoke('pos',null,{},'b',{query:{boothId,projectId:other}})).status,403);
  let access=await f.invoke('booths',null,{},'a',{query:{workspace:'access',boothId,projectId:f.event}});
  const staff=access.body.staff[0];assert.equal(staff.role,'assistant');
  assert.equal((await f.invoke('booths','saveEventAccess',{...grant,status:'ended',version:staff.version,requestId:crypto.randomUUID()})).status,200);
  assert.equal((await f.invoke('pos',null,{},'b',{query:{boothId,projectId:f.event}})).status,403);
  const after=(await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:profile.owner_id,boothId,projectId:f.event}})).body.inventory[0];
  assert.equal((await f.invoke('booths','setArtistAllocation',{ownerId:profile.owner_id,boothId,id:after.id,version:after.version,projectId:f.event,quantity:8,requestId:crypto.randomUUID()},'b')).status,403,'ordinary artist remains read-only on event day after delegation is revoked');
 }finally{await f.db.close();}
});

test('physical artist/event storage replacement preserves originals and supports POS writes plus schema-only recovery after a new sale',async()=>{
 const f=await fixture();try {
  const {boothId}=await f.migrate();
  const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
  const shape=await storageShape(f.db);
  await f.db.query('BEGIN');const migration=await replaceStorageNames(f.db);await f.db.query('COMMIT');
  assert.equal(migration.alreadyApplied,false);
  assert.equal((await f.db.query("SELECT to_regclass('pos_inventory') AS name")).rows[0].name,null);
  const sql=await storageContract.canonicalSql(f.sql);
  assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(sql,'a')),before);
  let read=await f.invoke('pos',null,{},'a',{query:{boothId,projectId:f.event}});assert.equal(read.status,200,JSON.stringify(read.body));
  const sale={action:'finalizeSale',boothId,projectId:f.event,actorId:'a',protocolVersion:2,payload:{localOrderId:'canonical-sale',method:'cash',total:0,cart:[{type:'product',id:'p',qty:1,unitPrice:0,creatorName:'작가'}]}};
  assert.equal((await f.invoke('pos','finalizeSale',{},'a',{body:sale})).status,200);
  const after=foundation.foundationReport(await foundation.legacySnapshot(sql,'a'));
  assert.equal(after.counts.sales,before.counts.sales+1);
  await f.db.query('BEGIN');await restoreStorageNames(f.db,shape);await f.db.query('COMMIT');
  assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a')),after);
  assert.equal((await f.invoke('pos',null,{},'a',{query:{boothId,projectId:f.event}})).status,200);
 }finally{await f.db.close();}
});
test('personal batch import is atomic and idempotent, permits free stock and scopes master edits to the artist',async()=>{
 const f=await fixture();try {
  await f.migrate();
  const home=await f.invoke('booths','createArtistProfile',{name:'개인 작가'},'b');
  const ownerId=home.body.profiles[0].owner_id;
  const payload={ownerId,requestId:crypto.randomUUID(),products:[{id:'one',name:'무료 굿즈',price:0,cost:0,stock:20,goodsType:'키링'},{id:'two',name:'다른 굿즈',price:500,cost:100,stock:50}]};
  assert.equal((await f.invoke('booths','importArtistStock',payload,'c')).status,403);
  const result=await f.invoke('booths','importArtistStock',payload,'b');assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.inventory[0].price,0);assert.equal(result.body.inventory[0].totalStock,20);
  const repeated=await f.invoke('booths','importArtistStock',payload,'b');assert.deepEqual(repeated.body,result.body);
  const count=(await f.db.query("SELECT COUNT(*)::int AS n FROM pos_inventory WHERE admin_id='b'")).rows[0].n;
  const invalid={...payload,requestId:crypto.randomUUID(),products:[{id:'three',name:'롤백할 상품',price:0,stock:1},{id:'four',name:'잘못된 상품',price:-1,stock:1}]};
  assert.equal((await f.invoke('booths','importArtistStock',invalid,'b')).status,400);
  assert.equal((await f.db.query("SELECT COUNT(*)::int AS n FROM pos_inventory WHERE admin_id='b'")).rows[0].n,count);
  const item=result.body.inventory[0];
  const edit={ownerId,id:item.id,version:item.version,product:{name:'새 이름',price:0,cost:0,goodsType:'키링'},requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveArtistProduct',edit,'c')).status,403);
  const saved=await f.invoke('booths','saveArtistProduct',edit,'b');assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.inventory.name,'새 이름');assert.equal(saved.body.inventory.totalStock,20);
 }finally{await f.db.close();}
});
test('booth information and common member changes are scoped, replayable and owner-controlled without altering original transactions',async()=>{
 const f=await fixture();try {
  const {boothId}=await f.migrate();await f.invoke('booths',null,{},'a',{query:{workspace:'home'}});
  const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
  const read=await f.invoke('booths',null,{},'a',{query:{workspace:'booth',boothId}});assert.equal(read.status,200,JSON.stringify(read.body));
  const rename={boothId,name:'새 부스',expectedName:read.body.name,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveBoothManagement',rename,'b')).status,403);
  assert.equal((await f.invoke('booths','saveBoothManagement',rename)).status,200);
  assert.equal((await f.invoke('booths','saveBoothManagement',rename)).status,200);
  const profile=(await f.db.query("SELECT o.id FROM pos_stock_owners o WHERE o.display_name='작가'" )).rows[0];
  const invite=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});
  await f.invoke('booths','acceptArtistInvitation',{token:invite.body.invitation.token,acceptSharedStock:true},'b');
  const grant={boothId,targetUserId:'b',role:'manager',status:'active',expectedRole:null,expectedStatus:null,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveBoothManagement',grant)).status,200);
  assert.equal((await f.invoke('booths','saveBoothManagement',{...grant,targetUserId:'a',requestId:crypto.randomUUID()},'b')).status,403);
  assert.equal((await f.invoke('booths','saveBoothManagement',{...grant,status:'ended',expectedRole:'manager',expectedStatus:'active',requestId:crypto.randomUUID()})).status,200);
  assert.equal((await f.invoke('booths',null,{},'b',{query:{workspace:'booth',boothId}})).status,403);
  assert.deepEqual(foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a')),before);
 }finally{await f.db.close();}
});


test('event product direct artist and administrator choices register atomically, replay and link later without changing stock',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const query={workspace:'stockParticipants',projectId:f.event,boothId};
  const choices=await f.invoke('booths',null,{},'a',{query});assert.equal(choices.status,200,JSON.stringify(choices.body));
  assert.ok(choices.body.profiles.some(p=>p.owner_id==='admin:a'));
  const payload={boothId,projectId:f.event,artistName:'직접 작가',name:'직접 상품',goodsType:'키링',price:0,quantity:4,requestId:crypto.randomUUID()};
  const registered=await f.invoke('booths','registerEventArtistProduct',payload);assert.equal(registered.status,200,JSON.stringify(registered.body));
  const item=registered.body.inventory;assert.equal(item.creatorName,'직접 작가');assert.equal(item.totalStock,4);assert.equal(item.allocations[0].remaining,4);
  const replay=await f.invoke('booths','registerEventArtistProduct',payload);assert.equal(replay.status,200);assert.equal(replay.body.inventory.id,item.id);
  assert.equal((await f.invoke('booths','registerEventArtistProduct',{...payload,name:'다른 상품'})).status,409);
  const view=await f.invoke('booths',null,{},'a',{query:{workspace:'access',projectId:f.event,boothId}});
  const profile=view.body.profiles.find(p=>p.owner_id===item.ownerId);assert.ok(profile);assert.equal(profile.status,'active');assert.equal(profile.linked_user_id,null);
  const invitation=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});assert.equal(invitation.status,200);
  assert.equal((await f.invoke('booths','acceptArtistInvitation',{token:invitation.body.invitation.token,acceptSharedStock:true},'b')).status,200);
  const linked=await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId:item.ownerId}});assert.equal(linked.status,200);assert.equal(linked.body.inventory.find(p=>p.id===item.id).totalStock,4);
  const admin=await f.invoke('booths','registerEventArtistProduct',{...payload,artistName:undefined,ownerId:'admin:a',requestId:crypto.randomUUID()});assert.equal(admin.status,200,JSON.stringify(admin.body));
  assert.equal((await f.sql`SELECT linked_user_id FROM pos_stock_owners WHERE id=${admin.body.inventory.ownerId}`).rows[0].linked_user_id,'a');
  assert.equal((await f.invoke('booths','registerEventArtistProduct',{...payload,requestId:crypto.randomUUID()},'c')).status,403);
  const bad=await f.invoke('booths','registerEventArtistProduct',{...payload,artistName:'롤백 작가',quantity:-1,requestId:crypto.randomUUID()});assert.equal(bad.status,400);
  assert.equal((await f.sql`SELECT id FROM pos_stock_owners WHERE display_name='롤백 작가'`).rows.length,0);
  const latest=await f.invoke('booths',null,{},'a',{query});assert.equal(latest.body.profiles.find(p=>p.owner_id===item.ownerId).catalog,true);
 }finally{await f.db.close();}
});


test('event detail saves original fields and event-only price atomically and scopes loss history',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const created=await f.invoke('booths','registerEventArtistProduct',{boothId,projectId:f.event,artistName:'상세 작가',name:'원본 상품',goodsType:'키링',price:1000,quantity:10,requestId:crypto.randomUUID()});assert.equal(created.status,200,JSON.stringify(created.body));
  const item=created.body.inventory;
  const payload={ownerId:item.ownerId,boothId,id:item.id,projectId:f.event,version:item.version,product:{name:'수정 상품',goodsType:'키링',vtuberName:'캐릭터',genre:'장르',creatorName:item.creatorName,price:2000},requestId:crypto.randomUUID()};
  const saved=await f.invoke('booths','saveEventArtistProduct',payload);assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.inventory.name,'수정 상품');assert.equal(saved.body.inventory.price,1000);assert.equal(saved.body.inventory.allocations[0].price,2000);assert.equal(saved.body.inventory.totalStock,10);
  const retry=await f.invoke('booths','saveEventArtistProduct',payload);assert.equal(retry.status,200);assert.deepEqual(retry.body,saved.body);
  assert.equal((await f.invoke('booths','saveEventArtistProduct',{...payload,product:{...payload.product,price:3000}})).status,409);
  assert.equal((await f.invoke('booths','saveEventArtistProduct',{...payload,requestId:crypto.randomUUID()})).status,409);
  const loss=await f.invoke('booths','recordArtistStockLoss',{ownerId:item.ownerId,boothId,id:item.id,projectId:f.event,version:saved.body.inventory.version,quantity:1,reason:'damage',memo:'메모',requestId:crypto.randomUUID()});assert.equal(loss.status,200,JSON.stringify(loss.body));
  const query={artists:'movements',ownerId:item.ownerId,boothId,projectId:f.event};
  const history=await f.invoke('booths',null,{},'a',{query});assert.equal(history.status,200,JSON.stringify(history.body));assert.equal(history.body.movements.length,1);assert.equal(history.body.movements[0].request.inventoryId,item.id);assert.equal(history.body.movements[0].request.memo,'메모');
  assert.equal((await f.invoke('booths',null,{},'c',{query})).status,403);
  assert.equal((await f.invoke('booths','saveEventArtistProduct',{...payload,version:loss.body.inventory.version,product:{...payload.product,creatorName:'다른 작가'},requestId:crypto.randomUUID()})).status,400);
  const rollback={...payload,version:loss.body.inventory.version,product:{...payload.product,name:'롤백 이름',price:4000},requestId:crypto.randomUUID()};
  await f.db.exec("CREATE FUNCTION fail_detail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result->>'action'='saveEventArtistProduct' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_detail_receipt BEFORE INSERT ON pos_shared_stock_commands FOR EACH ROW EXECUTE FUNCTION fail_detail_receipt()");
  assert.equal((await f.invoke('booths','saveEventArtistProduct',rollback)).status,500);
  const original=(await f.sql`SELECT product,version FROM pos_inventory WHERE admin_id=${item.custodianId} AND id=${item.inventoryId}`).rows[0];assert.equal(original.product.name,'수정 상품');assert.equal(original.version,loss.body.inventory.version);
  await f.db.exec('DROP TRIGGER fail_detail_receipt ON pos_shared_stock_commands');
  const recovered=await f.invoke('booths','saveEventArtistProduct',rollback);assert.equal(recovered.status,200,JSON.stringify(recovered.body));assert.equal(recovered.body.inventory.allocations[0].price,4000);

 }finally{await f.db.close();}
});


test('event manager searches and links an unlinked artist, counts products and assigns event-scoped participant/assistant roles',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  await f.sql`UPDATE pos_admins SET nickname='찾을작가',email='artist@example.test',avatar='data:image/png;base64,YQ==' WHERE id='b'`;
  const query={workspace:'access',projectId:f.event,boothId};
  const view=await f.invoke('booths',null,{},'a',{query});assert.equal(view.status,200,JSON.stringify(view.body));
  const profile=view.body.profiles.find(p=>!p.linked_user_id&&p.status==='active');assert.ok(profile);assert.equal(profile.product_count,1);
  const search={workspace:'searchAccounts',projectId:f.event,boothId,q:'찾을'};
  const found=await f.invoke('booths',null,{},'a',{query:search});assert.equal(found.status,200,JSON.stringify(found.body));assert.equal(found.body.accounts[0].id,'b');assert.equal(found.body.accounts[0].email,undefined);
  assert.equal((await f.invoke('booths',null,{},'c',{query:search})).status,403);
  assert.equal((await f.invoke('booths',null,{},'a',{query:{...search,q:'a'}})).status,400);
  assert.equal((await f.invoke('booths',null,{},'a',{query:{...search,q:'artist@example.test'}})).body.accounts[0].id,'b');
  const before=await foundation.legacySnapshot(f.sql,'a');
  const payload={projectId:f.event,boothId,profileId:profile.id,targetUserId:'b',requestId:crypto.randomUUID()};
  await f.db.exec("CREATE FUNCTION reject_operator_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='profile_linked_by_operator' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_operator_link BEFORE INSERT ON pos_artist_link_audit FOR EACH ROW EXECUTE FUNCTION reject_operator_link()");
  assert.equal((await f.invoke('booths','linkEventArtistAccount',payload)).status,500);
  assert.equal((await f.sql`SELECT linked_user_id FROM pos_stock_owners WHERE id=${profile.id}`).rows[0].linked_user_id,null);
  await f.db.exec('DROP TRIGGER reject_operator_link ON pos_artist_link_audit');
  const linked=await f.invoke('booths','linkEventArtistAccount',payload);assert.equal(linked.status,200,JSON.stringify(linked.body));
  assert.deepEqual((await f.invoke('booths','linkEventArtistAccount',payload)).body,linked.body);
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{...payload,targetUserId:'c'})).status,409);
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{...payload,targetUserId:'c',requestId:crypto.randomUUID()})).status,409);
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.sales,before.sales);
  const refreshed=await f.invoke('booths',null,{},'a',{query});assert.equal(refreshed.body.profiles.find(p=>p.id===profile.id).nickname,'찾을작가');
  assert.equal(refreshed.body.profiles.find(p=>p.id===profile.id).avatar,'data:image/png;base64,YQ==');
  assert.equal(refreshed.body.profiles.find(p=>p.id===profile.id).email,undefined);
  let access=await f.invoke('booths','saveEventAccess',{projectId:f.event,boothId,targetUserId:'b',role:'seller',status:'active',version:0,requestId:crypto.randomUUID()});assert.equal(access.status,200,JSON.stringify(access.body));
  let permission=await eventAccess.eventPermissions(f.sql,'b',f.event);assert.equal(permission.permissions.canSell,true);assert.equal(permission.permissions.canConfigure,false);assert.equal(permission.permissions.canManage,false);
  access=await f.invoke('booths','saveEventAccess',{projectId:f.event,boothId,targetUserId:'b',role:'assistant',status:'active',version:1,requestId:crypto.randomUUID()});assert.equal(access.status,200);
  permission=await eventAccess.eventPermissions(f.sql,'b',f.event);assert.equal(permission.permissions.canConfigure,true);assert.equal(permission.permissions.canManage,false);
  assert.equal((await f.invoke('booths',null,{},'b',{query:search})).status,403);
  const extra=await f.invoke('booths','registerEventArtistProduct',{projectId:f.event,boothId,artistName:'역할 작가',name:'권한 상품',goodsType:'키링',quantity:0,price:0,requestId:crypto.randomUUID()});assert.equal(extra.status,200);
  const extraProfile=(await f.sql`SELECT id FROM pos_stock_owners WHERE id=${extra.body.inventory.ownerId}`).rows[0];
  const withRole=await f.invoke('booths','linkEventArtistAccount',{projectId:f.event,boothId,profileId:extraProfile.id,targetUserId:'c',role:'assistant',requestId:crypto.randomUUID()});assert.equal(withRole.status,200,JSON.stringify(withRole.body));
  const linkedPermission=await eventAccess.eventPermissions(f.sql,'c',f.event);assert.equal(linkedPermission.permissions.canConfigure,true);assert.equal(linkedPermission.permissions.canManage,false);

 }finally{await f.db.close();}
});


test('event artist search/add is atomic, replayable and grants only the selected event role without copying stock',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const home=await f.invoke('booths','createArtistProfile',{name:'검색 작가'},'b');assert.equal(home.status,200,JSON.stringify(home.body));
  const profile=home.body.profiles[0];
  const query={workspace:'searchArtists',projectId:f.event,boothId,q:'검색'};
  const found=await f.invoke('booths',null,{},'a',{query});assert.equal(found.status,200,JSON.stringify(found.body));assert.equal(found.body.artists[0].id,profile.id);assert.equal(found.body.artists[0].registered,false);
  assert.equal((await f.invoke('booths',null,{},'c',{query})).status,403);
  const before=await foundation.legacySnapshot(f.sql,'a');
  const payload={projectId:f.event,boothId,profileId:profile.id,role:'assistant',requestId:crypto.randomUUID()};
  await f.db.exec("CREATE FUNCTION reject_artist_add() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result->>'added'='true' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_artist_add BEFORE INSERT ON pos_event_access_commands FOR EACH ROW EXECUTE FUNCTION reject_artist_add()");
  assert.equal((await f.invoke('booths','addEventArtist',payload)).status,500);
  assert.equal((await f.sql`SELECT owner_id FROM pos_event_artists WHERE project_id=${f.event} AND owner_id=${profile.owner_id}`).rows.length,0);
  assert.equal((await f.sql`SELECT user_id FROM pos_event_staff WHERE project_id=${f.event} AND user_id='b'`).rows.length,0);
  await f.db.exec('DROP TRIGGER reject_artist_add ON pos_event_access_commands');
  const added=await f.invoke('booths','addEventArtist',payload);assert.equal(added.status,200,JSON.stringify(added.body));
  assert.deepEqual((await f.invoke('booths','addEventArtist',payload)).body,added.body);
  assert.equal((await f.invoke('booths','addEventArtist',{...payload,role:'seller'})).status,409);
  assert.equal((await f.invoke('booths','addEventArtist',{...payload,requestId:crypto.randomUUID()})).status,409);
  const permission=await eventAccess.eventPermissions(f.sql,'b',f.event);assert.equal(permission.permissions.canConfigure,true);assert.equal(permission.permissions.canManage,false);
  assert.equal((await f.invoke('booths',null,{},'a',{query})).body.artists[0].registered,true);
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.sales,before.sales);
  assert.equal((await f.invoke('booths','addEventArtist',{...payload,requestId:crypto.randomUUID()},'c')).status,403);
 }finally{await f.db.close();}
});


test('event invite link registers the accepting account as an event creator and rejects stale links',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const base={projectId:f.event,boothId};
  assert.equal((await f.invoke('booths','issueEventInvite',base,'c')).status,403);
  const first=await f.invoke('booths','issueEventInvite',base);assert.equal(first.status,200,JSON.stringify(first.body));
  const token=first.body.invite.token;
  await f.sql`INSERT INTO pos_event_details(project_id,venue) VALUES(${f.event},'코엑스') ON CONFLICT(project_id) DO UPDATE SET venue=EXCLUDED.venue`;
  await f.sql`INSERT INTO pos_event_stock_policy(project_id,starts_on,ends_on) VALUES(${f.event},'2026-12-05','2026-12-06') ON CONFLICT(project_id) DO UPDATE SET starts_on=EXCLUDED.starts_on,ends_on=EXCLUDED.ends_on`;
  const preview=await f.invoke('booths','previewEventInvite',{token},'b');assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.invitation.joined,false);
  assert.equal(preview.body.invitation.operatorName.length>0,true);assert.equal(preview.body.invitation.venue,'코엑스');assert.equal(preview.body.invitation.startsOn,'2026-12-05');assert.equal(preview.body.invitation.endsOn,'2026-12-06');
  assert.equal((await f.invoke('booths','acceptEventInvite',{token},'b')).status,400);
  const accepted=await f.invoke('booths','acceptEventInvite',{token,acceptSharedStock:true},'b');assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal(accepted.body.projectId,f.event);
  const again=await f.invoke('booths','acceptEventInvite',{token,acceptSharedStock:true},'b');assert.equal(again.status,200);
  assert.equal((await f.sql`SELECT e.owner_id FROM pos_event_artists e JOIN pos_stock_owners o ON o.id=e.owner_id WHERE e.project_id=${f.event} AND e.status='active' AND o.linked_user_id='b'`).rows.length,1);
  assert.equal((await f.invoke('booths','previewEventInvite',{token},'b')).body.invitation.joined,true);
  assert.equal((await eventAccess.eventPermissions(f.sql,'b',f.event)).permissions.canRead,true);
  assert.equal(Boolean((await f.sql`SELECT joined_at FROM pos_event_artists e JOIN pos_stock_owners o ON o.id=e.owner_id WHERE e.project_id=${f.event} AND o.linked_user_id='b'`).rows[0].joined_at),true);
  assert.equal((await f.sql`SELECT role,status FROM pos_event_staff WHERE project_id=${f.event} AND user_id='b'`).rows[0].role,'seller');
  const second=await f.invoke('booths','issueEventInvite',base);assert.equal(second.status,200);
  assert.equal((await f.invoke('booths','previewEventInvite',{token},'c')).status,409);
  assert.equal((await f.invoke('booths','previewEventInvite',{token:second.body.invite.token},'c')).status,200);
  assert.equal((await f.invoke('booths','previewEventInvite',{token:'bad'},'c')).status,404);
 }finally{await f.db.close();}
});

test('event product creator mapping changes only future attribution, supports unlink and preserves source stock and historical sales',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const candidates=await f.invoke('booths',null,{},'a',{query:{workspace:'stockParticipants',projectId:f.event,boothId}});const source=candidates.body.profiles.find(p=>p.catalog);
  const stock=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId:source.owner_id,boothId,projectId:f.event}});let item=stock.body.inventory[0];
  const other=await f.invoke('booths','registerEventArtistProduct',{projectId:f.event,boothId,artistName:'새 제작자',name:'대상 상품',goodsType:'키링',quantity:0,price:0,requestId:crypto.randomUUID()});assert.equal(other.status,200);
  const target=other.body.inventory.ownerId;
  const sold=await f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',boothId,projectId:f.event,protocolVersion:2,actorId:'a',payload:{localOrderId:'before-creator-change',method:'cash',total:0,cart:[{type:'product',id:item.allocations[0].productId,qty:1,unitPrice:0}]}}});assert.equal(sold.status,200,JSON.stringify(sold.body));
  const fresh=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId:source.owner_id,boothId,projectId:f.event}});item=fresh.body.inventory.find(row=>row.id===item.id);
  const before=await foundation.legacySnapshot(f.sql,'a');
  const payload={ownerId:item.ownerId,boothId,id:item.id,version:item.version,projectId:f.event,creatorOwnerId:target,requestId:crypto.randomUUID()};
  const changed=await f.invoke('booths','setEventProductCreator',payload);assert.equal(changed.status,200,JSON.stringify(changed.body));
  const identity=await foundation.productIdentity(f.sql,f.event,item.allocations[0].productId,boothId);assert.equal(identity.ownerId,target);
  assert.deepEqual((await f.invoke('booths','setEventProductCreator',payload)).body,changed.body);
  assert.equal((await f.invoke('booths','setEventProductCreator',{...payload,creatorOwnerId:item.ownerId})).status,409);
  const sourceOwner=(await f.sql`SELECT owner_id FROM pos_inventory_owners WHERE admin_id=${item.custodianId} AND inventory_id=${item.inventoryId}`).rows[0];assert.equal(sourceOwner.owner_id,item.ownerId);
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.sales,before.sales);assert.equal(changed.body.inventory.totalStock,item.totalStock);assert.equal(changed.body.inventory.creatorName,item.creatorName);
  const decorated=await foundation.decorateEventProducts(f.sql,'a',f.event,[{id:item.allocations[0].productId}]);assert.equal(decorated[0].eventCreator.name,'새 제작자');assert.equal(decorated[0].eventCreator.linked,false);
  const unlinked=await f.invoke('booths','setEventProductCreator',{...payload,version:changed.body.inventory.version,creatorOwnerId:null,requestId:crypto.randomUUID()});assert.equal(unlinked.status,200,JSON.stringify(unlinked.body));
  assert.equal((await foundation.decorateEventProducts(f.sql,'a',f.event,[{id:item.allocations[0].productId}]))[0].eventCreator,null);
  const again=await f.invoke('booths','setEventProductCreator',{...payload,version:unlinked.body.inventory.version,creatorOwnerId:item.ownerId,requestId:crypto.randomUUID()});assert.equal(again.status,200);
  assert.equal((await f.invoke('booths','setEventProductCreator',{...payload,version:again.body.inventory.version,creatorOwnerId:'outsider',requestId:crypto.randomUUID()})).status,403);
  assert.equal((await f.invoke('booths','setEventProductCreator',{...payload,version:again.body.inventory.version,requestId:crypto.randomUUID()},'c')).status,403);
  const revision=(await f.sql`SELECT revision FROM pos_event_archives WHERE project_id=${f.event}`).rows[0];assert.ok(revision.revision.startsWith('creator:'));
 }finally{await f.db.close();}
});


test('stock delegation preference immediately blocks operator quantities but preserves reads, sales, cancellations and 30/25 allocation floors',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const p=(await f.sql`SELECT id,id AS owner_id FROM pos_stock_owners ORDER BY id LIMIT 1`).rows[0];
  const invite=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:p.id});
  assert.equal((await f.invoke('booths','acceptArtistInvitation',{token:invite.body.invitation.token,acceptSharedStock:true,allowOperatorStock:false},'b')).status,200);
  const readPrefs=await f.invoke('booths',null,{},'b',{query:{workspace:'stockPreference'}});assert.equal(readPrefs.body.allowOperatorStock,false);
  const created=await f.invoke('booths','createArtistStock',{ownerId:p.owner_id,name:'하한 상품',price:100,quantity:30,requestId:crypto.randomUUID()},'b');assert.equal(created.status,200,JSON.stringify(created.body));
  let item=created.body.inventory;
  const stock=async()=>{const r=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId:p.owner_id,boothId}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
  const adjust=(total,reason='correction',actor='a')=>f.invoke('booths','adjustArtistStock',{ownerId:p.owner_id,boothId,id:item.id,version:item.version,totalStock:total,reason,requestId:crypto.randomUUID()},actor);
  assert.equal((await adjust(31,'receipt')).status,403);
  const preference=async allowed=>{const r=await f.invoke('booths','saveStockPreference',{allowOperatorStock:allowed,requestId:crypto.randomUUID()},'b');assert.equal(r.status,200,JSON.stringify(r.body));};
  await preference(true);
  const e2=(await f.invoke('pos','createProject',{name:'B 행사'})).body.project.id;
  assert.equal((await f.invoke('booths','saveEventAccess',{boothId,projectId:e2,ownerId:p.owner_id,status:'active',version:0,requestId:crypto.randomUUID()})).status,200);
  const allocation=async(projectId,quantity)=>{const r=await f.invoke('booths','setArtistAllocation',{ownerId:p.owner_id,boothId,id:item.id,version:item.version,projectId,quantity,price:100,requestId:crypto.randomUUID()});if(r.status===200)item=r.body.inventory;return r;};
  assert.equal((await allocation(f.event,10)).status,200);assert.equal((await allocation(e2,20)).status,200);
  const productA=item.allocations.find(row=>row.projectId===f.event).productId,productB=item.allocations.find(row=>row.projectId===e2).productId;
  const sell=(eventId,productId,qty,key)=>f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',projectId:eventId,boothId,protocolVersion:2,actorId:'a',payload:{localOrderId:key,method:'cash',total:100*qty,cart:[{type:'product',id:productId,qty,unitPrice:100}]}}});
  assert.equal((await sell(f.event,productA,10,'floor-sale-a')).status,200);
  await f.sql`UPDATE pos_projects SET archived_at=NOW() WHERE id=${f.event}`;
  item=(await stock()).inventory.find(row=>row.id===item.id);assert.equal(item.minimumTotalStock,30);
  assert.equal((await adjust(29)).status,400);const thirty=await adjust(30);assert.equal(thirty.status,200);item=thirty.body.inventory;
  await preference(false);const read=await stock();assert.equal(read.quantityEditable,false);
  assert.equal((await adjust(40,'receipt')).status,403);assert.equal((await allocation(e2,15)).status,403);
  assert.equal((await f.invoke('booths','recordArtistStockLoss',{ownerId:p.owner_id,boothId,id:item.id,projectId:e2,version:item.version,quantity:1,reason:'loss',requestId:crypto.randomUUID()})).status,403);
  const priceOnly=await f.invoke('booths','saveEventArtistProduct',{ownerId:p.owner_id,boothId,id:item.id,version:item.version,projectId:e2,product:{...item,price:100},requestId:crypto.randomUUID()});
  assert.equal(priceOnly.status,200,JSON.stringify(priceOnly.body));item=priceOnly.body.inventory;
  assert.equal((await sell(e2,productB,1,'preference-off-sale')).status,200);
  const sale=(await f.sql`SELECT id FROM pos_sales WHERE project_id=${e2}`).rows[0];
  assert.equal((await f.invoke('pos','voidSale',{},'a',{body:{action:'voidSale',projectId:e2,boothId,protocolVersion:2,actorId:'a',payload:{id:sale.id,localOrderId:'preference-off-void'}}})).status,200);
  item=(await stock()).inventory.find(row=>row.id===item.id);assert.equal((await adjust(32,'receipt','b')).status,200);
  await preference(true);item=(await stock()).inventory.find(row=>row.id===item.id);
  assert.equal((await allocation(e2,15)).status,200);assert.equal(item.minimumTotalStock,25);
  const reduced=await adjust(25);assert.equal(reduced.status,200,JSON.stringify(reduced.body));assert.equal(reduced.body.inventory.totalStock,25);
 }finally{await f.db.close();}
});

test('search registration requires artist participation confirmation before operator stock writes and keeps existing opt-out on account linking',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const home=await f.invoke('booths','createArtistProfile',{name:'확인 작가'},'b');const profile=home.body.profiles[0];
  const created=await f.invoke('booths','createArtistStock',{ownerId:profile.owner_id,name:'참여 상품',quantity:10,price:0,requestId:crypto.randomUUID()},'b');assert.equal(created.status,200);
  const added=await f.invoke('booths','addEventArtist',{boothId,projectId:f.event,profileId:profile.id,role:'assistant',requestId:crypto.randomUUID()});assert.equal(added.status,200);
  const item=created.body.inventory;
  const adjust=()=>f.invoke('booths','adjustArtistStock',{ownerId:profile.owner_id,boothId,id:item.id,version:item.version,totalStock:11,reason:'receipt',requestId:crypto.randomUUID()});
  assert.equal((await adjust()).status,403);
  const confirm={ownerId:profile.owner_id,boothId,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','confirmStockParticipation',confirm,'a')).status,403);
  assert.equal((await f.invoke('booths','confirmStockParticipation',confirm,'b')).status,200);
  assert.equal((await adjust()).status,200);
  const off={allowOperatorStock:false,requestId:crypto.randomUUID()};assert.equal((await f.invoke('booths','saveStockPreference',off,'b')).status,200);
  assert.equal((await f.invoke('booths','saveStockPreference',off,'b')).status,200);
  assert.equal((await f.invoke('booths','saveStockPreference',{...off,allowOperatorStock:true},'b')).status,409);
  const proxy=await f.invoke('booths','createBoothArtist',{boothId,name:'기존 허용 보존'});
  await f.invoke('booths','saveEventAccess',{boothId,projectId:f.event,ownerId:(await f.sql`SELECT id AS owner_id FROM pos_stock_owners WHERE id=${proxy.body.profileId}`).rows[0].owner_id,status:'active',version:0,requestId:crypto.randomUUID()});
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{boothId,projectId:f.event,profileId:proxy.body.profileId,targetUserId:'b',requestId:crypto.randomUUID()})).status,200);
  assert.equal((await f.invoke('booths',null,{},'b',{query:{workspace:'stockPreference'}})).body.allowOperatorStock,false);
 }finally{await f.db.close();}
});


test('artist product removal preserves history, blocks active event products and replays safely',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const home=await f.invoke('booths','createArtistProfile',{name:'삭제 작가'},'b');const ownerId=home.body.profiles[0].owner_id;
  const created=await f.invoke('booths','createArtistStock',{ownerId,name:'삭제 상품',quantity:10,price:0,requestId:crypto.randomUUID()},'b');const item=created.body.inventory;
  const payload={ownerId,id:item.id,version:item.version,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','removeArtistStock',payload,'c')).status,403);
  const before=await foundation.legacySnapshot(f.sql,'b');
  const removed=await f.invoke('booths','removeArtistStock',payload,'b');assert.equal(removed.status,200,JSON.stringify(removed.body));
  assert.deepEqual((await f.invoke('booths','removeArtistStock',payload,'b')).body,removed.body);
  const stock=await f.invoke('booths',null,{},'b',{query:{artists:'stock',ownerId}});assert.equal(stock.body.inventory.length,0);
  const after=await foundation.legacySnapshot(f.sql,'b');assert.deepEqual(after.sales,before.sales);assert.equal(after.inventory[0].stock,before.inventory[0].stock);
  const profile=(await f.sql`SELECT o.id AS owner_id FROM pos_stock_owners o WHERE o.origin_booth_id IS NOT NULL LIMIT 1`).rows[0];
  const existing=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId:profile.owner_id,boothId}});const active=existing.body.inventory.find(i=>i.allocations.length);
  assert.equal((await f.invoke('booths','removeArtistStock',{ownerId:profile.owner_id,boothId,id:active.id,version:active.version,requestId:crypto.randomUUID()})).status,409);
 }finally{await f.db.close();}
});


test('creator-only registration has stable receipts and no selling role, and direct creator account linking preserves original inventory',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const home=await f.invoke('booths','createArtistProfile',{name:'검색 제작자'},'b');const existing=home.body.profiles[0];
  const added=await f.invoke('booths','addEventArtist',{projectId:f.event,boothId,profileId:existing.id,role:'none',requestId:crypto.randomUUID()});assert.equal(added.status,200,JSON.stringify(added.body));
  assert.equal((await f.sql`SELECT user_id FROM pos_event_staff WHERE project_id=${f.event} AND user_id='b'`).rows.length,0);
  const relation=(await f.sql`SELECT stock_management_confirmed FROM pos_booth_artists WHERE booth_id=${boothId} AND owner_id=${existing.owner_id}`).rows[0];assert.equal(relation.stock_management_confirmed,false);
  const rollback={projectId:f.event,boothId,name:'롤백 제작자',requestId:crypto.randomUUID()};
  await f.db.exec(`CREATE FUNCTION fail_creator_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${rollback.requestId}' THEN RAISE EXCEPTION 'injected receipt failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_creator_receipt BEFORE INSERT ON pos_event_access_commands FOR EACH ROW EXECUTE FUNCTION fail_creator_receipt()`);
  assert.equal((await f.invoke('booths','createEventCreator',rollback)).status,500);
  assert.equal((await f.sql`SELECT id FROM pos_stock_owners WHERE display_name='롤백 제작자'`).rows.length,0);
  await f.db.exec('DROP TRIGGER fail_creator_receipt ON pos_event_access_commands');
  assert.equal((await f.invoke('booths','createEventCreator',rollback)).status,200);
  const payload={projectId:f.event,boothId,name:'직접 제작자',requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','createEventCreator',payload,'c')).status,403);
  const made=await f.invoke('booths','createEventCreator',payload);assert.equal(made.status,200,JSON.stringify(made.body));
  assert.deepEqual((await f.invoke('booths','createEventCreator',payload)).body,made.body);
  assert.equal((await f.invoke('booths','createEventCreator',{...payload,name:'변경'})).status,409);
  const stock=await f.invoke('booths','registerEventArtistProduct',{projectId:f.event,boothId,ownerId:made.body.ownerId,name:'제작자 상품',goodsType:'키링',price:0,quantity:5,requestId:crypto.randomUUID()});assert.equal(stock.status,200,JSON.stringify(stock.body));
  const before=await foundation.legacySnapshot(f.sql,'a');
  const linked=await f.invoke('booths','linkEventArtistAccount',{projectId:f.event,boothId,profileId:made.body.profileId,targetUserId:'b',requestId:crypto.randomUUID()});assert.equal(linked.status,200,JSON.stringify(linked.body));
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.sales,before.sales);
  assert.equal((await f.sql`SELECT user_id FROM pos_event_staff WHERE project_id=${f.event} AND user_id='b'`).rows.length,0);
 }finally{await f.db.close();}
});


test('linked administrator with a legacy unspecified display is visible in event creator choices and detail without rewriting originals',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const query={workspace:'stockParticipants',projectId:f.event,boothId};
  const initial=await f.invoke('booths',null,{},'a',{query});const creator=initial.body.profiles.find(p=>p.catalog);
  await f.sql`UPDATE pos_admins SET nickname='어드민' WHERE id='a'`;
  await f.sql`UPDATE pos_stock_owners SET link_status='linked',linked_user_id='a' WHERE id=${creator.owner_id}`;
  await f.sql`INSERT INTO pos_owner_members(owner_id,user_id) VALUES(${creator.owner_id},'a') ON CONFLICT DO NOTHING`;
  await f.sql`UPDATE pos_stock_owners SET display_name='미지정' WHERE id=${creator.owner_id}`;
  const before=await foundation.legacySnapshot(f.sql,'a');
  const choices=await f.invoke('booths',null,{},'a',{query});assert.equal(choices.status,200,JSON.stringify(choices.body));
  const admin=choices.body.profiles.find(p=>p.owner_id===creator.owner_id);assert.equal(admin.display_name,'어드민');assert.equal(admin.linked_user_id,'a');assert.ok(admin.profile_id);
  const product=(await f.sql`SELECT product_id FROM pos_event_product_identities WHERE project_id=${f.event} AND owner_id=${creator.owner_id}`).rows[0];
  const detail=await foundation.decorateEventProducts(f.sql,'a',f.event,[{id:product.product_id}]);assert.equal(detail[0].eventCreator.name,'어드민');assert.equal(detail[0].eventCreator.linked,true);
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.sales,before.sales);
 }finally{await f.db.close();}
});


test('inventory allocation plan atomically returns ended stock, adjusts total and reallocates; errors roll back and replay preserves history',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const made=await f.invoke('booths','registerEventArtistProduct',{projectId:f.event,boothId,artistName:'계획 제작자',name:'계획 상품',price:0,quantity:30,goodsType:'키링',requestId:crypto.randomUUID()});assert.equal(made.status,200);let item=made.body.inventory;
  const ownerId=item.ownerId,other=(await f.invoke('pos','createProject',{name:'B 행사'})).body.project.id;
  assert.equal((await f.invoke('booths','saveEventAccess',{projectId:other,boothId,ownerId,status:'active',version:0,requestId:crypto.randomUUID()})).status,200);
  const allocation=async(projectId,quantity)=>{const result=await f.invoke('booths','setArtistAllocation',{ownerId,boothId,id:item.id,version:item.version,projectId,quantity,price:0,requestId:crypto.randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));item=result.body.inventory;};
  await allocation(f.event,10);await allocation(other,20);
  const sold=await f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',projectId:f.event,boothId,protocolVersion:2,actorId:'a',payload:{localOrderId:'plan-sale',method:'cash',total:0,cart:[{type:'product',id:item.allocations.find(a=>a.projectId===f.event).productId,qty:7,unitPrice:0}]}}});assert.equal(sold.status,200);
  await f.sql`UPDATE pos_projects SET archived_at=NOW() WHERE id=${f.event}`;
  const read=async()=>{const result=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId,boothId}});assert.equal(result.status,200);return result.body;};
  let view=await read();item=view.inventory[0];assert.equal(view.events.find(e=>e.id===f.event).canReturn,true);
  const payload={ownerId,boothId,id:item.id,version:item.version,totalStock:40,allocations:[{projectId:f.event,quantity:7},{projectId:other,quantity:30}],requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveArtistStockPlan',payload,'c')).status,403);
  const saved=await f.invoke('booths','saveArtistStockPlan',payload);assert.equal(saved.status,200,JSON.stringify(saved.body));item=saved.body.inventory;
  assert.equal(item.totalStock,40);assert.equal(item.warehouse,3);assert.equal(item.minimumTotalStock,37);assert.equal(item.stockSummary.sold,7);assert.equal(item.stockSummary.eventRemaining,30);
  assert.deepEqual((await f.invoke('booths','saveArtistStockPlan',payload)).body,saved.body);
  assert.equal((await f.invoke('booths','saveArtistStockPlan',{...payload,totalStock:41})).status,409);
  view=await read();assert.equal(view.history.some(h=>saved.body.commandIds.includes(h.id)),false);assert.equal(view.history.find(h=>h.id===payload.requestId).changes.length,2);
  assert.equal((await f.invoke('booths','saveArtistStockPlan',{...payload,version:item.version,totalStock:20,requestId:crypto.randomUUID()})).status,400);
  assert.equal((await f.invoke('booths','saveEventStockSchedule',{projectId:other,boothId,startsOn:'2000-01-01',endsOn:'2000-01-02',requestId:crypto.randomUUID()})).status,200);
  const invalid={...payload,version:item.version,totalStock:50,allocations:[{projectId:other,quantity:31}],requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveArtistStockPlan',invalid)).status,409);assert.equal((await read()).inventory[0].totalStock,40);
  const rollback={...payload,version:item.version,totalStock:35,allocations:[{projectId:other,quantity:25}],requestId:crypto.randomUUID()};
  await f.db.exec(`CREATE FUNCTION fail_stock_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${rollback.requestId}' THEN RAISE EXCEPTION 'injected plan receipt failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER fail_stock_plan BEFORE INSERT ON pos_shared_stock_commands FOR EACH ROW EXECUTE FUNCTION fail_stock_plan()`);
  assert.equal((await f.invoke('booths','saveArtistStockPlan',rollback)).status,500);assert.equal((await read()).inventory[0].totalStock,40);
  await f.db.exec('DROP TRIGGER fail_stock_plan ON pos_shared_stock_commands');
  const retried=await f.invoke('booths','saveArtistStockPlan',rollback);assert.equal(retried.status,200,JSON.stringify(retried.body));assert.equal(retried.body.inventory.totalStock,35);assert.equal(retried.body.inventory.minimumTotalStock,32);
  const profile=(await f.sql`SELECT id FROM pos_stock_owners WHERE id=${ownerId}`).rows[0];
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{projectId:f.event,boothId,profileId:profile.id,targetUserId:'b',requestId:crypto.randomUUID()})).status,200);
  assert.equal((await f.invoke('booths','saveStockPreference',{allowOperatorStock:false,requestId:crypto.randomUUID()},'b')).status,200);
  assert.equal((await f.invoke('booths','saveArtistStockPlan',{ownerId,boothId,id:item.id,version:retried.body.inventory.version,totalStock:36,allocations:[],requestId:crypto.randomUUID()})).status,403);
  assert.equal((await read()).inventory[0].totalStock,35);

 }finally{await f.db.close();}
});


test('event-focused inventory edits total and current allocation together while preserving every other event',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const created=await f.invoke('booths','registerEventArtistProduct',{projectId:f.event,boothId,artistName:'상세 제작자',name:'상세 재고',goodsType:'키링',price:0,quantity:20,requestId:crypto.randomUUID()});assert.equal(created.status,200);let item=created.body.inventory;const ownerId=item.ownerId;
  const other=(await f.invoke('pos','createProject',{name:'다른 행사'})).body.project.id;
  await f.invoke('booths','saveEventAccess',{projectId:other,boothId,ownerId,status:'active',version:0,requestId:crypto.randomUUID()});
  const returned=await f.invoke('booths','setArtistAllocation',{ownerId,boothId,id:item.id,version:item.version,projectId:f.event,quantity:10,requestId:crypto.randomUUID()});assert.equal(returned.status,200);item=returned.body.inventory;
  const assigned=await f.invoke('booths','setArtistAllocation',{ownerId,boothId,id:item.id,version:item.version,projectId:other,quantity:10,requestId:crypto.randomUUID()});assert.equal(assigned.status,200);item=assigned.body.inventory;
  const payload={ownerId,boothId,id:item.id,version:item.version,currentProjectId:f.event,totalStock:30,allocations:[{projectId:f.event,quantity:15}],requestId:crypto.randomUUID()};
  const saved=await f.invoke('booths','saveArtistStockPlan',payload);assert.equal(saved.status,200,JSON.stringify(saved.body));item=saved.body.inventory;
  assert.equal(item.totalStock,30);assert.equal(item.warehouse,5);assert.equal(item.allocations.find(a=>a.projectId===other).initial,10);
  assert.deepEqual((await f.invoke('booths','saveArtistStockPlan',payload)).body,saved.body);
  const audit=(await f.sql`SELECT project_id FROM pos_shared_stock_commands WHERE id=${payload.requestId}`).rows[0];assert.equal(audit.project_id,f.event);
  assert.equal((await f.invoke('booths','saveArtistStockPlan',{...payload,version:item.version,allocations:[{projectId:other,quantity:5}],requestId:crypto.randomUUID()})).status,403);
  const insufficient=await f.invoke('booths','saveArtistStockPlan',{...payload,version:item.version,totalStock:30,allocations:[{projectId:f.event,quantity:25}],requestId:crypto.randomUUID()});assert.equal(insufficient.status,400);
  const read=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId,boothId}});assert.equal(read.body.inventory[0].totalStock,30);assert.equal(read.body.inventory[0].allocations.find(a=>a.projectId===other).initial,10);
  await f.db.query("INSERT INTO pos_event_settlements(admin_id,project_id,closed_at,snapshot) VALUES('a',$1,NOW(),$2::jsonb)",[f.event,JSON.stringify({rows:[]})]);
  assert.equal((await f.invoke('booths','saveArtistStockPlan',{...payload,version:item.version,totalStock:31,allocations:[],requestId:crypto.randomUUID()})).status,409);
  assert.deepEqual((await f.invoke('booths','saveArtistStockPlan',payload)).body,saved.body);

 }finally{await f.db.close();}
});


test('migrated event templates preserve original stock links and restored events isolate unlinked creators and stock',async()=>{
 const f=await fixture();try{
  await f.migrate();const booth=(await foundation.migratedBooth(f.sql,'a')).id;
  // Linked source identity must never be adopted just because the backup has the same name.
  const source=(await f.sql`SELECT i.owner_id,l.inventory_id FROM pos_event_product_identities i JOIN pos_inventory_links l ON l.project_id=i.project_id AND l.product_id=i.product_id WHERE i.project_id=${f.event}`).rows[0];
  await f.sql`UPDATE pos_stock_owners SET linked_user_id='a',link_status='linked' WHERE id=${source.owner_id}`;
  const command=(action,payload,projectId,actor='a')=>f.invoke('pos',action,{},actor,{body:{action,protocolVersion:2,boothId:booth,projectId,payload}});
  const sale=await f.invoke('pos','finalizeSale',{},'a',{body:{action:'finalizeSale',protocolVersion:2,actorId:'a',boothId:booth,projectId:f.event,payload:{localOrderId:crypto.randomUUID(),method:'cash',total:0,cart:[{type:'product',id:'p',qty:1,unitPrice:0}]}}});assert.equal(sale.status,200,JSON.stringify(sale.body));
  const before=(await f.sql`SELECT * FROM pos_inventory WHERE admin_id='a' AND id=${source.inventory_id}`).rows[0];
  const copy=await command('duplicateProject',{name:'새 구성',password:'test-password',requestId:crypto.randomUUID()},f.event);assert.equal(copy.status,201,JSON.stringify(copy.body));
  const copyLink=(await f.sql`SELECT inventory_id FROM pos_inventory_links WHERE project_id=${copy.body.project.id}`).rows[0];assert.equal(copyLink.inventory_id,source.inventory_id);
  await artistStock.initArtistStock(f.sql);
  await f.sql`INSERT INTO pos_event_stock_policy(project_id,starts_on,ends_on) VALUES(${f.event},'2026-10-23','2026-10-24')`;
  await f.sql`INSERT INTO pos_event_settlements(admin_id,project_id,version,costs,snapshot,closed_at,history) VALUES('a',${f.event},1,'[{"label":"임대료","memo":"","split":"equal","type":"fixed","value":500}]'::jsonb,'{"rows":[{"creator":"작가","gross":0,"fees":500,"net":-500,"shares":[]}]}'::jsonb,NOW(),'[]')`;
  const exported=await command('backupProject',{password:'test-password'},f.event);assert.equal(exported.status,200,JSON.stringify(exported.body));
  const restored=await command('restoreProject',{name:'복원',backup:exported.body.backup,password:'test-password',requestId:crypto.randomUUID()});assert.equal(restored.status,201,JSON.stringify(restored.body));
  const id=restored.body.project.id;
  const proxy=(await f.sql`SELECT o.linked_user_id,i.owner_id,l.inventory_id FROM pos_event_product_identities i JOIN pos_stock_owners o ON o.id=i.owner_id JOIN pos_inventory_links l ON l.project_id=i.project_id AND l.product_id=i.product_id WHERE i.project_id=${id}`).rows[0];
  const closure=(await f.sql`SELECT * FROM pos_event_settlements WHERE project_id=${id}`).rows[0];assert.equal(closure.costs[0].value,500);assert.ok(closure.closed_at);
  const recipient=(await f.sql`SELECT r.legacy_creator FROM pos_event_product_identities i JOIN pos_recipients r ON r.id=i.recipient_id WHERE i.project_id=${id}`).rows[0];assert.equal(closure.snapshot.rows[0].creator,recipient.legacy_creator);
  const restoredSale=(await f.sql`SELECT lines FROM pos_sales WHERE project_id=${id}`).rows[0];assert.equal(restoredSale.lines[0].ownerId,proxy.owner_id);assert.equal(restoredSale.lines[0].settlementCreator,recipient.legacy_creator);
  assert.equal((await f.sql`SELECT ends_on::text AS day FROM pos_event_stock_policy WHERE project_id=${id}`).rows[0].day,'2026-10-24');
  assert.equal(proxy.linked_user_id,null);assert.notEqual(proxy.owner_id,source.owner_id);assert.notEqual(proxy.inventory_id,source.inventory_id);
  assert.deepEqual((await f.sql`SELECT * FROM pos_inventory WHERE admin_id='a' AND id=${source.inventory_id}`).rows[0],before);
  const home=await f.invoke('booths',null,{},'a',{query:{workspace:'home'}});assert.equal(home.body.events.find(e=>e.id===id).permissions.canManage,true);assert.ok(home.body.events.find(e=>e.id===id).archivedAt);
  assert.equal((await command('backupProject',{password:'test-password'},f.event,'b')).status,403);
 }finally{await f.db.close();}
});


test('event deletion returns only its remaining stock, preserves consumption and other events, and rolls back on failure',async()=>{
 const f=await fixture();try{
  await f.migrate();const boothId=(await foundation.migratedBooth(f.sql,'a')).id;
  const command=(action,payload,projectId=f.event,actor='a')=>f.invoke('pos',action,{},actor,{body:{action,protocolVersion:2,actorId:actor,boothId,projectId,payload}});
  const other=(await command('duplicateProject',{name:'다른 행사',password:'test-password'})).body.project.id;
  const ownerId=(await f.sql`SELECT owner_id FROM pos_inventory_owners WHERE inventory_id=${f.item.id}`).rows[0].owner_id;
  let stock=(await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId,boothId}})).body.inventory[0];
  const plan=await f.invoke('booths','saveArtistStockPlan',{ownerId,boothId,id:stock.id,version:stock.version,totalStock:20,allocations:[{projectId:f.event,quantity:10},{projectId:other,quantity:5}],requestId:crypto.randomUUID()});assert.equal(plan.status,200,JSON.stringify(plan.body));
  const sale=await command('finalizeSale',{localOrderId:crypto.randomUUID(),method:'cash',total:0,cart:[{type:'product',id:'p',qty:2,unitPrice:0}]});assert.equal(sale.status,200,JSON.stringify(sale.body));
  const sales=(await f.sql`SELECT * FROM pos_sales WHERE project_id=${f.event}`).rows;
  await f.sql`INSERT INTO pos_event_settlements(admin_id,project_id,closed_at,snapshot) VALUES('a',${f.event},NOW(),'{"rows":[]}'::jsonb)`;
  const payload={password:'test-password',confirmName:'원본 행사'};
  assert.equal((await command('deleteProject',{...payload,password:'wrong'})).status,403);
  assert.equal((await command('deleteProject',payload,f.event,'b')).status,403);
  await f.db.exec("CREATE FUNCTION fail_event_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'injected'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_event_delete BEFORE UPDATE ON pos_projects FOR EACH ROW EXECUTE FUNCTION fail_event_delete()");
  assert.equal((await command('deleteProject',payload)).status,500);
  assert.equal((await f.sql`SELECT stock_qty FROM pos_products WHERE project_id=${f.event}`).rows[0].stock_qty,8);
  await f.db.exec('DROP TRIGGER fail_event_delete ON pos_projects');
  const removed=await command('deleteProject',payload);assert.equal(removed.status,200,JSON.stringify(removed.body));assert.equal(removed.body.projects.some(p=>p.id===f.event),false);
  assert.equal((await command('deleteProject',payload)).status,200);
  const home=await f.invoke('booths',null,{},'a',{query:{workspace:'home'}});assert.equal(home.body.events.some(p=>p.id===f.event),false);
  assert.equal((await f.invoke('pos',null,{},'a',{query:{boothId,projectId:f.event}})).status,404);
  assert.equal((await command('finalizeSale',{localOrderId:crypto.randomUUID(),method:'cash',total:0,cart:[{type:'product',id:'p',qty:1,unitPrice:0}]})).status,404);
  stock=(await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId,boothId}})).body.inventory[0];
  assert.equal(stock.totalStock,20);assert.equal(stock.warehouse,13);assert.equal(stock.minimumTotalStock,7);assert.equal(stock.allocations.some(a=>a.projectId===f.event),false);assert.equal(stock.allocations.find(a=>a.projectId===other).initial,5);
  assert.deepEqual((await f.sql`SELECT * FROM pos_sales WHERE project_id=${f.event}`).rows,sales);
  assert.ok((await f.sql`SELECT closed_at FROM pos_event_settlements WHERE project_id=${f.event}`).rows[0].closed_at);
 }finally{await f.db.close();}
});

test('removing an event creator detaches current mappings without changing original stock, other events or historical sales',async()=>{
 const f=await fixture();try{
  await f.migrate();const boothId=(await foundation.migratedBooth(f.sql,'a')).id;
  const access=await f.invoke('booths',null,{},'a',{query:{workspace:'access',projectId:f.event,boothId}});const profile=access.body.profiles.find(p=>p.product_count===1);
  const linked=await f.invoke('booths','linkEventArtistAccount',{projectId:f.event,boothId,profileId:profile.id,targetUserId:'b',role:'seller',requestId:crypto.randomUUID()});assert.equal(linked.status,200,JSON.stringify(linked.body));
  const command=(action,payload)=>f.invoke('pos',action,{},'a',{body:{action,boothId,projectId:f.event,protocolVersion:2,actorId:'a',payload}});
  const other=(await command('duplicateProject',{name:'다른 행사',password:'test-password'})).body.project.id;
  assert.equal((await command('finalizeSale',{localOrderId:crypto.randomUUID(),method:'cash',total:0,cart:[{type:'product',id:'p',qty:1,unitPrice:0}]})).status,200);
  const inventory=(await f.sql`SELECT * FROM pos_inventory WHERE admin_id='a' AND id=${f.item.id}`).rows[0];const sales=(await f.sql`SELECT * FROM pos_sales WHERE project_id=${f.event}`).rows;
  const payload={projectId:f.event,boothId,ownerId:profile.owner_id,version:profile.version,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','removeEventArtist',payload,'c')).status,403);
  const result=await f.invoke('booths','removeEventArtist',payload);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal((await f.invoke('booths','removeEventArtist',payload)).status,200);
  const after=(await f.sql`SELECT * FROM pos_inventory WHERE admin_id='a' AND id=${f.item.id}`).rows[0];assert.deepEqual(after.product,inventory.product);assert.equal(after.stock,inventory.stock);
  assert.equal((await f.sql`SELECT stock_qty FROM pos_products WHERE project_id=${f.event}`).rows[0].stock_qty,9);
  const state=await f.invoke('pos',null,{},'a',{query:{boothId,projectId:f.event}});assert.equal(state.status,200);assert.equal(state.body.products[0].eventCreator,null);
  assert.equal((await f.invoke('pos',null,{},'a',{query:{boothId,projectId:other}})).body.products[0].eventCreator.ownerId,profile.owner_id);
  assert.deepEqual((await f.sql`SELECT * FROM pos_sales WHERE project_id=${f.event}`).rows,sales);
  const candidates=await f.invoke('booths',null,{},'a',{query:{workspace:'stockParticipants',projectId:f.event,boothId}});assert.equal(candidates.body.profiles.find(p=>p.owner_id===profile.owner_id).stockOnly,true);
  const stockView=await f.invoke('booths',null,{},'a',{query:{artists:'stock',ownerId:profile.owner_id,boothId}});assert.equal(stockView.status,200,JSON.stringify(stockView.body));assert.equal(stockView.body.inventory[0].allocations.find(a=>a.projectId===f.event).remaining,9);assert.ok(stockView.body.events.some(e=>e.id===f.event));
  const creatorAccess=await eventAccess.eventPermissions(f.sql,'b',f.event);assert.equal(creatorAccess.permissions.canSell,false);assert.equal(creatorAccess.permissions.canReadOwnHistory,true);
 }finally{await f.db.close();}
});

test('event information saves without password and rejects invalid or unauthorized requests atomically',async()=>{
 const f=await fixture();try{
  await f.migrate();const boothId=(await foundation.migratedBooth(f.sql,'a')).id;
  const payload={name:'변경한 행사',startsOn:'2026-11-01',endsOn:'2026-11-02'};
  const save=(data,actor='a')=>f.invoke('pos','updateProjectInfo',{},actor,{body:{action:'updateProjectInfo',boothId,projectId:f.event,payload:data}});
  assert.equal((await save(payload,'b')).status,403);
  assert.equal((await save({...payload,endsOn:'2026-10-01'})).status,400);assert.equal((await f.sql`SELECT name FROM pos_projects WHERE id=${f.event}`).rows[0].name,'원본 행사');
  const result=await save(payload);assert.equal(result.status,200,JSON.stringify(result.body));
  const access=await f.invoke('booths',null,{},'a',{query:{workspace:'access',projectId:f.event,boothId}});assert.equal(access.body.schedule.starts_on,'2026-11-01');assert.equal(result.body.projects.find(p=>p.id===f.event).name,payload.name);
  assert.equal((await save({...payload,startsOn:'',endsOn:''})).status,200);assert.equal((await f.sql`SELECT project_id FROM pos_event_stock_policy WHERE project_id=${f.event}`).rows.length,0);
 }finally{await f.db.close();}
});

test('event management password checks apply only to archive and delete while ownership remains enforced',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();await stockDelegation.initStockDelegation(f.sql);
  const command=(action,payload={},actor='a')=>f.invoke('pos',action,{},actor,{body:{action,boothId,projectId:f.event,protocolVersion:2,payload}});
  assert.equal((await command('backupProject')).status,200);assert.equal((await command('backupProject',{},'b')).status,403);
  assert.equal((await command('renameProject',{name:'이름 수정'})).status,200);
  assert.equal((await command('archiveProject')).status,403);assert.equal((await command('archiveProject',{password:'wrong'})).status,403);
  assert.equal((await command('archiveProject',{password:'test-password'})).status,200);
  const reopened=await command('unarchiveProject');assert.equal(reopened.status,200,JSON.stringify(reopened.body));
  assert.equal((await f.sql`SELECT archived_at FROM pos_projects WHERE id=${f.event}`).rows[0].archived_at,null);
  const copy=await command('duplicateProject',{name:'비밀번호 없는 구성',requestId:crypto.randomUUID()});assert.equal(copy.status,201,JSON.stringify(copy.body));
  const missing=await command('deleteProject',{confirmName:'이름 수정'});assert.equal(missing.status,403,JSON.stringify(missing.body));const wrong=await command('deleteProject',{confirmName:'이름 수정',password:'wrong'});assert.equal(wrong.status,403,JSON.stringify(wrong.body));
  assert.equal((await f.sql`SELECT deleted_at FROM pos_projects WHERE id=${f.event}`).rows[0].deleted_at,null);
 }finally{await f.db.close();}
});

test('workspace dashboard aggregates are scoped to operators and do not expose event totals to viewers',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();await artistStock.initArtistStock(f.sql);await eventAccess.initEventAccess(f.sql,'a');
  await f.sql`INSERT INTO pos_sales(project_id,id,time,method,total,lines) VALUES(${f.event},'dashboard-paid','2026-10-27T10:00:00Z','cash',5000,'[]'),(${f.event},'dashboard-free','2026-10-27T11:00:00Z','cash',0,'[]')`;
  await f.sql`UPDATE pos_settlements SET payments='[{"id":"paid","amount":1000},{"id":"reverse","amount":-200}]'::jsonb WHERE project_id=${f.event} AND creator='작가'`;
  await f.sql`INSERT INTO pos_settlements(admin_id,project_id,creator,payments) VALUES('a',${f.event},'다른 작가','[{"id":"paid-other","amount":500}]'::jsonb)`;
  await f.sql`INSERT INTO pos_event_settlements(admin_id,project_id,closed_at,snapshot) VALUES('a',${f.event},NOW(),'{"rows":[{"creator":"작가","net":4000},{"creator":"다른 작가","net":2000}]}'::jsonb)`;
  await f.sql`INSERT INTO pos_settlements(admin_id,project_id,creator,payments) VALUES('b',${f.event},'다른 계정 원장','[{"id":"foreign","amount":999999}]'::jsonb)`;
  const before=await foundation.legacySnapshot(f.sql,'a');
  const rows=await eventAccess.workspaceEvents(f.sql,'a'),current=rows.find(row=>row.id===f.event);
  assert.ok(current.summary);assert.equal(current.summary.products,before.products.filter(row=>row.project_id===f.event&&row.is_active!==false).length);
  assert.equal(current.summary.sales,before.sales.filter(row=>row.project_id===f.event).length);
  assert.equal(current.summary.total,before.sales.filter(row=>row.project_id===f.event).reduce((sum,row)=>sum+Number(row.total),0));
  assert.equal(current.summary.total,5000);assert.equal(current.summary.sales,2);assert.ok(current.summary.closedAt);
  assert.equal(current.summary.settlementNet,6000);assert.equal(current.summary.paid,1300);assert.equal(current.summary.pending,4700);
  assert.equal(new Date(current.summary.lastSaleAt).toISOString(),'2026-10-27T11:00:00.000Z');
  await f.sql`INSERT INTO pos_booth_members(booth_id,user_id,role,status) VALUES(${boothId},'b','viewer','active')`;
  const viewer=await eventAccess.workspaceEvents(f.sql,'b');assert.ok(viewer.every(row=>row.summary===undefined));
  const outsider=await eventAccess.workspaceEvents(f.sql,'c');assert.equal(outsider.length,0);
  assert.deepEqual((await foundation.legacySnapshot(f.sql,'a')).sales,before.sales);
 }finally{await f.db.close();}
});


test('unlinked event roles save without account linkage, replay safely and transfer when linked',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();
  const made=await f.invoke('booths','createEventCreator',{projectId:f.event,boothId,name:'권한 제작자',requestId:crypto.randomUUID()});assert.equal(made.status,200);
  const ownerId=made.body.ownerId;
  let row=(await f.sql`SELECT * FROM pos_event_artists WHERE project_id=${f.event} AND owner_id=${ownerId}`).rows[0];
  const command={projectId:f.event,boothId,ownerId,role:'assistant',status:'active',version:row.version,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','saveEventAccess',command,'c')).status,403);
  const saved=await f.invoke('booths','saveEventAccess',command);assert.equal(saved.status,200,JSON.stringify(saved.body));
  assert.equal(saved.body.profiles.find(p=>p.owner_id===ownerId).requested_role,'assistant');
  assert.deepEqual((await f.invoke('booths','saveEventAccess',command)).body,saved.body);
  assert.equal((await f.invoke('booths','saveEventAccess',{...command,role:'seller'})).status,409);
  assert.equal((await f.invoke('booths','saveEventAccess',{...command,requestId:crypto.randomUUID()})).status,409);
  assert.equal((await f.sql`SELECT * FROM pos_event_staff WHERE project_id=${f.event} AND user_id='b'`).rows.length,0);
  const linked=await f.invoke('booths','linkEventArtistAccount',{projectId:f.event,boothId,profileId:made.body.profileId,targetUserId:'b',requestId:crypto.randomUUID()});assert.equal(linked.status,200,JSON.stringify(linked.body));
  row=(await f.sql`SELECT * FROM pos_event_staff WHERE project_id=${f.event} AND user_id='b'`).rows[0];assert.equal(row.role,'assistant');
  assert.equal((await f.invoke('booths','saveEventAccess',{...command,version:command.version+1,requestId:crypto.randomUUID()})).status,409);
 }finally{await f.db.close();}
});

test('operator account unlink is global, preserves stock and settlements, replays safely and keeps independent participation',async()=>{
 const f=await fixture();try{
  const {boothId}=await f.migrate();const projectId=f.event;
  const view=await f.invoke('booths',null,{},'a',{query:{workspace:'access',projectId,boothId}});
  const profile=view.body.profiles.find(p=>p.status==='active'&&!p.linked_user_id);
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{projectId,boothId,profileId:profile.id,targetUserId:'b',role:'seller',requestId:crypto.randomUUID()})).status,200);
  const second=(await f.invoke('pos','createProject',{name:'두 번째 행사'})).body.project.id;
  await f.sql`INSERT INTO pos_event_booths(project_id,booth_id) VALUES(${second},${boothId}) ON CONFLICT DO NOTHING`;
  const added=await f.invoke('booths','addEventArtist',{projectId:second,boothId,profileId:profile.id,role:'assistant',requestId:crypto.randomUUID()});assert.equal(added.status,200,JSON.stringify(added.body));
  const other=(await f.invoke('booths','createEventCreator',{projectId,boothId,name:'계속 연결된 제작자',requestId:crypto.randomUUID()})).body;
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{projectId,boothId,profileId:other.profileId,targetUserId:'b',requestId:crypto.randomUUID()})).status,200);
  const before=await foundation.legacySnapshot(f.sql,'a');
  const settlements=(await f.sql`SELECT * FROM pos_settlements ORDER BY project_id,creator`).rows;
  const recipients=(await f.sql`SELECT * FROM pos_event_recipients ORDER BY project_id,legacy_creator`).rows;
  const payload={projectId,boothId,ownerId:profile.owner_id,targetUserId:'b',version:profile.version,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke('booths','unlinkEventArtistAccount',payload,'c')).status,403);
  assert.equal((await f.invoke('booths','unlinkEventArtistAccount',{...payload,targetUserId:'c'})).status,409);
  await f.db.exec("CREATE FUNCTION reject_unlink() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='profile_unlinked_by_operator' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_unlink BEFORE INSERT ON pos_artist_link_audit FOR EACH ROW EXECUTE FUNCTION reject_unlink()");
  assert.equal((await f.invoke('booths','unlinkEventArtistAccount',payload)).status,500);
  assert.equal((await f.sql`SELECT linked_user_id FROM pos_stock_owners WHERE id=${profile.id}`).rows[0].linked_user_id,'b');
  assert.equal((await f.sql`SELECT status FROM pos_event_staff WHERE project_id=${second} AND user_id='b'`).rows[0].status,'active');
  await f.db.exec('DROP TRIGGER reject_unlink ON pos_artist_link_audit');
  const result=await f.invoke('booths','unlinkEventArtistAccount',payload);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.unlinked,true);
  assert.deepEqual((await f.invoke('booths','unlinkEventArtistAccount',payload)).body,result.body);
  assert.equal((await f.invoke('booths','unlinkEventArtistAccount',{...payload,requestId:crypto.randomUUID()})).status,409);
  const owner=(await f.sql`SELECT linked_user_id,link_status FROM pos_stock_owners WHERE id=${profile.id}`).rows[0];assert.equal(owner.linked_user_id,null);assert.equal(owner.link_status,'unlinked');
  assert.equal((await f.sql`SELECT user_id FROM pos_owner_members WHERE owner_id=${profile.id} AND user_id='b'`).rows.length,0);
  assert.equal((await f.sql`SELECT user_id FROM pos_owner_members WHERE owner_id=${other.ownerId} AND user_id='b'`).rows.length,1);
  assert.equal((await f.sql`SELECT status FROM pos_event_staff WHERE project_id=${projectId} AND user_id='b'`).rows[0].status,'active');
  assert.equal((await f.sql`SELECT status FROM pos_event_staff WHERE project_id=${second} AND user_id='b'`).rows[0].status,'ended');
  const events=(await f.sql`SELECT status,version,requested_role FROM pos_event_artists WHERE owner_id=${profile.id}`).rows;assert.ok(events.every(e=>e.status==='active'&&e.version>profile.version));assert.ok(events.some(e=>e.requested_role==='assistant'));
  assert.equal((await eventAccess.eventPermissions(f.sql,'b',second)).permissions.canRead,false);
  const after=await foundation.legacySnapshot(f.sql,'a');assert.deepEqual(after.inventory,before.inventory);assert.deepEqual(after.sales,before.sales);assert.deepEqual(after.products,before.products);
  assert.deepEqual((await f.sql`SELECT * FROM pos_settlements ORDER BY project_id,creator`).rows,settlements);
  assert.deepEqual((await f.sql`SELECT * FROM pos_event_recipients ORDER BY project_id,legacy_creator`).rows,recipients);
  assert.equal((await f.sql`SELECT id FROM pos_artist_link_audit WHERE owner_id=${profile.id} AND action='profile_unlinked_by_operator'`).rows.length,1);
  assert.equal((await f.invoke('booths','linkEventArtistAccount',{projectId,boothId,profileId:profile.id,targetUserId:'c',requestId:crypto.randomUUID()})).status,200);
  assert.equal((await f.invoke('booths','unlinkEventArtistAccount',{...payload,requestId:crypto.randomUUID()})).status,409);
  // Personal identities registered by another account are outside the operator's unlink scope.
  const personal=(await f.invoke('booths','createArtistProfile',{name:'본인 제작자'},'b')).body.profiles.find(p=>p.origin_booth_id===null);
  assert.ok(personal);
  assert.equal((await f.invoke('booths','addEventArtist',{projectId,boothId,profileId:personal.id,role:'none',requestId:crypto.randomUUID()})).status,200);
  const access=(await f.invoke('booths',null,{},'a',{query:{workspace:'access',projectId,boothId}})).body;
  const own=access.profiles.find(p=>p.id===personal.id);assert.equal(own.can_unlink,false);
  assert.equal((await f.invoke('booths','unlinkEventArtistAccount',{projectId,boothId,ownerId:own.owner_id,targetUserId:'b',version:own.version,requestId:crypto.randomUUID()})).status,403);
 }finally{await f.db.close();}
});

test('retiring artist profiles folds account links into creators and keeps invitations and audit rows',async()=>{
 const db=new PGlite();
 const sql=(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);
 try{
  await db.exec(`CREATE TABLE pos_admins(id TEXT PRIMARY KEY);INSERT INTO pos_admins VALUES('a'),('b');
   CREATE TABLE pos_booths(id TEXT PRIMARY KEY);INSERT INTO pos_booths VALUES('booth');
   CREATE TABLE pos_stock_owners(id TEXT PRIMARY KEY,kind TEXT NOT NULL,display_name TEXT NOT NULL,origin_booth_id TEXT REFERENCES pos_booths(id),legacy_key TEXT NOT NULL);
   CREATE TABLE pos_artist_profiles(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL UNIQUE REFERENCES pos_stock_owners(id),linked_user_id TEXT REFERENCES pos_admins(id),status TEXT NOT NULL DEFAULT 'unlinked');
   CREATE TABLE pos_artist_invitations(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,profile_id TEXT NOT NULL REFERENCES pos_artist_profiles(id),booth_id TEXT NOT NULL REFERENCES pos_booths(id));
   CREATE TABLE pos_artist_link_audit(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES pos_artist_profiles(id),action TEXT NOT NULL);
   INSERT INTO pos_stock_owners VALUES('personal-owner:x','artist','본인',NULL,'personal-owner:x'),('owner:proxy','unverified','대리 작가','booth','대리 작가');
   INSERT INTO pos_artist_profiles VALUES('personal-artist:x','personal-owner:x','a','linked'),('artist:proxy','owner:proxy',NULL,'unlinked');
   INSERT INTO pos_artist_invitations VALUES('invite','hash','artist:proxy','booth');
   INSERT INTO pos_artist_link_audit VALUES('created','personal-artist:x','profile_created'),('issued','artist:proxy','invitation_issued');`);
  await foundation.retireArtistProfiles(sql);
  await foundation.retireArtistProfiles(sql);
  const owners=(await sql`SELECT id,linked_user_id,link_status FROM pos_stock_owners ORDER BY id`).rows;
  assert.deepEqual(owners,[{id:'owner:proxy',linked_user_id:null,link_status:'unlinked'},{id:'personal-owner:x',linked_user_id:'a',link_status:'linked'}]);
  assert.equal((await sql`SELECT to_regclass('pos_artist_profiles') AS name`).rows[0].name,null);
  assert.equal((await sql`SELECT COUNT(*)::int AS n FROM pos_artist_profiles_retired`).rows[0].n,2);
  assert.deepEqual((await sql`SELECT owner_id,legacy_profile_id FROM pos_artist_invitations`).rows,[{owner_id:'owner:proxy',legacy_profile_id:'artist:proxy'}]);
  assert.deepEqual((await sql`SELECT id,owner_id FROM pos_artist_link_audit ORDER BY id`).rows,[{id:'created',owner_id:'personal-owner:x'},{id:'issued',owner_id:'owner:proxy'}]);
  assert.equal(await foundation.ownerIdOf(sql,'artist:proxy'),'owner:proxy');
  assert.equal(await foundation.ownerIdOf(sql,'owner:proxy'),'owner:proxy');
  await assert.rejects(sql`UPDATE pos_stock_owners SET link_status='linked' WHERE id='owner:proxy'`);
 }finally{await db.close();}
});
