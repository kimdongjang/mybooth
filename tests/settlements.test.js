import * as storageContract from '../api/lib/storageContract.js';
import * as boothFoundation from '../api/lib/boothFoundation.js';
import { eventSettlementPreview } from '../src/utils/eventSettlement.js';
import * as eventSettlement from '../api/lib/eventSettlement.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { settlementMoneyEntries } from '../src/utils/settlementEntries.js';
import { koreanDay, periodRange, revenueSummary, settlementCsv } from '../src/utils/revenueSummary.js';

async function fixture({beforeQuery=()=>{}}={}) {
  const db=new PGlite();
  await db.exec(`CREATE TABLE pos_admins(id TEXT PRIMARY KEY,deleted_at TIMESTAMPTZ);INSERT INTO pos_admins(id)VALUES('a'),('b');
    CREATE TABLE pos_projects(id TEXT PRIMARY KEY,admin_id TEXT);INSERT INTO pos_projects VALUES('event','a'),('foreign','b');
    CREATE TABLE pos_products(project_id TEXT,id TEXT,name TEXT,creator_name TEXT,price INTEGER,is_active BOOLEAN);
    CREATE TABLE pos_inventory_links(admin_id TEXT,project_id TEXT,product_id TEXT,inventory_id TEXT);
    CREATE TABLE pos_inventory(admin_id TEXT,id TEXT,product JSONB);
    INSERT INTO pos_products VALUES('event','p','키링','최신 이름',9999,TRUE);
    CREATE TABLE pos_bundles(project_id TEXT,id TEXT,items JSONB);
    CREATE TABLE pos_sales(project_id TEXT,lines JSONB,id SERIAL PRIMARY KEY);
    INSERT INTO pos_sales(project_id,lines) VALUES('event','[{"type":"product","id":"p","name":"키링","creatorName":"작가","unitPrice":1000,"qty":10}]');`);
  const statements=[];let releases=0;
  let connects=0,tail=Promise.resolve();
  const pool={connect:async()=>{connects++;const prior=tail;let release;tail=new Promise(resolve=>release=resolve);await prior;return {sql(parts,...values){return this.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values);},async query(query,values){statements.push(query);await beforeQuery(query,values);return db.query(query,values);},release(){releases++;release();}};}};
  const context=vm.createContext({});
  const module=new vm.SourceTextModule(await readFile(new URL('../api/settlements.js',import.meta.url),'utf8'),{context});
  await module.link(name=>{const exports=name==='@vercel/postgres'?{sql:pool}:name.endsWith('auth.js')?{assertPostgresConnectionString(){},validateAdminPassword:async(_id,password)=>password==='test-password',requireAuth(req,res){if(req.adminId)return{id:req.adminId};res.status(401).json({error:'Unauthorized'});return null;}}:name.endsWith('storageContract.js')?storageContract:name.endsWith('boothFoundation.js')?boothFoundation:name.endsWith('eventSettlement.js')?eventSettlement:{settlementMoneyEntries};return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});});
  await module.evaluate();
  const invoke=async(body=null,adminId='a',query={})=>{const result={};await module.namespace.default({adminId,method:body?'POST':'GET',body,query},{status(status){result.status=status;return this;},json(value){result.body=JSON.parse(JSON.stringify(value));return this;}});return result;};
  const close=async()=>{
   const result=await invoke(null,'a',{projectId:'event'});assert.equal(result.status,200,JSON.stringify(result.body));
   const event=result.body.eventSettlements.find(row=>row.projectId==='event') || {version:0,costs:[]};
   return invoke({action:'closeEventSettlement',password:'test-password',projectId:'event',version:event.version,requestId:crypto.randomUUID(),expectedPreview:JSON.stringify(eventSettlementPreview(result.body.state,event.costs,result.body.settlements))});
  };
  return{db,invoke,close,statements,connects:()=>connects,releases:()=>releases};
}
const command=(action,version,extra={})=>({action,version,projectId:'event',creator:'작가',requestId:crypto.randomUUID(),...extra});

