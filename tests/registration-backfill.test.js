import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { backfillMissingInventoryDates } from '../scripts/backfillInventoryRegistrationDates.mjs';

async function fixture(){
 const db=new PGlite();
 await db.exec("CREATE TABLE pos_admins(id TEXT PRIMARY KEY); INSERT INTO pos_admins VALUES('a'),('b'); CREATE TABLE pos_projects(id TEXT,admin_id TEXT); INSERT INTO pos_projects VALUES('event','a'); CREATE TABLE pos_inventory(admin_id TEXT,id TEXT,product JSONB,stock INTEGER,version INTEGER DEFAULT 0)");
 for(const [owner,id,product] of [['a','missing',{name:'상품'}],['a','null',{createdAt:null}],['a','blank',{createdAt:'  '}],['a','dated',{createdAt:'2026-01-01T00:00:00Z'}],['a','removed',{removedAt:'2026-01-01'}],['b','foreign',{}]]) await db.query('INSERT INTO pos_inventory VALUES($1,$2,$3::jsonb,7,3)',[owner,id,JSON.stringify(product)]);
 return db;
}

test('date backfill previews without changes, backs up first, fills only missing owned active dates and is repeatable',async()=>{
 const db=await fixture();
 try{
  const before=(await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows;
  assert.equal((await backfillMissingInventoryDates(db,{adminId:'a',date:'2026-10-19'})).matchingCount,3);
  assert.deepEqual((await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows,before);
  const result=await backfillMissingInventoryDates(db,{adminId:'a',date:'2026-10-19',apply:true,backup:async data=>{
   assert.equal(data.items.length,3);
   assert.deepEqual((await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows,before);
  }});
  assert.equal(result.updatedCount,3);
  const after=(await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows;
  for(let i=0;i<after.length;i++){
   const row=after[i],old=before[i];
   assert.equal(row.stock,old.stock);
   if(['missing','null','blank'].includes(row.id)){assert.equal(row.product.createdAt,'2026-10-19T00:00:00+09:00');assert.equal(row.version,4);}
   else assert.deepEqual(row,old);
  }
  assert.equal((await backfillMissingInventoryDates(db,{adminId:'a',date:'2026-10-19',apply:true,backup:async()=>{}})).updatedCount,0);
 }finally{await db.close();}
});

test('date backfill validates scope/date and rolls back backup or database failures',async()=>{
 const db=await fixture();
 try{
  const before=(await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows;
  await assert.rejects(backfillMissingInventoryDates(db,{adminId:'',date:'2026-10-19'}));
  await assert.rejects(backfillMissingInventoryDates(db,{adminId:'a',date:'2026-02-30'}));
  await assert.rejects(backfillMissingInventoryDates(db,{adminId:'a',date:'2026-10-19',apply:true}));
  await assert.rejects(backfillMissingInventoryDates(db,{adminId:'a',date:'2026-10-19',apply:true,backup:async()=>{throw new Error('backup failed');}}));
  assert.deepEqual((await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows,before);
  await db.exec("CREATE FUNCTION reject_date() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER reject_date BEFORE UPDATE ON pos_inventory FOR EACH ROW EXECUTE FUNCTION reject_date()");
  await assert.rejects(backfillMissingInventoryDates(db,{adminId:'a',date:'2026-10-19',apply:true,backup:async()=>{}}));
  assert.deepEqual((await db.query('SELECT * FROM pos_inventory ORDER BY id')).rows,before);
 }finally{await db.close();}
});
