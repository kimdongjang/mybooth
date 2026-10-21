import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { settlementMoneyEntries } from '../src/utils/settlementEntries.js';
import { koreanDay, periodRange, revenueSummary, settlementCsv } from '../src/utils/revenueSummary.js';

async function fixture() {
  const db=new PGlite();
  await db.exec(`CREATE TABLE pos_admins(id TEXT PRIMARY KEY,deleted_at TIMESTAMPTZ);INSERT INTO pos_admins(id)VALUES('a'),('b');
    CREATE TABLE pos_projects(id TEXT PRIMARY KEY,admin_id TEXT);INSERT INTO pos_projects VALUES('event','a'),('foreign','b');
    CREATE TABLE pos_products(project_id TEXT,id TEXT,name TEXT,creator_name TEXT,price INTEGER,is_active BOOLEAN);
    CREATE TABLE pos_inventory_links(admin_id TEXT,project_id TEXT,product_id TEXT,inventory_id TEXT);
    CREATE TABLE pos_inventory(admin_id TEXT,id TEXT,product JSONB);
    INSERT INTO pos_products VALUES('event','p','키링','최신 이름',9999,TRUE);
    CREATE TABLE pos_bundles(project_id TEXT,id TEXT,items JSONB);
    CREATE TABLE pos_sales(project_id TEXT,lines JSONB);
    INSERT INTO pos_sales VALUES('event','[{"type":"product","id":"p","name":"키링","creatorName":"작가","unitPrice":1000,"qty":10}]');`);
  let connects=0,tail=Promise.resolve();
  const pool={connect:async()=>{connects++;const prior=tail;let release;tail=new Promise(resolve=>release=resolve);await prior;return {sql:(parts,...values)=>db.query(parts.reduce((s,p,i)=>s+(i?`$${i}`:'')+p,''),values),query:query=>db.query(query),release};}};
  const context=vm.createContext({});
  const module=new vm.SourceTextModule(await readFile(new URL('../api/settlements.js',import.meta.url),'utf8'),{context});
  await module.link(name=>{const exports=name==='@vercel/postgres'?{sql:pool}:name.endsWith('auth.js')?{assertPostgresConnectionString(){},requireAuth(req,res){if(req.adminId)return{id:req.adminId};res.status(401).json({error:'Unauthorized'});return null;}}:{settlementMoneyEntries};return new vm.SyntheticModule(Object.keys(exports),function(){for(const[key,value]of Object.entries(exports))this.setExport(key,value);},{context});});
  await module.evaluate();
  const invoke=async(body=null,adminId='a')=>{const result={};await module.namespace.default({adminId,method:body?'POST':'GET',body},{status(status){result.status=status;return this;},json(value){result.body=JSON.parse(JSON.stringify(value));return this;}});return result;};
  return{db,invoke,connects:()=>connects};
}
const command=(action,version,extra={})=>({action,version,projectId:'event',creator:'작가',requestId:crypto.randomUUID(),...extra});

test('settlement deductions, partial payments, replay, stale versions and reversals preserve exact balances',async()=>{
  const f=await fixture();try{
    assert.equal((await f.invoke(null,null)).status,401);assert.equal(f.connects(),0);
    const fee=command('saveDeductions',0,{deductions:[{label:'운영비',amount:1000},{label:'수수료',amount:500}]});
    let result=await f.invoke(fee);assert.equal(result.status,200);assert.equal(result.body.settlement.version,1);
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
  for(const paidAt of ['2026-02-30','2026-13-01',''])assert.equal((await f.invoke(command('addPayment',0,{amount:1,paidAt}))).status,400);
  assert.equal((await f.invoke(command('saveDeductions',0,{deductions:[]}))).status,200);
  assert.deepEqual((await f.invoke(null,'b')).body.settlements,[]);
  await f.db.exec("UPDATE pos_admins SET deleted_at=NOW() WHERE id='a'");
  assert.equal((await f.invoke()).status,401);
 }finally{await f.db.close();}
});

test('ledger writes roll back with receipt failures and concurrent stale payments cannot both commit',async()=>{
 const f=await fixture();try{
  await f.invoke();
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
 const summary=revenueSummary(data,records,{start:'2026-10-01',end:'2026-10-01'});
 assert.equal(summary.total,10000);assert.equal(summary.pending,5000);assert.equal(summary.creators[0].net,8000);
 const excluded=revenueSummary(data,records,{start:'2026-11-01',end:'2026-11-30'});assert.equal(excluded.total,0);assert.equal(excluded.pending,5000);
 const csv=settlementCsv(summary.creators);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=작가"));assert.ok(csv.includes('"행사,이름"'));
 const cancelled=revenueSummary({...data,states:[{products:[],sales:[]}]},records,{start:'',end:''});assert.equal(cancelled.pending,0);assert.equal(cancelled.creators[0].overpaid,3000);
});


test('bundle payment rounding conserves every won across creators',()=>{
 const entries=settlementMoneyEntries({type:'bundle',qty:1,unitPrice:100,subItems:['a','b','c'].map(creatorName=>({creatorName,productId:creatorName,qty:1,unitPrice:1}))},{},[]);
 assert.deepEqual(entries.map(entry=>entry.amount),[34,33,33]);
 assert.equal(entries.reduce((sum,entry)=>sum+entry.amount,0),100);
});