test('settlement deductions, partial payments, replay, stale versions and reversals preserve exact balances',async()=>{
  const f=await fixture();try{
    assert.equal((await f.invoke(null,null)).status,401);assert.equal(f.connects(),0);
    const fee=command('saveDeductions',0,{deductions:[{label:'운영비',amount:1000},{label:'수수료',amount:500}]});
    let result=await f.invoke(fee);assert.equal(result.status,200);assert.equal(result.body.settlement.version,1);
    assert.equal((await f.close()).status,200);
    const payment=command('addPayment',1,{amount:4000,paidAt:'2026-10-21',memo:'1차 이체'});
    result=await f.invoke(payment);assert.equal(result.status,200);assert.equal(result.body.settlement.payments.length,1);
    assert.equal((await f.invoke(payment)).body.settlement.payments.length,1);
    assert.equal((await f.invoke({...payment,amount:4001})).status,409);
    assert.equal((await f.invoke(command('addPayment',1,{amount:1,paidAt:'2026-10-21'}))).status,409);
    assert.equal((await f.invoke(command('addPayment',2,{amount:4501,paidAt:'2026-10-21'}))).status,400);
    const cancel=command('reversePayment',2,{paymentId:payment.requestId,paidAt:'2026-10-22',memo:'오입력 취소'});
    result=await f.invoke(cancel);assert.equal(result.status,200);assert.equal(result.body.settlement.payments.reduce((s,p)=>s+p.amount,0),0);
    assert.equal(result.body.settlement.payments.length,2);assert.equal((await f.invoke(cancel)).status,200);
    assert.equal((await f.invoke(command('reversePayment',3,{paymentId:payment.requestId,paidAt:'2026-10-22'}))).status,409);
  }finally{await f.db.close();}
});

test('settlement API isolates owners and validates integer fees, dates, creator identity and deleted accounts',async()=>{
 const f=await fixture();try{
  assert.equal((await f.invoke(command('saveDeductions',0,{deductions:[],projectId:'foreign'}))).status,404);
  assert.equal((await f.invoke(command('saveDeductions',0,{deductions:[],creator:'최신 이름'}))).status,404);
  for(const amount of [-1,0.5,10001,'10'])assert.equal((await f.invoke(command('saveDeductions',0,{deductions:[{label:'비용',amount}]}))).status,400);
  assert.equal((await f.invoke(command('saveDeductions',0,{deductions:[]}))).status,200);
  assert.equal((await f.close()).status,200);
  for(const paidAt of ['2026-02-30','2026-13-01',''])assert.equal((await f.invoke(command('addPayment',1,{amount:1,paidAt}))).status,400);
  assert.equal((await f.invoke(command('saveDeductions',1,{deductions:[]}))).status,409);
  assert.deepEqual((await f.invoke(null,'b')).body.settlements,[]);
  await f.db.exec("UPDATE pos_admins SET deleted_at=NOW() WHERE id='a'");
  assert.equal((await f.invoke()).status,401);
 }finally{await f.db.close();}
});

test('ledger writes roll back with receipt failures and concurrent stale payments cannot both commit',async()=>{
 const f=await fixture();try{
  await f.invoke();
  assert.equal((await f.close()).status,200);
  await f.db.exec("CREATE FUNCTION reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER reject_receipt BEFORE INSERT ON pos_settlement_commands FOR EACH ROW EXECUTE FUNCTION reject_receipt()");
  const payment=command('addPayment',0,{amount:6000,paidAt:'2026-10-21'});
  assert.equal((await f.invoke(payment)).status,500);
  assert.equal((await f.invoke()).body.settlements.length,0);
  await f.db.exec('DROP TRIGGER reject_receipt ON pos_settlement_commands');
  const results=await Promise.all([f.invoke(payment),f.invoke(command('addPayment',0,{amount:6000,paidAt:'2026-10-21'}))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.invoke(payment)).body.settlement.payments.length,1);
 }finally{await f.db.close();}
});

