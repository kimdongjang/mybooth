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
  return { db, invoke };
}

test('warehouse allocation, sales, void, return, idempotency and account isolation preserve physical stock', async () => {
  const { db, invoke } = await fixture();
  try {
    const a = (await invoke('createProject', null, { name: '첫 행사' })).body.project.id;
    const b = (await invoke('createProject', null, { name: '다음 행사' })).body.project.id;
    const created = await invoke('saveInventory', null, { product: { name: '무료 굿즈', price: 0, stock: 10 } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const item = created.body.inventory[0];
    const move = { inventoryId: item.id, projectId: a, qty: 6, direction: 'allocate', requestId: 'allocate-a' };
    assert.equal((await invoke('transferInventory', null, move)).status, 200);
    assert.equal((await invoke('transferInventory', null, move)).status, 200);
    assert.equal((await invoke('transferInventory', null, { ...move, qty: 5 })).status, 409);
    const before = (await invoke(null, a)).body;
    assert.equal(before.products[0].stockQty, 6);
    const product = before.products[0];
    assert.equal((await invoke('replaceProducts', a, { products: [{ ...product, name: '행사 전용 이름' }] })).status, 200);
    assert.equal((await invoke('listInventory')).body.inventory[0].name, '무료 굿즈');
    const sale = { localOrderId: 'sale-shared', method: 'cash', total: 0, cart: [{ type: 'product', id: product.id, name: product.name, unitPrice: 0, qty: 2, creatorName: '' }] };
    assert.equal((await invoke('finalizeSale', a, sale)).status, 200);
    assert.equal((await invoke('finalizeSale', a, sale)).status, 200);
    assert.equal((await invoke('transferInventory', null, { ...move, direction: 'return', qty: 5, requestId: 'oversized-return' })).status, 400);
    assert.equal((await invoke('transferInventory', null, { ...move, direction: 'return', qty: 4, requestId: 'return-a' })).status, 200);
    const next = await invoke('transferInventory', null, { ...move, projectId: b, qty: 7, requestId: 'allocate-b' });
    assert.equal(next.status, 200, JSON.stringify(next.body));
    assert.equal(next.body.inventory[0].stock, 1);
    assert.equal(next.body.inventory[0].allocations.reduce((sum, row) => sum + row.stock, 0), 7);
    assert.equal((await invoke('voidSale', a, { id: sale.localOrderId })).status, 200);
    assert.equal((await invoke('finalizeSale', a, sale)).status, 200);
    const final = (await invoke('listInventory')).body.inventory[0];
    assert.equal(final.stock + final.allocations.reduce((sum, row) => sum + row.stock, 0), 10);
    assert.equal((await invoke('listInventory', null, {}, 'b')).body.inventory.length, 0);
    assert.equal((await invoke('transferInventory', null, { ...move, requestId: 'foreign' }, 'b')).status, 404);
    assert.equal((await invoke('transferInventory', null, { ...move, qty: 0, requestId: 'zero' })).status, 400);
    assert.equal((await invoke('saveInventory', null, { product: { ...final, version: -1 } })).status, 409);
    assert.equal((await invoke('replaceProducts', b, { products: [] })).status, 409);
    assert.equal((await invoke('resetDefaults', b)).status, 409);
    assert.equal((await invoke('deleteProject', b, { password: 'test-password', confirmName: '다음 행사' })).status, 409);
    assert.equal((await invoke('archiveProject', b, { password: 'test-password' })).status, 200);
    assert.equal((await invoke('transferInventory', null, { ...move, projectId: b, qty: 1, requestId: 'archived-allocate' })).status, 409);
    assert.equal((await invoke('transferInventory', null, { ...move, projectId: b, direction: 'return', qty: 7, requestId: 'archived-return' })).status, 200);
  } finally { await db.close(); }
});

test('legacy adoption preserves event IDs, separate products with matching names, history and warehouse stock on event deletion', async () => {
  const { db, invoke } = await fixture();
  try {
    const a = (await invoke('createProject', null, { name: '기존 행사' })).body.project.id;
    const b = (await invoke('createProject', null, { name: '동명 상품 행사' })).body.project.id;
    for (const id of [a,b]) await db.query("INSERT INTO pos_products (project_id,id,name,price,stock,stock_qty,initial_stock_qty) VALUES ($1,'same','같은 이름',0,5,5,5)", [id]);
    const before = (await invoke(null, a)).body;
    const first = (await invoke('listInventory')).body;
    assert.equal(first.inventory.length, 2);
    assert.ok(first.inventory.every(item => item.stock === 0 && item.allocations.length === 1));
    assert.ok(first.inventory.every(item => item.totalReceived === 5 && item.remainingStock === 5 && item.totalEstimated));
    assert.equal(new Set(first.inventory.map(item => item.productNumber)).size, 2);
    assert.deepEqual((await invoke(null, a)).body, before);
    assert.deepEqual((await invoke('listInventory')).body, first);
    const item = first.inventory.find(item => item.allocations[0].project_id === a);
    assert.equal((await invoke('transferInventory', null, { projectId: a, inventoryId: item.id, qty: 5, direction: 'return', requestId: 'legacy-return' })).status, 200);
    assert.equal((await invoke('deleteProject', a, { password: 'test-password', confirmName: '기존 행사' })).status, 200);
    const after = (await invoke('listInventory')).body.inventory.find(p => p.id === item.id);
    assert.equal(after.stock, 5);
    assert.equal(after.allocations.length, 0);
    assert.equal((await invoke(null, b)).body.products[0].stockQty, 5);
  } finally { await db.close(); }
});

test('failed transfer rolls back the event, warehouse and receipt together; versioned edits reject stale writers', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: 'rollback' })).body.project.id;
    const item = (await invoke('saveInventory', null, { product: { id: 'client-generated', version: -1, name: 'stock', price: 100, stock: 5 } })).body.inventory[0];
    const originalQuery = db.query.bind(db);
    let fail = true;
    db.query = (query, values) => {
      if (fail && query.startsWith('UPDATE pos_inventory SET stock=stock-')) { fail = false; throw new Error('injected transfer failure'); }
      return originalQuery(query, values);
    };
    const payload = { projectId: event, inventoryId: item.id, direction: 'allocate', qty: 3, requestId: 'rollback-retry' };
    assert.equal((await invoke('transferInventory', null, payload)).status, 500);
    assert.equal((await invoke(null, event)).body.products.length, 0);
    assert.equal((await invoke('listInventory')).body.inventory[0].stock, 5);
    assert.equal((await db.query('SELECT * FROM pos_inventory_transfers')).rows.length, 0);
    assert.equal((await invoke('transferInventory', null, payload)).status, 200);
    assert.equal((await invoke('saveInventory', null, { product: item })).status, 409);
    const latest = (await invoke('listInventory')).body.inventory[0];
    assert.equal((await invoke('saveInventory', null, { product: { ...latest, stock: 0, price: 0 } })).status, 200);
    assert.equal((await invoke('saveInventory', null, { product: { name: 'bad', stock: 1.5, price: 0 } })).status, 400);
    assert.equal((await invoke('saveInventory', null, { product: { name: 'bad', stock: 1, price: -1 } })).status, 400);
  } finally { await db.close(); }
});

