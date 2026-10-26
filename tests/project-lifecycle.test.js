import * as storageContract from '../api/lib/storageContract.js';
import * as eventAccess from '../api/lib/eventAccess.js';
import * as boothFoundation from '../api/lib/boothFoundation.js';
import * as eventSettlement from '../api/lib/eventSettlement.js';
import * as accountInventory from '../api/lib/accountInventory.js';
import { hashPassword } from '../api/lib/auth.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import * as defaults from '../api/lib/defaultData.js';

async function fixture() {
  const db = new PGlite();
  await db.exec("CREATE TABLE pos_admins (id TEXT PRIMARY KEY); INSERT INTO pos_admins VALUES ('a'), ('b')");
  const statements = [];
  const sql = (parts, ...values) => {
    const query = parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, '');
    statements.push(query);
    return db.query(query, values);
  };
  const context = vm.createContext({ URL, crypto: globalThis.crypto });
  const module = new vm.SourceTextModule(await readFile(new URL('../api/pos.js', import.meta.url), 'utf8'), { context });
  await module.link(specifier => {
    const exports = specifier === '@vercel/postgres' ? { sql: { connect: async () => ({ sql, query: query => { statements.push(query); return db.query(query); }, release() {} }) } }
      : specifier === './lib/auth.js' ? {
        hashPassword,
        assertPostgresConnectionString() {},
        requireAuth(req, res) { if (req.adminId) return { id: req.adminId }; res.status(401).json({ error: 'Unauthorized' }); return null; },
        validateAdminPassword: async (_id, password) => password === 'test-password',
      } : specifier === './lib/storageContract.js' ? storageContract : specifier === './lib/eventAccess.js' ? eventAccess : specifier === './lib/boothFoundation.js' ? boothFoundation : specifier === './lib/accountInventory.js' ? accountInventory : specifier === './lib/eventSettlement.js' ? eventSettlement : defaults;
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  const invoke = async (action, projectId, payload = {}, adminId = 'a') => {
    const result = {};
    await module.namespace.default({ method: action ? 'POST' : 'GET', adminId, query: { projectId }, body: { action, projectId, payload } }, {
      status(code) { result.status = code; return this; },
      json(body) { result.body = JSON.parse(JSON.stringify(body)); return this; },
    });
    return result;
  };
  const first = await invoke('createProject', null, { name: 'original' });
  assert.equal(first.status, 201);
  const id = first.body.project.id;
  await db.query(`INSERT INTO pos_products (project_id,id,name,price,stock,stock_qty,initial_stock_qty,creator_name,is_active,image_url) VALUES
    ($1,'p1','free',0,7,7,10,'creator',true,'https://test.public.blob.vercel-storage.com/products/source/p1/image.png'),
    ($1,'p2','inactive',500,2,2,3,'other',false,null)`, [id]);
  await db.query(`INSERT INTO pos_bundles VALUES ($1,'b1','bundle',0,'[{"productId":"p1","qty":2}]')`, [id]);
  await db.query(`INSERT INTO pos_sales VALUES ($1,'sale1','2026-10-15T00:00:00Z','cash',0,'[{"type":"bundle","id":"b1","name":"bundle","unitPrice":0,"qty":1}]')`, [id]);
  return { db, id, invoke, statements };
}

test('custom product name survives catalog saves and stock edits while historical sales remain unchanged', async () => {
  const { db, id, invoke } = await fixture();
  try {
    const before = (await invoke(null, id)).body;
    const products = before.products.map(product => product.id === 'p1' ? { ...product, name: '한정 상품 (리뉴얼)', goodsType: '키링', vtuberName: '캐릭터', initialStockQty: 120, stockQty: 100, stock: 100 } : product);
    const saved = await invoke('replaceProducts', id, { products });
    assert.equal(saved.status, 200);
    const updated = saved.body.products.find(product => product.id === 'p1');
    assert.equal(updated.name, '한정 상품 (리뉴얼)');
    assert.equal(updated.stockQty, 100);
    assert.equal(updated.initialStockQty, 120);
    assert.deepEqual(saved.body.sales, before.sales);
    const again = await invoke('replaceProducts', id, { products: saved.body.products.map(product => product.id === 'p1' ? { ...product, stockQty: 99, stock: 99 } : product) });
    assert.equal(again.status, 200);
    assert.equal(again.body.products.find(product => product.id === 'p1').name, '한정 상품 (리뉴얼)');
  } finally { await db.close(); }
});

test('password-protected archive/unarchive locks every mutation and preserves settlement', async () => {
  const { db, id, invoke, statements } = await fixture();
  try {
    for (const action of ['archiveProject', 'unarchiveProject', 'duplicateProject', 'renameProject']) {
      assert.equal((await invoke(action, id, { name: 'copy' })).status, 403, action);
      assert.equal((await invoke(action, id, { password: 'test-password', name: 'copy' }, 'b')).status, 404, action);
    }
    const archived = await invoke('archiveProject', id, { password: 'test-password' });
    assert.equal(archived.status, 200);
    assert.ok(archived.body.projects[0].archivedAt);
    for (const action of ['replaceProducts', 'replaceBundles', 'updateProductImage', 'finalizeSale', 'voidSale', 'clearSales', 'resetDefaults', 'upsertDefaults', 'renameProject']) {
      const result = await invoke(action, id, { password: 'test-password', name: 'renamed' });
      assert.equal(result.status, 409, `${action}: ${JSON.stringify(result.body)}`);
    }
    const state = await invoke(null, id);
    assert.ok(state.body.archivedAt);
    assert.equal(state.body.sales.length, 1);
    assert.equal(state.body.products[0].stock, 7);
    assert.equal((await db.query('SELECT * FROM pos_products WHERE project_id = $1', [id])).rows.length, 2);
    assert.equal((await invoke('unarchiveProject', id, { password: 'wrong' })).status, 403);
    assert.equal((await invoke('unarchiveProject', id, { password: 'test-password' })).status, 200);
    assert.equal((await invoke(null, id)).body.archivedAt, null);
    assert.equal((await invoke('renameProject', id, { name: 'reopened', password: 'test-password' })).status, 200);
    assert.ok(statements.some(query => query.includes('FOR UPDATE')));
    assert.ok(statements.includes('BEGIN ISOLATION LEVEL REPEATABLE READ'));
    assert.ok(statements.includes('ROLLBACK'));
  } finally { await db.close(); }
});

test('account snapshot restores all data, keeps other owners and rejects tampering; duplicate resets stock', async () => {
 const {db,id,invoke}=await fixture();
 try {
  const other=(await invoke('createProject',null,{name:'other'},'b')).body.project.id;
  const result=await invoke('backupAccount');assert.equal(result.status,200,JSON.stringify(result.body));const backup=result.body.backup;
  assert.equal(backup.data.tables.pos_products.length,2);assert.equal(backup.data.tables.pos_sales.length,1);
  assert.equal(JSON.stringify(backup).includes('password_hash'),false);
  const copy=await invoke('duplicateProject',id,{password:'test-password',name:'copy'});assert.equal(copy.status,201);
  assert.equal((await invoke(null,copy.body.project.id)).body.products[0].stockQty,0);
  const payload={backup,password:'test-password',requestId:crypto.randomUUID()};
  assert.equal((await invoke('restoreAccount',null,{...payload,password:'wrong'})).status,403);
  assert.equal((await invoke('restoreAccount',null,payload,'b')).status,400);
  const invalid=structuredClone(backup);invalid.data.tables.pos_products[0].price=-1;
  assert.equal((await invoke('restoreAccount',null,{...payload,backup:invalid})).status,400);
  const restored=await invoke('restoreAccount',null,payload);assert.equal(restored.status,200,JSON.stringify(restored.body));
  assert.equal((await invoke(null,id)).body.products[0].stockQty,7);
  assert.equal((await invoke(null,id)).body.sales[0].total,0);
  assert.equal((await invoke(null,other,{},'b')).status,200);
  assert.equal((await invoke(null,copy.body.project.id)).status,500);
  const fresh=(await invoke(null,id)).body;
  assert.ok(fresh.dataRevision);
  assert.equal((await invoke('finalizeSale',id,{localOrderId:'old-client',method:'cash',total:0,cart:[{type:'product',id:'p1',qty:1,unitPrice:0}]})).status,409);
  assert.equal((await invoke('restoreAccount',null,payload)).status,200);
  assert.equal((await invoke('backupProject',id)).status,403);assert.equal((await invoke('restoreProject',null)).status,403);
 }finally{await db.close();}
});

test('snapshot restore failure rolls back every deletion and can retry the same request',async()=>{
 const {db,id,invoke}=await fixture();try{
  const backup=(await invoke('backupAccount')).body.backup;
  await db.query("UPDATE pos_products SET stock=6,stock_qty=6 WHERE project_id=$1 AND id='p1'",[id]);
  await db.exec("CREATE FUNCTION fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failure'; END $$; CREATE TRIGGER reject_restore BEFORE INSERT ON pos_sales FOR EACH ROW EXECUTE FUNCTION fail_restore()");
  const payload={backup,password:'test-password',requestId:crypto.randomUUID()};
  assert.equal((await invoke('restoreAccount',null,payload)).status,500);
  assert.equal((await invoke(null,id)).body.products[0].stockQty,6);assert.equal((await invoke(null,id)).body.sales.length,1);
  await db.exec('DROP TRIGGER reject_restore ON pos_sales');
  const retried=await invoke('restoreAccount',null,payload);assert.equal(retried.status,200,JSON.stringify(retried.body));
  assert.equal((await invoke(null,id)).body.products[0].stockQty,7);
 }finally{await db.close();}
});

test('sale failure rolls back stock and unauthenticated requests never initialize the database', async () => {
  const { db, id, invoke, statements } = await fixture();
  try {
    const before = statements.length;
    assert.equal((await invoke('backupProject', id, {}, null)).status, 401);
    assert.equal(statements.length, before);
    await db.exec(`CREATE FUNCTION fail_sale() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected sale failure'; END $$;
      CREATE TRIGGER reject_sale BEFORE INSERT ON pos_sales FOR EACH ROW EXECUTE FUNCTION fail_sale()`);
    const result = await invoke('finalizeSale', id, { localOrderId: 'failed-sale', method: 'cash', total: 0, cart: [{ type: 'product', id: 'p1', name: 'free', unitPrice: 0, qty: 1 }] });
    assert.equal(result.status, 500);
    assert.equal((await db.query("SELECT stock_qty FROM pos_products WHERE project_id = $1 AND id = 'p1'", [id])).rows[0].stock_qty, 7);
    assert.equal((await db.query('SELECT * FROM pos_sales WHERE project_id = $1', [id])).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM pos_sale_receipts WHERE project_id = $1', [id])).rows.length, 0);
  } finally { await db.close(); }
});

test('sale receipts prevent replay after void/clear and cancellation uses historical bundle stock', async () => {
  const { db, id, invoke } = await fixture();
  try {
    const payload = { localOrderId: 'retry-sale', method: 'cash', total: 0, cart: [{ type: 'bundle', id: 'b1', name: 'bundle', unitPrice: 0, qty: 1 }] };
    assert.equal((await invoke('finalizeSale', id, payload)).status, 200);
    assert.equal((await invoke('finalizeSale', id, payload)).status, 200);
    assert.equal((await db.query("SELECT stock_qty FROM pos_products WHERE project_id=$1 AND id='p1'", [id])).rows[0].stock_qty, 5);
    const recorded = (await invoke(null, id)).body.sales.find(s => s.id === 'retry-sale');
    assert.equal(recorded.lines[0].subItems[0].creatorName, 'creator');
    await db.query("UPDATE pos_bundles SET items='[{\"productId\":\"p2\",\"qty\":1}]' WHERE project_id=$1 AND id='b1'", [id]);
    assert.equal((await invoke('voidSale', id, { id: 'retry-sale' })).status, 200);
    assert.equal((await invoke('voidSale', id, { id: 'retry-sale' })).status, 200);
    assert.equal((await invoke('finalizeSale', id, payload)).status, 200);
    const stock = (await db.query('SELECT id,stock_qty FROM pos_products WHERE project_id=$1 ORDER BY id', [id])).rows;
    assert.deepEqual(stock.map(p => p.stock_qty), [7, 2]);
    assert.ok(!(await invoke(null, id)).body.sales.some(s => s.id === 'retry-sale'));
    // A cancellation arriving before the sale leaves a durable tombstone.
    await invoke('voidSale', id, { id: 'late-sale' });
    await invoke('finalizeSale', id, { ...payload, localOrderId: 'late-sale' });
    assert.ok(!(await invoke(null, id)).body.sales.some(s => s.id === 'late-sale'));
    await invoke('clearSales', id, { password: 'test-password' });
    await invoke('finalizeSale', id, { ...payload, localOrderId: 'sale1' });
    assert.equal((await invoke(null, id)).body.sales.length, 0);
    for (const patch of [{ total: -1 }, { method: 'card' }, { cart: [{ ...payload.cart[0], qty: 0 }] }, { cart: [{ ...payload.cart[0], qty: 1.5 }] }, { cart: [{ ...payload.cart[0], unitPrice: -1 }] }]) {
      assert.equal((await invoke('finalizeSale', id, { ...payload, localOrderId: 'invalid', ...patch })).status, 500);
    }
  } finally { await db.close(); }
});

test('bundle snapshot mismatch and malformed restored component quantities preserve server state', async () => {
  const { db, id, invoke } = await fixture();
  try {
    const result = await invoke('finalizeSale', id, { localOrderId: 'conflict', method: 'cash', total: 0, cart: [{ type: 'bundle', id: 'b1', name: 'bundle', qty: 1, unitPrice: 0, subItems: [{ productId: 'p2', qty: 1 }] }] });
    assert.equal(result.status, 409);
    assert.equal((await db.query('SELECT * FROM pos_sale_receipts WHERE project_id=$1', [id])).rows.length, 0);
    assert.equal((await invoke(null, id)).body.products[0].stock, 7);
    const backup = (await invoke('backupAccount')).body.backup;
    backup.data.tables.pos_sales[0].lines[0].subItems = [{productId:'p1',qty:-2,unitPrice:0}];
    assert.equal((await invoke('restoreAccount',null,{password:'test-password',backup,requestId:crypto.randomUUID()})).status,400);
    assert.equal((await db.query('SELECT * FROM pos_projects')).rows.length, 1);
  } finally { await db.close(); }
});


test('event backup includes settlement and restoration creates one archived event without overwriting any existing data',async()=>{
 const {db,id,invoke}=await fixture();try{
  await db.exec(`CREATE TABLE pos_settlements(admin_id TEXT,project_id TEXT,creator TEXT,version INTEGER,deductions JSONB,payments JSONB)`);
  await db.query(`INSERT INTO pos_settlements VALUES('a',$1,'creator',1,'[]','[{"id":"paid","amount":0,"date":"2026-10-23"}]')`,[id]);
  await db.query(`INSERT INTO pos_event_settlements(admin_id,project_id,version,costs,snapshot,closed_at,history) VALUES('a',$1,2,'[{"label":"부스임대료","memo":"","type":"fixed","split":"equal","value":500}]','{"rows":[],"gross":0}',NOW(),'[]')`,[id]);
  const original=(await db.query('SELECT * FROM pos_products WHERE project_id=$1 ORDER BY id',[id])).rows;
  assert.equal((await invoke('backupProject',id,{password:'wrong'})).status,403);
  assert.equal((await invoke('backupProject',id,{password:'test-password'},'b')).status,404);
  const exported=await invoke('backupProject',id,{password:'test-password'});assert.equal(exported.status,200,JSON.stringify(exported.body));
  const backup=exported.body.backup;assert.equal(backup.version,2);assert.equal(backup.closure.costs[0].value,500);assert.equal(backup.settlements.length,1);assert.equal(JSON.stringify(backup).includes('password_hash'),false);
  const payload={backup,name:'복원 행사',password:'test-password',requestId:crypto.randomUUID()};
  const restored=await invoke('restoreProject',null,payload);assert.equal(restored.status,201,JSON.stringify(restored.body));const next=restored.body.project.id;
  assert.notEqual(next,id);assert.ok(restored.body.project.archivedAt);
  assert.equal((await db.query("SELECT stock_qty FROM pos_products WHERE project_id=$1 AND id='p1'",[next])).rows[0].stock_qty,7);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_sales WHERE project_id=$1',[next])).rows[0].n,1);
  assert.equal((await db.query('SELECT costs FROM pos_event_settlements WHERE project_id=$1',[next])).rows[0].costs[0].value,500);
  assert.deepEqual((await db.query('SELECT * FROM pos_products WHERE project_id=$1 ORDER BY id',[id])).rows,original);
  const replay=await invoke('restoreProject',null,payload);assert.equal(replay.status,200);assert.equal(replay.body.project.id,next);
  assert.equal((await invoke('restoreProject',null,{...payload,name:'다른 이름'})).status,409);
  for(const bad of [{...backup,version:99},{...backup,format:'other'},{...backup,products:[{...backup.products[0],stock:-1}]},{...backup,closure:{...backup.closure,costs:[{label:'bad',type:'percent',split:'equal',memo:'',value:10001}]}}])assert.equal((await invoke('restoreProject',null,{...payload,requestId:crypto.randomUUID(),backup:bad})).status,400);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_projects')).rows[0].n,2);
 }finally{await db.close();}
});

test('event restore is atomic after an injected failure and duplication replays without copying sales or stock',async()=>{
 const {db,id,invoke}=await fixture();try{
  const backup=(await invoke('backupProject',id,{password:'test-password'})).body.backup;
  const payload={backup,name:'retry',password:'test-password',requestId:crypto.randomUUID()};
  await db.exec("CREATE FUNCTION fail_event_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failure'; END $$; CREATE TRIGGER reject_event_import BEFORE INSERT ON pos_sales FOR EACH ROW EXECUTE FUNCTION fail_event_import()");
  assert.equal((await invoke('restoreProject',null,payload)).status,500);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_projects')).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pos_project_imports')).rows[0].n,0);
  await db.exec('DROP TRIGGER reject_event_import ON pos_sales');
  assert.equal((await invoke('restoreProject',null,payload)).status,201);
  const copyPayload={name:'copy',password:'test-password',requestId:crypto.randomUUID()};
  const copy=await invoke('duplicateProject',id,copyPayload);assert.equal(copy.status,201,JSON.stringify(copy.body));
  assert.equal((await invoke('duplicateProject',id,copyPayload)).body.project.id,copy.body.project.id);
  const state=(await invoke(null,copy.body.project.id)).body;assert.equal(state.sales.length,0);assert.ok(state.products.every(p=>p.stockQty===0&&p.initialStockQty===0));
  assert.equal((await invoke('duplicateProject',id,{...copyPayload,name:'changed'})).status,409);
 }finally{await db.close();}
});