test('Korean date filters change sales metrics without reassigning lifetime deductions and payments; CSV is escaped',()=>{
 const data={projects:[{id:'event',name:'행사,이름'}],states:[{products:[],sales:[{time:'2026-09-30T15:00:00Z',total:10000,method:'cash',lines:[{type:'product',id:'p',name:'키링',creatorName:'=작가',qty:10,unitPrice:1000}]}]}]};
 const records=[{projectId:'event',creator:'=작가',version:1,deductions:[{label:'운영비',amount:2000}],payments:[{id:'paid',amount:3000,paidAt:'2026-10-21'}]}];
 assert.equal(koreanDay('2026-09-30T15:00:00Z'),'2026-10-01');
 assert.deepEqual(periodRange('year','','',new Date('2026-12-31T16:00:00Z')),{start:'2027-01-01',end:'2027-12-31'});
 const closures=[{projectId:'event',closedAt:'2026-10-21',snapshot:{rows:[{creator:'=작가',gross:10000,fees:2000,net:8000}]}}];
 const summary=revenueSummary(data,records,{start:'2026-10-01',end:'2026-10-01'},closures);
 assert.equal(summary.total,10000);assert.equal(summary.pending,5000);assert.equal(summary.creators[0].net,8000);
 const excluded=revenueSummary(data,records,{start:'2026-11-01',end:'2026-11-30'},closures);assert.equal(excluded.total,0);assert.equal(excluded.pending,5000);
 const csv=settlementCsv(summary.creators);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=작가"));assert.ok(csv.includes('"행사,이름"'));
 const cancelled=revenueSummary({...data,states:[{products:[],sales:[]}]},records,{start:'',end:''},closures);assert.equal(cancelled.pending,5000);assert.equal(cancelled.creators[0].overpaid,0);
});


test('bundle payment rounding conserves every won across creators',()=>{
 const entries=settlementMoneyEntries({type:'bundle',qty:1,unitPrice:100,subItems:['a','b','c'].map(creatorName=>({creatorName,productId:creatorName,qty:1,unitPrice:1}))},{},[]);
 assert.deepEqual(entries.map(entry=>entry.amount),[34,33,33]);
 assert.equal(entries.reduce((sum,entry)=>sum+entry.amount,0),100);
});

