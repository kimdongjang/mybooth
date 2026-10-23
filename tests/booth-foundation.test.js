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
        specifier.endsWith('/storageContract.js')?storageContract:specifier.endsWith('/eventAccess.js')?eventAccess:specifier.endsWith('/boothFoundation.js')?foundation:specifier.endsWith('/artistLinking.js')?artistLinking:specifier.endsWith('/artistStock.js')?artistStock:specifier.endsWith('/contractRetirement.js')?contractRetirement:specifier.endsWith('/accountInventory.js')?accountInventory:
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
    const profileId=(await f.db.query('SELECT id FROM pos_artist_profiles')).rows[0].id;
    const issue=async()=>{const result=await f.invoke('booths','issueArtistInvitation',{boothId,profileId});assert.equal(result.status,200,JSON.stringify(result.body));return result.body.invitation;};
    const accept=invite=>f.invoke('booths','acceptArtistInvitation',{token:invite.token,acceptSharedStock:true},'b');
    let invite=await issue();await f.db.query("UPDATE pos_artist_invitations SET expires_at=NOW()-INTERVAL '1 second' WHERE id=$1",[invite.id]);assert.equal((await accept(invite)).status,409);
    invite=await issue();assert.equal((await f.invoke('booths','revokeArtistInvitation',{boothId,invitationId:invite.id},'c')).status,403);
    assert.equal((await f.invoke('booths','revokeArtistInvitation',{boothId,invitationId:invite.id})).status,200);assert.equal((await accept(invite)).status,409);
    invite=await issue();const replacement=await issue();assert.equal((await accept(invite)).status,409);
    await f.db.query("UPDATE pos_booth_artists SET status='ended' WHERE booth_id=$1",[boothId]);assert.equal((await accept(replacement)).status,409);
    await f.db.query("UPDATE pos_booth_artists SET status='proxy' WHERE booth_id=$1",[boothId]);
    await f.db.query("UPDATE pos_booth_members SET status='ended' WHERE booth_id=$1",[boothId]);assert.equal((await accept(replacement)).status,409);
    assert.equal((await f.db.query('SELECT linked_user_id FROM pos_artist_profiles')).rows[0].linked_user_id,null);
    assert.equal(Number((await f.db.query('SELECT COUNT(*) AS n FROM pos_owner_members')).rows[0].n),0);
  }finally{await f.db.close();}
});

test('failed link rolls back profile, membership, participation and token use; the same token can retry',async()=>{
  const f=await fixture();try{
    const {boothId}=await f.migrate();
    const profile=(await f.db.query('SELECT * FROM pos_artist_profiles')).rows[0];
    const issued=await f.invoke('booths','issueArtistInvitation',{boothId,profileId:profile.id});
    const token=issued.body.invitation.token;
    const before=foundation.foundationReport(await foundation.legacySnapshot(f.sql,'a'));
    await f.db.exec("CREATE FUNCTION reject_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='profile_linked' THEN RAISE EXCEPTION 'fixture failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER reject_link BEFORE INSERT ON pos_artist_link_audit FOR EACH ROW EXECUTE FUNCTION reject_link()");
    assert.equal((await f.invoke('booths','acceptArtistInvitation',{token,acceptSharedStock:true},'b')).status,500);
    assert.equal((await f.db.query('SELECT linked_user_id FROM pos_artist_profiles WHERE id=$1',[profile.id])).rows[0].linked_user_id,null);
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
    const profile=(await f.db.query("SELECT p.* FROM pos_artist_profiles p JOIN pos_stock_owners o ON o.id=p.owner_id WHERE o.display_name='작가'")).rows[0];
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
    const sourceProfile=(await f.db.query("SELECT p.id FROM pos_artist_profiles p JOIN pos_stock_owners o ON o.id=p.owner_id WHERE o.origin_booth_id=$1",[boothId])).rows[0].id;
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
    const artist=(await f.db.query('SELECT * FROM pos_artist_profiles')).rows[0];assert.equal(artist.linked_user_id,null);
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
    for(const action of ['restoreAccount','deleteAccount','deleteProject','clearSales']) {
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
    await f.db.query("UPDATE pos_artist_profiles SET status='linked',linked_user_id='b' WHERE owner_id=$1",[ownerId]);
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
  const profile=(await f.db.query("SELECT p.id,p.owner_id FROM pos_artist_profiles p JOIN pos_stock_owners o ON o.id=p.owner_id WHERE o.display_name='작가'" )).rows[0];
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
  const profile=(await f.db.query("SELECT p.id FROM pos_artist_profiles p JOIN pos_stock_owners o ON o.id=p.owner_id WHERE o.display_name='작가'" )).rows[0];
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