test('account numbering, cumulative receipts, genre and event sales summaries survive moves, losses, voids and snapshots', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '판매 행사' })).body.project.id;
    const created = await invoke('saveInventory', null, { product: { name: '장르 상품', genre: '동방', stock: 10 } });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    let item = created.body.inventory[0];
    assert.match(item.productNumber, /^[A-Z]{3}_0001$/);
    const number = item.productNumber;
    const registeredAt = item.createdAt;
    assert.ok(Number.isFinite(Date.parse(registeredAt)));
    assert.equal(item.genre, '동방');
    assert.equal(item.totalReceived, 10);
    assert.equal(item.totalEstimated, false);
    const next = (await invoke('saveInventory', null, { product: { name: '다음 상품', stock: 0 } })).body.inventory.find(p => p.id !== item.id);
    assert.equal(next.productNumber, number.slice(0,4) + '0002');
    const other = (await invoke('saveInventory', null, { product: { name: '다른 계정', stock: 1 } }, 'b')).body.inventory[0];
    assert.notEqual(other.productNumber.slice(0,3), number.slice(0,3));
    const move = { inventoryId: item.id, projectId: event, qty: 6, direction: 'allocate', requestId: 'history-move' };
    await invoke('transferInventory', null, move);
    const product = (await invoke(null, event)).body.products[0];
    const sale = { localOrderId: 'historical', method: 'cash', total: 0, cart: [{ type: 'product', id: product.id, name: product.name, unitPrice: 0, qty: 2 }] };
    await invoke('finalizeSale', event, sale);
    const readItem = async () => (await invoke('listInventory')).body.inventory.find(p => p.id === item.id);
    item = await readItem();
    assert.equal(item.remainingStock, 8);
    assert.equal(item.totalReceived, 10);
    assert.equal(item.history[0].soldQty, 2);
    assert.equal(item.history[0].productId, product.id);
    assert.equal(item.history[0].projectId, event);
    let saved = await invoke('saveInventory', null, { product: { ...item, stock: 3, productNumber: 'FORGED', createdAt: '2000-01-01T00:00:00.000Z' }, stockChangeType: 'loss' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    item = await readItem();
    assert.equal(item.totalReceived, 10);
    assert.equal(item.remainingStock, 7);
    assert.equal(item.productNumber, number);
    assert.equal(item.createdAt, registeredAt);
    saved = await invoke('saveInventory', null, { product: { ...item, stock: 5 }, stockChangeType: 'receipt' });
    assert.equal(saved.status, 200);
    item = await readItem();
    assert.equal(item.totalReceived, 12);
    assert.equal(item.remainingStock, 9);
    await invoke('voidSale', event, { id: sale.localOrderId });
    item = await readItem();
    assert.equal(item.totalReceived, 12);
    assert.equal(item.remainingStock, 11);
    assert.equal(item.history[0].soldQty, 0);
    await db.query('INSERT INTO pos_bundles VALUES ($1, $2, $3, 0, $4)', [event, 'set', '세트', JSON.stringify([{ productId: product.id, qty: 2 }])]);
    assert.equal((await invoke('finalizeSale', event, { localOrderId: 'bundle-history', method: 'cash', total: 0, cart: [{ type: 'bundle', id: 'set', name: '세트', qty: 1, unitPrice: 0, subItems: [{ productId: product.id, qty: 2 }] }] })).status, 200);
    await db.query('DELETE FROM pos_bundles WHERE project_id=$1', [event]);
    item = await readItem();
    assert.equal(item.history[0].soldQty, 2);
    assert.equal(item.history[0].estimated, false);
    assert.equal(item.totalReceived, 12);
    assert.equal(item.remainingStock, 9);
    assert.equal((await db.query('SELECT * FROM pos_inventory_adjustments WHERE admin_id=$1 AND inventory_id=$2', ['a', item.id])).rows.length, 3);
    assert.equal((await invoke('saveInventory', null, { product: { ...item, stock: 4 }, stockChangeType: 'disposal' })).status, 200);
    const latest = await readItem();
    assert.equal((await invoke('saveInventory', null, { product: { ...latest, stock: 3 }, stockChangeType: 'receipt' })).status, 400);
    await db.query('UPDATE pos_inventory_numbers SET last_number=9999 WHERE admin_id=$1', ['a']);
    assert.equal((await invoke('saveInventory', null, { product: { name: '번호 초과', stock: 0 } })).status, 409);
    assert.equal((await readItem()).productNumber, number);
  } finally { await db.close(); }
});