test('event costs split by ratio/equal, close freezes figures, payment gates reopen and reopening preserves history',async()=>{
 const f=await fixture();try{
  const costs=[{label:'부스 임대료',memo:'메모',type:'fixed',split:'equal',value:7000},{label:'수수료',memo:'',type:'percent',split:'ratio',value:500}];
  const save={action:'saveEventCosts',projectId:'event',version:0,requestId:crypto.randomUUID(),costs};
  assert.equal((await f.invoke(save)).status,200);assert.equal((await f.invoke(save)).status,200);
  assert.equal((await f.invoke({...save,costs:[]})).status,409);
  assert.equal((await f.invoke({...save,requestId:crypto.randomUUID()},'b')).status,404);
  const initial=(await f.invoke(null,'a',{projectId:'event'})).body;
  const expected=eventSettlementPreview(initial.state,costs,initial.settlements);
  assert.equal(expected.fees,7500);assert.equal(expected.net,2500);
  assert.equal(expected.rows.find(r=>r.creator==='작가').net,6000);
  assert.equal(expected.rows.find(r=>r.creator==='최신 이름').net,-3500);
  const close={action:'closeEventSettlement',password:'test-password',projectId:'event',version:1,requestId:crypto.randomUUID(),expectedPreview:JSON.stringify(expected)};
  const closed=await f.invoke(close);assert.equal(closed.status,200,JSON.stringify(closed.body));assert.equal((await f.invoke(close)).status,200);
  assert.equal(closed.body.eventSettlement.snapshot.fees,7500);
  assert.equal((await f.invoke({...save,version:2,requestId:crypto.randomUUID()})).status,409);
  await f.db.query("UPDATE pos_products SET creator_name='새 이름',price=1 WHERE project_id='event'");
  assert.equal((await f.invoke()).body.eventSettlements[0].snapshot.rows.find(r=>r.creator==='작가').net,6000);
  const payment=command('addPayment',0,{amount:6000,paidAt:'2026-10-21'});
  assert.equal((await f.invoke(payment)).status,200);
  const reopen={action:'reopenEventSettlement',projectId:'event',version:2,requestId:crypto.randomUUID()};
  assert.equal((await f.invoke(reopen)).status,409);
  assert.equal((await f.invoke(command('reversePayment',1,{paymentId:payment.requestId,paidAt:'2026-10-21',memo:''}))).status,200);
  const result=await f.invoke(reopen);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.eventSettlement.closedAt,null);assert.equal(result.body.eventSettlement.history.length,2);
  assert.equal(result.body.eventSettlement.history[1].snapshot.rows.find(r=>r.creator==='작가').net,6000);
  assert.equal((await f.invoke(command('addPayment',2,{amount:1,paidAt:'2026-10-21'}))).status,409);
 }finally{await f.db.close();}
});

test('event closing requires reauthentication and never persists the password in receipts',async()=>{
 const f=await fixture();try{
  const state=(await f.invoke(null,'a',{projectId:'event'})).body;
  const close={action:'closeEventSettlement',projectId:'event',version:0,requestId:crypto.randomUUID(),expectedPreview:JSON.stringify(eventSettlementPreview(state.state,[],[]))};
  assert.equal((await f.invoke(close)).status,403);assert.equal((await f.invoke({...close,password:'wrong'})).status,403);
  assert.equal((await f.db.query('SELECT * FROM pos_event_settlements')).rows.length,0);
  assert.equal((await f.invoke({...close,password:'test-password'},'b')).status,404);
  const protectedClose={...close,password:'test-password'};const result=await f.invoke(protectedClose);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal((await f.invoke(protectedClose)).status,200);
  const receipts=(await f.db.query('SELECT fingerprint FROM pos_settlement_commands')).rows;
  assert.equal(receipts.length,1);assert.equal(receipts[0].fingerprint.includes('test-password'),false);assert.equal(Object.hasOwn(JSON.parse(receipts[0].fingerprint),'password'),false);
  const reopened=await f.invoke({action:'reopenEventSettlement',projectId:'event',version:1,requestId:crypto.randomUUID()});assert.equal(reopened.status,200,JSON.stringify(reopened.body));
  const costs=await f.invoke({action:'saveEventCosts',projectId:'event',version:2,requestId:crypto.randomUUID(),costs:[]});assert.equal(costs.status,200,JSON.stringify(costs.body));
 }finally{await f.db.close();}
});

test('close detects changed sales, rejects stale versions and rolls back snapshot and revision when receipt fails',async()=>{
 const f=await fixture();try{
  const before=(await f.invoke(null,'a',{projectId:'event'})).body;
  const close={action:'closeEventSettlement',password:'test-password',projectId:'event',version:0,requestId:crypto.randomUUID(),expectedPreview:JSON.stringify(eventSettlementPreview(before.state,[],[]))};
  await f.db.query("UPDATE pos_sales SET lines='[{\"type\":\"product\",\"id\":\"p\",\"creatorName\":\"작가\",\"qty\":1,\"unitPrice\":500}]'");
  assert.equal((await f.invoke(close)).status,409);
  assert.equal((await f.invoke()).body.eventSettlements.length,0);
  await f.db.exec("CREATE FUNCTION reject_close() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failure'; END $$; CREATE TRIGGER reject_close_receipt BEFORE INSERT ON pos_settlement_commands FOR EACH ROW EXECUTE FUNCTION reject_close()");
  assert.equal((await f.close()).status,500);
  assert.equal((await f.invoke()).body.eventSettlements.length,0);
  assert.equal((await f.db.query('SELECT * FROM pos_event_archives')).rows.length,0);
  await f.db.exec('DROP TRIGGER reject_close_receipt ON pos_settlement_commands');
  assert.equal((await f.close()).status,200);
 }finally{await f.db.close();}
});

