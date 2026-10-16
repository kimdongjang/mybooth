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
        assertPostgresConnectionString() {},
        requireAuth(req, res) { if (req.adminId) return { id: req.adminId }; res.status(401).json({ error: 'Unauthorized' }); return null; },
        validateAdminPassword: async (_id, password) => password === 'test-password',
      } : defaults;
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

test('legacy initial stock correction persists across save and reload without changing remaining stock or sales', async () => {
  const { db, id, invoke } = await fixture();
  try {
    await db.query('UPDATE pos_products SET initial_stock_qty = 0 WHERE project_id = $1 AND id = $2', [id, 'p1']);
    const before = (await invoke(null, id)).body;
    const product = before.products.find(product => product.id === 'p1');
    assert.equal(product.initialStockQty, 0);
    assert.equal(product.stockQty, 7);
    const soldQty = 2; // fixture sale: one bundle containing two p1 units
    const initialStockQty = soldQty + product.stockQty;
    const saved = await invoke('replaceProducts', id, { products: before.products.map(item => item.id === product.id ? { ...item, initialStockQty } : item) });
    assert.equal(saved.status, 200);
    const reloaded = (await invoke(null, id)).body;
    const updated = reloaded.products.find(item => item.id === product.id);
    assert.equal(updated.initialStockQty, 9);
    assert.equal(updated.stockQty, 7);
    assert.deepEqual(reloaded.sales, before.sales);
    assert.equal((await db.query('SELECT initial_stock_qty FROM pos_products WHERE project_id = $1 AND id = $2', [id, product.id])).rows[0].initial_stock_qty, 9);
  } finally { await db.close(); }
});

test('password-protected archive/unarchive locks every mutation and preserves settlement', async () => {
  const { db, id, invoke, statements } = await fixture();
  try {
    for (const action of ['archiveProject', 'unarchiveProject', 'duplicateProject', 'backupProject', 'renameProject']) {
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

test('duplicate resets stock/sales; full backup restores isolated archived project including inactive products', async () => {
  const { db, id, invoke } = await fixture();
  try {
    const password = 'test-password';
    const backupResult = await invoke('backupProject', id, { password });
    assert.equal(backupResult.status, 200);
    const backup = backupResult.body.backup;
    assert.equal(backup.format, 'my-booth-project');
    assert.equal(backup.products.length, 2);
    assert.equal(backup.sales.length, 1);
    assert.equal(JSON.stringify(backup).includes('test-password'), false);
    const copy = await invoke('duplicateProject', id, { password, name: 'next event' });
    assert.equal(copy.status, 201, JSON.stringify(copy.body));
    assert.notEqual(copy.body.project.id, id);
    assert.equal(copy.body.project.archivedAt, null);
    const copied = (await db.query('SELECT * FROM pos_products WHERE project_id = $1 ORDER BY id', [copy.body.project.id])).rows;
    assert.equal(copied.length, 2);
    assert.ok(copied.every(p => p.stock === 0 && p.stock_qty === 0 && p.initial_stock_qty === 0));
    assert.equal(copied[0].price, 0);
    assert.equal(copied[0].image_url, backup.products[0].image_url);
    assert.equal((await invoke(null, copy.body.project.id)).body.sales.length, 0);
    assert.equal((await invoke(null, copy.body.project.id)).body.bundles[0].items[0].qty, 2);
    assert.equal((await invoke('restoreProject', null, { name: 'restored', backup })).status, 403);
    // A file cannot choose an existing project or a different owner.
    backup.project.id = id; backup.project.admin_id = 'a';
    const restored = await invoke('restoreProject', null, { password, name: 'restored', backup }, 'b');
    assert.equal(restored.status, 201, JSON.stringify(restored.body));
    const restoredId = restored.body.project.id;
    assert.notEqual(restoredId, id);
    assert.ok(restored.body.project.archivedAt);
    assert.equal((await db.query('SELECT admin_id FROM pos_projects WHERE id = $1', [restoredId])).rows[0].admin_id, 'b');
    const reexport = (await invoke('backupProject', restoredId, { password }, 'b')).body.backup;
    for (const key of ['products', 'bundles', 'sales']) {
      const withoutScope = rows => rows.map(({ project_id, ...row }) => row);
      assert.deepEqual(withoutScope(reexport[key]), withoutScope(backup[key]));
    }
    assert.equal((await invoke('unarchiveProject', restoredId, { password }, 'a')).status, 404);
    assert.equal((await invoke('unarchiveProject', restoredId, { password }, 'b')).status, 200);
    assert.equal((await invoke(null, id)).body.products[0].stock, 7);
  } finally { await db.close(); }
});

test('malformed backup rejects without writes and injected restore failure rolls back the whole project', async () => {
  const { db, id, invoke } = await fixture();
  try {
    const password = 'test-password';
    const backup = (await invoke('backupProject', id, { password })).body.backup;
    for (const edit of [b => { b.version = 2; }, b => { b.products[0].price = -1; }, b => { b.bundles[0].items[0].qty = 0.5; }, b => { b.sales[0].total = -10; }, b => { b.products.push(b.products[0]); }, b => { b.products[0].image_url = 'javascript:alert(1)'; }]) {
      const invalid = structuredClone(backup); edit(invalid);
      assert.equal((await invoke('restoreProject', null, { password, name: 'bad', backup: invalid })).status, 400);
    }
    assert.equal((await db.query('SELECT * FROM pos_projects')).rows.length, 1);
    const oversized = structuredClone(backup);
    oversized.project.extra = 'x'.repeat(3 * 1024 * 1024);
    assert.equal((await invoke('restoreProject', null, { password, name: 'too large', backup: oversized })).status, 400);
    await db.query("UPDATE pos_products SET set_description = $1 WHERE project_id = $2 AND id = 'p1'", ['x'.repeat(3 * 1024 * 1024), id]);
    assert.equal((await invoke('backupProject', id, { password })).status, 413);
    await db.query("UPDATE pos_products SET set_description = NULL WHERE project_id = $1 AND id = 'p1'", [id]);
    await db.exec(`CREATE FUNCTION fail_restore() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$;
      CREATE TRIGGER reject_restored_sales BEFORE INSERT ON pos_sales FOR EACH ROW EXECUTE FUNCTION fail_restore()`);
    const result = await invoke('restoreProject', null, { password, name: 'failed', backup });
    assert.equal(result.status, 500);
    assert.equal((await db.query('SELECT * FROM pos_projects')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM pos_products')).rows.length, 2);
    assert.equal((await db.query('SELECT * FROM pos_bundles')).rows.length, 1);
    assert.equal((await db.query('SELECT * FROM pos_sales')).rows.length, 1);
    await db.exec('DROP TRIGGER reject_restored_sales ON pos_sales');
    assert.equal((await invoke('restoreProject', null, { password, name: 'retry', backup })).status, 201);
  } finally { await db.close(); }
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
    const backup = (await invoke('backupProject', id, { password: 'test-password' })).body.backup;
    backup.sales[0].lines[0].subItems = [{ productId: 'p1', qty: -2, unitPrice: 0 }];
    assert.equal((await invoke('restoreProject', null, { password: 'test-password', name: 'bad', backup })).status, 400);
    assert.equal((await db.query('SELECT * FROM pos_projects')).rows.length, 1);
  } finally { await db.close(); }
});