test('unclosed revenue remains expected; closed net, fees and creators stay frozen even after master changes',()=>{
 const data={projects:[{id:'closed',name:'마감'},{id:'open',name:'진행'}],states:[{products:[],sales:[{total:100,lines:[{type:'product',id:'p',creatorName:'변경 작가',qty:1,unitPrice:100}]}]},{products:[],sales:[{total:200,lines:[{type:'product',id:'p',creatorName:'작가',qty:1,unitPrice:200}]}]}]};
 const closures=[{projectId:'closed',closedAt:'2026-10-21',snapshot:{rows:[{creator:'작가',gross:100,fees:150,net:-50}]}}];
 const summary=revenueSummary(data,[],{start:'',end:''},closures);
 assert.equal(summary.total,300);assert.equal(summary.net,-50);assert.equal(summary.fees,150);assert.equal(summary.expectedGross,200);assert.equal(summary.pending,-50);
 assert.equal(summary.creators.length,1);assert.equal(summary.creators[0].rows.length,2);
 assert.equal(summary.events.find(e=>e.id==='open').confirmed,false);
});


test('settlement bootstrap commits before business locks and routine GET performs no DDL',async()=>{
 const f=await fixture();try{
  assert.equal((await f.invoke()).status,200);
  const firstCommit=f.statements.indexOf('COMMIT');
  const account=f.statements.findIndex(query=>/SELECT id FROM pos_admins.*FOR UPDATE/.test(query));
  assert.ok(firstCommit>=0&&account>firstCommit);
  assert.ok(f.statements.slice(0,firstCommit).some(query=>/pg_advisory_xact_lock/.test(query)));
  assert.equal(f.statements.slice(firstCommit+1).some(query=>/ALTER TABLE|CREATE TABLE/.test(query)),false);
  f.statements.length=0;
  assert.equal((await f.invoke(null,'a',{projectId:'event'})).status,200);
  assert.equal(f.statements.some(query=>/ALTER TABLE|CREATE TABLE|pg_advisory_xact_lock/.test(query)),false);
 }finally{await f.db.close();}
});

test('settlement deadlock rolls back the full payment and retries with the same request ID once',async()=>{
 let armed=false,failures=0;
 const f=await fixture({beforeQuery(query){if(armed&&query.includes('INSERT INTO pos_settlement_commands')&&failures++===0)throw Object.assign(new Error('injected deadlock'),{code:'40P01'});}});
 try{
  assert.equal((await f.close()).status,200);armed=true;
  const before=f.connects(),released=f.releases(),payment=command('addPayment',0,{amount:1000,paidAt:'2026-10-27'});
  const result=await f.invoke(payment);assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(f.connects()-before,2);assert.equal(f.releases()-released,2);
  assert.equal(result.body.settlement.version,1);assert.equal(result.body.settlement.payments.length,1);
  assert.equal((await f.db.query('SELECT COUNT(*)::int AS count FROM pos_settlement_commands WHERE id=$1',[payment.requestId])).rows[0].count,1);
  assert.equal((await f.invoke(payment)).body.settlement.payments.length,1);
 }finally{await f.db.close();}
});

test('settlement serialization retry is bounded and never retries permission or input failures',async()=>{
 let armed=false;
 const f=await fixture({beforeQuery(query){if(armed&&query.startsWith('SELECT s.* FROM pos_settlements'))throw Object.assign(new Error('internal transaction conflict'),{code:'40001'});}});
 try{
  assert.equal((await f.invoke()).status,200);armed=true;
  const before=f.connects(),released=f.releases();
  const response=await f.invoke();assert.equal(response.status,503);assert.equal(f.connects()-before,3);assert.equal(f.releases()-released,3);
  assert.equal(JSON.stringify(response.body).includes('internal transaction conflict'),false);
  armed=false;let count=f.connects();
  assert.equal((await f.invoke(command('saveDeductions',0,{projectId:'foreign',deductions:[]}))).status,404);assert.equal(f.connects()-count,1);
  count=f.connects();assert.equal((await f.invoke(command('unknown',0))).status,400);assert.equal(f.connects()-count,1);
 }finally{await f.db.close();}
});


test('settlement lifecycle completion is scoped, idempotent, reversible and gates finish including zero net',async()=>{
 const f=await fixture();try{
  assert.equal((await f.invoke(command('completeRecipientSettlement',0,{paidAt:'2026-10-29'}))).status,409);
  assert.equal((await f.close()).status,200);
  const finish=command('finishEventSettlement',1);
  assert.equal((await f.invoke(finish)).status,409);
  assert.equal((await f.invoke(command('completeRecipientSettlement',0,{paidAt:'2026-10-29'}),'b')).status,404);
  assert.equal((await f.invoke(command('completeRecipientSettlement',0,{paidAt:'2026-10-29'}))).status,409);
  const partial=command('addPayment',0,{amount:4000,paidAt:'2026-10-28',memo:''});
  assert.equal((await f.invoke(partial)).status,200);
  assert.equal((await f.invoke(command('completeRecipientSettlement',1,{paidAt:'2026-10-29'}))).status,409);
  assert.equal((await f.invoke(command('addPayment',1,{amount:6000,paidAt:'2026-10-29',memo:''}))).status,200);
  assert.equal((await f.invoke(finish)).status,409);
  const pay=command('completeRecipientSettlement',2,{paidAt:'2026-10-29'});
  let result=await f.invoke(pay);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.settlement.payments[2].amount,0);assert.equal(result.body.settlement.payments.reduce((sum,p)=>sum+p.amount,0),10000);
  assert.equal((await f.invoke(pay)).body.settlement.payments.length,3);
  assert.equal((await f.invoke({...pay,paidAt:'2026-10-30'})).status,409);
  assert.equal((await f.invoke(finish)).status,409);
  const zero=command('completeRecipientSettlement',0,{creator:'최신 이름',paidAt:'2026-10-29'});
  result=await f.invoke(zero);assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.settlement.payments[0].amount,0);
  assert.equal(result.body.settlement.payments[0].settlementComplete,true);
  result=await f.invoke(finish);assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.eventSettlement.finishedAt);
  assert.equal((await f.invoke(finish)).status,200);
  const reverse=command('reversePayment',1,{creator:'최신 이름',paymentId:zero.requestId,paidAt:'2026-10-29'});
  assert.equal((await f.invoke(reverse)).status,409);
  assert.equal((await f.invoke(command('reopenEventSettlement',2))).status,409);
  result=await f.invoke(command('resumeEventSettlement',2));assert.equal(result.status,200);assert.equal(result.body.eventSettlement.finishedAt,null);
  result=await f.invoke(reverse);assert.equal(result.status,200);assert.equal(result.body.settlement.payments.reduce((sum,p)=>sum+p.amount,0),0);
  assert.equal((await f.invoke(command('finishEventSettlement',3))).status,409);
  assert.equal((await f.invoke(command('completeRecipientSettlement',2,{creator:'최신 이름',paidAt:'2026-10-29'}))).status,200);
  assert.equal((await f.invoke(command('finishEventSettlement',3))).status,200);
 }finally{await f.db.close();}
});
