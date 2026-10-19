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

test('event registration atomically creates inventory, event price and allocation; replay never restores sold stock', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '등록 행사' })).body.project.id;
    const other = (await invoke('createProject', null, { name: '다른 행사' })).body.project.id;
    const product = { id: 'registration-1', name: ' 새 키링 ', goodsType: '아크릴', vtuberName: '캐릭터', creatorName: '작가', genre: '게임', price: 1000, stockQty: 10 };
    const payload = { projectId: event, product };
    const registered = await invoke('createEventProduct', null, payload);
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    assert.equal(registered.body.products.length, 1);
    assert.equal(registered.body.products[0].price, 1000);
    assert.equal(registered.body.products[0].stockQty, 10);
    const original = (await invoke('listInventory')).body.inventory[0];
    assert.equal(original.name, '새 키링');
    assert.equal(original.genre, '게임');
    assert.equal(original.creatorName, '작가');
    assert.equal(original.vtuberName, '캐릭터');
    assert.equal(original.goodsType, '아크릴');
    assert.equal(original.price, 0);
    assert.equal(original.stock, 0);
    assert.equal(original.totalReceived, 10);
    assert.equal(original.remainingStock, 10);
    assert.equal(original.allocations[0].project_id, event);
    assert.equal((await invoke('createEventProduct', null, payload)).status, 200);
    assert.equal((await invoke('createEventProduct', null, { ...payload, product: { ...product, price: 2000 } })).status, 409);
    assert.equal((await invoke('createEventProduct', null, { ...payload, projectId: other })).status, 409);
    assert.equal((await invoke('createEventProduct', null, payload, 'b')).status, 404);
    assert.equal((await invoke(null, other)).body.products.length, 0);
    const sale = { localOrderId: 'registered-sale', method: 'cash', total: 2000, cart: [{ type: 'product', id: product.id, name: '새 키링', unitPrice: 1000, qty: 2 }] };
    assert.equal((await invoke('finalizeSale', event, sale)).status, 200);
    assert.equal((await invoke('createEventProduct', null, payload)).body.products[0].stockQty, 8);
    assert.equal((await invoke('listInventory')).body.inventory[0].remainingStock, 8);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM pos_inventory_adjustments')).rows[0].n), 1);
    assert.equal(Number((await db.query('SELECT COUNT(*) AS n FROM pos_inventory_links')).rows[0].n), 1);
    const free = await invoke('createEventProduct', null, { projectId: other, product: { ...product, id: 'free-zero', price: 0, stockQty: 0 } });
    assert.equal(free.status, 200);
    assert.equal(free.body.products[0].price, 0);
    assert.equal((await invoke('listInventory')).body.inventory.find(item => item.id === 'free-zero').allocations.length, 1);
  } finally { await db.close(); }
});

test('event registration validates ownership, archive, integer bounds and rolls back failures after inventory creation', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '검증 행사' })).body.project.id;
    const product = { id: 'validation-product', name: '상품', goodsType: '키링', vtuberName: '', creatorName: '', genre: '', price: 1000, stockQty: 3 };
    for (const patch of [{ price: -1 }, { price: 1.5 }, { price: 2147483648 }, { stockQty: -1 }, { stockQty: 0.5 }, { stockQty: 2147483648 }, { name: '' }, { goodsType: '' }, { genre: 'x'.repeat(201) }]) {
      assert.equal((await invoke('createEventProduct', null, { projectId: event, product: { ...product, ...patch } })).status, 400);
    }
    assert.equal((await invoke('createEventProduct', null, { projectId: event, product }, 'b')).status, 404);
    await db.query('UPDATE pos_projects SET archived_at=NOW() WHERE id=$1', [event]);
    assert.equal((await invoke('createEventProduct', null, { projectId: event, product })).status, 409);
    await db.query('UPDATE pos_projects SET archived_at=NULL WHERE id=$1', [event]);
    await db.exec("CREATE FUNCTION fail_registration_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected registration failure'; END $$; CREATE TRIGGER fail_registration_link BEFORE INSERT ON pos_inventory_links FOR EACH ROW EXECUTE FUNCTION fail_registration_link()");
    assert.equal((await invoke('createEventProduct', null, { projectId: event, product })).status, 500);
    for (const table of ['pos_inventory', 'pos_products', 'pos_inventory_links', 'pos_inventory_transfers', 'pos_inventory_adjustments']) assert.equal(Number((await db.query(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n), 0, table);
    await db.exec('DROP TRIGGER fail_registration_link ON pos_inventory_links');
    assert.equal((await invoke('createEventProduct', null, { projectId: event, product })).status, 200);
    assert.match((await invoke('listInventory')).body.inventory[0].productNumber, /^[A-Z]{3}_0001$/);
  } finally { await db.close(); }
});

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
    const adopted = (await invoke(null, a)).body;
    assert.equal(adopted.products[0].inventoryId, first.inventory.find(item => item.allocations[0].project_id === a).id);
    assert.deepEqual({ ...adopted, products: adopted.products.map(product => ({ ...product, inventoryId: null, productNumber: null, inventoryVersion: null })) }, before);
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


test('event removal keeps the exact inventory link, stock and sale history for the inventory detail shortcut', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '제거 안내 행사' })).body.project.id;
    const original = (await invoke('saveInventory', null, { product: { id: 'warehouse-original', version: -1, name: '공통 상품', stock: 10 } })).body.inventory[0];
    await invoke('transferInventory', null, { projectId: event, inventoryId: original.id, qty: 6, direction: 'allocate', requestId: 'notice-allocation' });
    const product = (await invoke(null, event)).body.products[0];
    assert.notEqual(product.id, original.id);
    assert.equal(product.inventoryId, original.id);
    assert.equal((await invoke(null, event, {}, 'b')).status, 500);
    assert.equal((await invoke('removeProduct', event, { productId: product.id }, 'b')).status, 500);
    const sale = { localOrderId: 'notice-sale', method: 'cash', total: 0, cart: [{ type: 'product', id: product.id, name: product.name, unitPrice: 0, qty: 2 }] };
    assert.equal((await invoke('finalizeSale', event, sale)).status, 200);
    const removed = await invoke('removeProduct', event, { productId: product.id });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.products.length, 0);
    assert.equal(removed.body.sales.length, 1);
    assert.equal((await invoke('removeProduct', event, { productId: product.id })).status, 200);
    let item = (await invoke('listInventory')).body.inventory.find(item => item.id === product.inventoryId);
    assert.ok(item);
    assert.equal(item.stock, 4);
    assert.equal(item.remainingStock, 8);
    assert.equal(item.allocations[0].stock, 4);
    assert.equal(item.history[0].soldQty, 2);
    assert.equal((await invoke('replaceProducts', event, { products: [{ id: 'legacy', name: '기존 상품', price: 0, stockQty: 0, initialStockQty: 0 }] })).status, 200);
    assert.equal((await invoke(null, event)).body.products[0].inventoryId, null);
    assert.equal((await invoke('voidSale', event, { id: sale.localOrderId })).status, 200);
    item = (await invoke('listInventory')).body.inventory.find(item => item.id === original.id);
    assert.equal(item.remainingStock, 10);
    assert.equal(item.allocations[0].stock, 6);
    assert.equal((await invoke('finalizeSale', event, { ...sale, localOrderId: 'removed-sale' })).status, 500);
    await db.query('UPDATE pos_projects SET archived_at=NOW() WHERE id=$1', [event]);
    assert.equal((await invoke('removeProduct', event, { productId: 'legacy' })).status, 409);
  } finally { await db.close(); }
});


test('inventory deletion after active-event product and bundle sales preserves settlement, cancellation and physical stock', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '진행 중 행사' })).body.project.id;
    const otherEvent = (await invoke('createProject', null, { name: '다음 행사' })).body.project.id;
    const original = (await invoke('saveInventory', null, { product: { id: 'delete-with-sales', version: -1, name: '삭제 상품', stock: 10 } })).body.inventory[0];
    await invoke('transferInventory', null, { projectId: event, inventoryId: original.id, qty: 6, direction: 'allocate', requestId: 'delete-move' });
    const product = (await invoke(null, event)).body.products[0];
    const sale = { localOrderId: 'delete-product-sale', method: 'cash', total: 0, cart: [{ type: 'product', id: product.id, name: product.name, qty: 1, unitPrice: 0 }] };
    assert.equal((await invoke('finalizeSale', event, sale)).status, 200);
    await invoke('replaceBundles', event, { bundles: [{ id: 'delete-bundle', name: '세트', price: 0, items: [{ productId: product.id, qty: 2 }] }] });
    const bundleSale = { localOrderId: 'delete-bundle-sale', method: 'transfer', total: 0, cart: [{ type: 'bundle', id: 'delete-bundle', name: '세트', qty: 1, unitPrice: 0, subItems: [{ productId: product.id, qty: 2 }] }] };
    assert.equal((await invoke('finalizeSale', event, bundleSale)).status, 200);
    let before = (await invoke(null, event)).body;
    const request = { inventoryId: original.id, version: 1 };
    assert.equal((await invoke('removeInventory', null, request, 'b')).status, 404);
    assert.equal((await invoke('removeInventory', null, { inventoryId: null, version: 1 })).status, 400);
    assert.equal((await invoke('removeInventory', null, { ...request, version: 0 })).status, 409);
    assert.equal((await invoke('removeInventory', null, request)).status, 409);
    assert.deepEqual((await invoke(null, event)).body, before);
    assert.equal((await invoke('removeProduct', event, { productId: product.id })).status, 200);
    before = (await invoke(null, event)).body;
    assert.equal((await invoke('removeInventory', null, request)).status, 200);
    assert.equal((await invoke('removeInventory', null, request)).status, 200);
    assert.equal((await invoke('listInventory')).body.inventory.length, 0);
    assert.deepEqual((await invoke(null, event)).body, before);
    const removed = (await db.query('SELECT * FROM pos_inventory WHERE admin_id=$1 AND id=$2', ['a',original.id])).rows[0];
    assert.ok(removed.product.removedAt);
    assert.equal(removed.version, 2);
    assert.equal(removed.stock, 4);
    assert.equal(Number(removed.total_received), 10);
    assert.equal(removed.product_number, original.productNumber);
    assert.equal((await invoke('saveInventory', null, { product: { ...original, version: 2, stock: 5 } })).status, 409);
    assert.equal((await invoke('transferInventory', null, { projectId: otherEvent, inventoryId: original.id, qty: 1, direction: 'allocate', requestId: 'removed-new-allocation' })).status, 409);
    // Removal from the event stops new sales; historical cancellations remain valid.
    assert.equal((await invoke('finalizeSale', event, { ...sale, localOrderId: 'after-inventory-delete' })).status, 500);
    assert.equal((await invoke('voidSale', event, { id: sale.localOrderId })).status, 200);
    assert.equal((await invoke('voidSale', event, { id: bundleSale.localOrderId })).status, 200);
    assert.equal((await db.query('SELECT stock_qty FROM pos_products WHERE project_id=$1 AND id=$2', [event,product.id])).rows[0].stock_qty, 6);
    assert.equal((await invoke('transferInventory', null, { projectId: event, inventoryId: original.id, qty: 6, direction: 'return', requestId: 'removed-return' })).status, 200);
    assert.equal((await invoke('listInventory')).body.inventory.length, 0);
    assert.equal((await invoke(null, event)).body.products.length, 0);
    assert.equal((await db.query('SELECT stock FROM pos_inventory WHERE admin_id=$1 AND id=$2', ['a',original.id])).rows[0].stock, 10);
    assert.equal((await db.query('SELECT * FROM pos_inventory_links WHERE inventory_id=$1',[original.id])).rows.length, 1);
  } finally { await db.close(); }
});

test('unlinked inventory deletion rolls back failures and rejects stale edits without recreating removed items', async () => {
  const { db, invoke } = await fixture();
  try {
    const original = (await invoke('saveInventory', null, { product: { id: 'unlinked-delete', version: -1, name: '창고 전용', stock: 0 } })).body.inventory[0];
    const query = db.query.bind(db);
    let fail = true, marked = false;
    db.query = (text, values) => {
      if (text.startsWith('UPDATE pos_inventory SET product=') && values.some(value => typeof value === 'string' && value.includes('removedAt'))) marked = true;
      if (fail && marked && text.startsWith('SELECT * FROM pos_inventory WHERE admin_id =')) { fail = false; throw new Error('injected response failure after deletion'); }
      return query(text, values);
    };
    const request = { inventoryId: original.id, version: original.version };
    assert.equal((await invoke('removeInventory', null, request)).status, 500);
    const retained = (await invoke('listInventory')).body.inventory;
    assert.equal(retained.length, 1);
    assert.equal(retained[0].version, original.version);
    assert.equal(retained[0].removedAt, undefined);
    assert.equal((await invoke('removeInventory', null, request)).status, 200);
    assert.equal((await invoke('saveInventory', null, { product: { ...original, version: -1 } })).status, 409);
    assert.equal((await invoke('listInventory')).body.inventory.length, 0);
    assert.equal((await db.query('SELECT * FROM pos_inventory WHERE admin_id=$1',['a'])).rows.length, 1);
  } finally { await db.close(); }
});


test('inventory deletion rechecks all active events, includes zero stock, and excludes archived or removed registrations', async () => {
  const { db, invoke } = await fixture();
  try {
    const item = (await invoke('saveInventory', null, { product: { id: 'multi-event', version: -1, name: '공통 원본', stock: 4 } })).body.inventory[0];
    const events = [];
    for (let index = 0; index < 4; index++) {
      const event = (await invoke('createProject', null, { name: `행사${index}` })).body.project.id;
      await invoke('transferInventory', null, { projectId: event, inventoryId: item.id, qty: 1, direction: 'allocate', requestId: `allocation-${index}` });
      events.push({ id: event, productId: (await invoke(null, event)).body.products[0].id });
    }
    await db.query('UPDATE pos_projects SET archived_at=NOW() WHERE id=$1', [events[2].id]);
    await invoke('removeProduct', events[3].id, { productId: events[3].productId });
    await invoke('finalizeSale', events[0].id, { localOrderId: 'sold-out', method: 'cash', total: 0, cart: [{ type: 'product', id: events[0].productId, name: '원본', unitPrice: 0, qty: 1 }] });
    const state = (await invoke('listInventory')).body.inventory[0];
    assert.equal(state.allocations.filter(row => row.is_active && !row.archived_at).length, 2);
    assert.equal(state.allocations.find(row => row.project_id === events[0].id).stock, 0);
    const request = { inventoryId: item.id, version: 4 };
    assert.equal((await invoke('removeInventory', null, request)).status, 409);
    await invoke('removeProduct', events[1].id, { productId: events[1].productId });
    assert.equal((await invoke('removeInventory', null, request)).status, 409);
    await invoke('removeProduct', events[0].id, { productId: events[0].productId });
    assert.equal((await invoke('removeInventory', null, request)).status, 200);
    assert.equal((await invoke(null, events[2].id)).body.products.length, 1);
    assert.equal((await invoke('voidSale', events[0].id, { id: 'sold-out' })).status, 200);
    assert.equal((await invoke(null, events[0].id)).body.products.length, 0);
  } finally { await db.close(); }
});


test('event genre edits share the common source, preserve clearing and backups, and reject invalid values atomically', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '장르 행사' })).body.project.id;
    const item = (await invoke('saveInventory', null, { product: { id: 'genre-source', version: -1, name: '상품', genre: '공통 장르', stock: 3 } })).body.inventory[0];
    await invoke('transferInventory', null, { projectId: event, inventoryId: item.id, qty: 2, direction: 'allocate', requestId: 'genre-link' });
    let product = (await invoke(null, event)).body.products[0];
    assert.equal(product.genre, '공통 장르');
    assert.equal(product.productNumber, item.productNumber);
    let saved = await invoke('saveEventProduct', null, { projectId: event, productId: product.id, inventoryVersion: product.inventoryVersion, product: { ...product, genre: '행사 장르' } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.products[0].genre, '행사 장르');
    assert.equal((await invoke('listInventory')).body.inventory[0].genre, '행사 장르');
    const backup = (await invoke('backupProject', event, { password: 'test-password' })).body.backup;
    assert.equal(backup.products[0].genre, '행사 장르');
    const copied = await invoke('duplicateProject', event, { password: 'test-password', name: '장르 복제' });
    assert.equal((await invoke(null, copied.body.project.id)).body.products[0].genre, '행사 장르');
    const restored = await invoke('restoreProject', null, { password: 'test-password', name: '장르 복원', backup });
    assert.equal((await invoke(null, restored.body.project.id)).body.products[0].genre, '행사 장르');
    product = saved.body.products[0];
    assert.equal((await invoke('saveEventProduct', null, { projectId: event, productId: product.id, inventoryVersion: product.inventoryVersion, product: { ...product, genre: {} } })).status, 400);
    assert.equal((await invoke(null, event)).body.products[0].genre, '행사 장르');
    saved = await invoke('saveEventProduct', null, { projectId: event, productId: product.id, inventoryVersion: product.inventoryVersion, product: { ...product, genre: '' } });
    assert.equal(saved.body.products[0].genre, '');
    await db.query('UPDATE pos_products SET genre=NULL WHERE project_id=$1', [event]);
    assert.equal((await invoke(null, event)).body.products[0].genre, '');
  } finally { await db.close(); }
});


test('common edits from event and inventory propagate across events, preserve event prices and historical sales, and roll back failures', async () => {
  const { db, invoke } = await fixture();
  try {
    const first = (await invoke('createProject', null, { name: '첫 행사' })).body.project.id;
    const second = (await invoke('createProject', null, { name: '둘째 행사' })).body.project.id;
    const original = (await invoke('saveInventory', null, { product: { id: 'shared-edit', version: -1, name: '원본', goodsType: '키링', genre: '게임', stock: 10 } })).body.inventory[0];
    for (const [projectId,qty,requestId] of [[first,4,'shared-first'],[second,3,'shared-second']]) await invoke('transferInventory', null, { projectId, inventoryId: original.id, qty, requestId, direction: 'allocate' });
    let p = (await invoke(null, first)).body.products[0];
    const other = (await invoke(null, second)).body.products[0];
    await invoke('replaceProducts', second, { products: [{ ...other, price: 2000 }] });
    await invoke('finalizeSale', first, { localOrderId: 'shared-history', method: 'cash', total: 0, cart: [{ type: 'product', id: p.id, name: '과거 이름', unitPrice: 0, qty: 1 }] });
    const history = (await invoke(null, first)).body.sales;
    await db.query('UPDATE pos_projects SET archived_at=NOW() WHERE id=$1', [second]);
    const metadata = { name: '공통 이름', goodsType: '아크릴', vtuberName: '캐릭터', creatorName: '제작자', genre: '음악', price: 1000 };
    const request = { projectId: first, productId: p.id, inventoryVersion: p.inventoryVersion, product: metadata };
    assert.equal((await invoke('saveEventProduct', null, request, 'b')).status, 404);
    const saved = await invoke('saveEventProduct', null, request);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.products[0].name, metadata.name);
    assert.equal(saved.body.products[0].price, 1000);
    const secondState = (await invoke(null, second)).body;
    assert.equal(secondState.products[0].name, metadata.name);
    assert.equal(secondState.products[0].genre, metadata.genre);
    assert.equal(secondState.products[0].price, 2000);
    assert.deepEqual((await invoke(null, first)).body.sales, history);
    assert.equal((await invoke('saveEventProduct', null, request)).status, 409);
    p = saved.body.products[0];
    const imageUrl = `https://test.public.blob.vercel-storage.com/products/${first}/${p.id}/shared.webp`;
    assert.equal((await invoke('updateProductImage', first, { productId: p.id, imageUrl })).status, 200);
    assert.equal((await invoke(null, second)).body.products[0].imageUrl, imageUrl);
    let source = (await invoke('listInventory')).body.inventory.find(row => row.id === original.id);
    assert.equal(source.imageUrl, imageUrl); assert.equal(source.stock, 3);
    assert.equal((await invoke('saveInventory', null, { product: { ...source, name: '창고에서 수정' } })).status, 200);
    assert.equal((await invoke(null, first)).body.products[0].name, '창고에서 수정');
    assert.equal((await invoke(null, second)).body.products[0].price, 2000);
    source = (await invoke('listInventory')).body.inventory.find(row => row.id === original.id);
    const query = db.query.bind(db); let fail = true;
    db.query = (text, values) => { if (fail && text.startsWith('UPDATE pos_products p SET name=')) { fail = false; throw new Error('injected shared failure'); } return query(text,values); };
    assert.equal((await invoke('saveEventProduct', null, { ...request, inventoryVersion: source.version, product: { ...metadata, price: 0 } })).status, 500);
    assert.equal((await invoke('listInventory')).body.inventory.find(row => row.id === original.id).version, source.version);
    assert.equal((await invoke(null, first)).body.products[0].price, 1000);
    assert.equal((await invoke('saveEventProduct', null, { ...request, inventoryVersion: source.version, product: { ...metadata, price: -1 } })).status, 400);
    assert.equal((await invoke('saveEventProduct', null, { ...request, inventoryVersion: source.version, product: { ...metadata, price: 0 } })).status, 200);
    assert.deepEqual((await invoke(null, first)).body.sales, history);
    const latest = (await invoke(null, first)).body.products[0];
    const legacySave = await invoke('replaceProducts', first, { products: [{ ...latest, name: 'stale event metadata', genre: 'stale' }] });
    assert.equal(legacySave.status, 200);
    assert.equal(legacySave.body.products[0].name, metadata.name);
    assert.equal(legacySave.body.products[0].genre, metadata.genre);
  } finally { await db.close(); }
});

test('event common editing adopts unlinked legacy goods once and preserves stock', async () => {
  const { db, invoke } = await fixture();
  try {
    const event = (await invoke('createProject', null, { name: '기존 행사' })).body.project.id;
    await invoke('replaceProducts', event, { products: [{ id: 'old', name: '기존', goodsType: '키링', price: 0, stockQty: 5, initialStockQty: 5 }] });
    const result = await invoke('saveEventProduct', null, { projectId: event, productId: 'old', inventoryVersion: null, product: { name: '수정', goodsType: '굿즈', vtuberName: '', creatorName: '', genre: '', price: 0 } });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.products[0].stockQty, 5);
    assert.equal(result.body.products[0].inventoryVersion, 1);
    assert.equal((await invoke('listInventory')).body.inventory[0].name, '수정');
  } finally { await db.close(); }
});


test('inventory transfer validates separated-event revisions and replays an acknowledged move without changing stock', async () => {
  const { db, invoke } = await fixture();
  try {
    const source = (await invoke('saveInventory', null, { product: { id: 'revision-source', version: -1, name: '원본', stock: 5 } })).body.inventory[0];
    await db.query("INSERT INTO pos_projects (id,admin_id,name) VALUES ('pxwiu2t','a','분리 행사')");
    await db.query("INSERT INTO pos_event_archives (project_id,revision,snapshot) VALUES ('pxwiu2t','move-revision','{}')");
    const payload = { inventoryId: source.id, projectId: 'pxwiu2t', direction: 'allocate', qty: 2, requestId: 'revision-move' };
    assert.equal((await invoke('transferInventory', null, payload)).status, 409);
    assert.equal((await invoke('transferInventory', null, { ...payload, dataRevision: 'old' })).status, 409);
    assert.equal((await invoke('transferInventory', null, { ...payload, dataRevision: 'move-revision' })).status, 200);
    assert.equal((await invoke('transferInventory', null, { ...payload, dataRevision: 'move-revision' })).status, 200);
    assert.equal((await invoke('listInventory')).body.inventory.find(row => row.id === source.id).stock, 3);
    assert.equal((await invoke(null, 'pxwiu2t')).body.products[0].stockQty, 2);
  } finally { await db.close(); }
});

function allocationPayload(item, totalStock = item.totalStock, quantities = {}) {
  return { product: { ...item }, allocationPlan: { totalStock, allocations: item.allocations.map(row => ({ projectId: row.project_id, productId: row.product_id, quantity: quantities[row.project_id] ?? Number(row.initial_stock), stock: Number(row.stock), initialStock: Number(row.initial_stock), dataRevision: row.data_revision ?? null })) } };
}

async function allocationFixture() {
  const f = await fixture();
  const first = (await f.invoke('createProject', null, { name: '첫 행사' })).body.project.id;
  const second = (await f.invoke('createProject', null, { name: '둘째 행사' })).body.project.id;
  await f.invoke('saveInventory', null, { product: { id: 'plan-product', version: -1, name: '공통 상품', stock: 100 } });
  for (const [projectId,qty] of [[first,30],[second,20]]) assert.equal((await f.invoke('transferInventory', null, { inventoryId: 'plan-product', projectId, qty, direction: 'allocate', requestId: projectId })).status, 200);
  const read = async () => (await f.invoke('listInventory')).body.inventory.find(item => item.id === 'plan-product');
  return { ...f, first, second, read };
}

test('allocation plan saves total and all event quantities atomically without changing sales, prices or lifetime receipt history', async () => {
  const f = await allocationFixture();
  try {
    let item = await f.read();
    const productId = item.allocations.find(row => row.project_id === f.first).product_id;
    await f.db.query('UPDATE pos_products SET price=1000 WHERE project_id=$1 AND id=$2', [f.first,productId]);
    assert.equal((await f.invoke('finalizeSale', f.first, { localOrderId: 'plan-sale', method: 'cash', total: 3000, cart: [{ type: 'product', id: productId, name: '공통 상품', unitPrice: 1000, qty: 3 }] })).status, 200);
    item = await f.read();
    const payload = allocationPayload(item,100,{[f.first]:40,[f.second]:10});
    const saved = await f.invoke('saveInventory', null, payload);
    assert.equal(saved.status,200,JSON.stringify(saved.body));
    item = await f.read();
    assert.equal(item.totalStock,100); assert.equal(item.stock,50); assert.equal(item.remainingStock,97);
    assert.equal(item.allocations.find(row=>row.project_id===f.first).stock,37);
    assert.equal(item.history.find(row=>row.projectId===f.first).soldQty,3);
    assert.equal((await f.invoke(null,f.first)).body.products[0].price,1000);
    assert.equal((await f.invoke('saveInventory',null,payload)).status,409);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,90))).status,200);
    item=await f.read(); assert.equal(item.totalStock,90); assert.equal(item.totalReceived,100); assert.equal(item.stock,40);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,110))).status,200);
    item=await f.read(); assert.equal(item.totalStock,110); assert.equal(item.totalReceived,120);
    const sale=(await f.invoke(null,f.first)).body.sales[0];
    assert.equal((await f.invoke('voidSale',f.first,{id:sale.id})).status,200);
    item=await f.read(); assert.equal(item.allocations.find(row=>row.project_id===f.first).stock,40);
  } finally { await f.db.close(); }
});

test('allocation plan rejects over-allocation, sold-stock reduction, stale sale snapshots, invalid rows and foreign events', async () => {
  const f=await allocationFixture();
  try {
    const item=await f.read();
    for (const payload of [allocationPayload(item,49),allocationPayload(item,100,{[f.first]:-1}),allocationPayload(item,100,{[f.first]:1.5})]) assert.equal((await f.invoke('saveInventory',null,payload)).status,400);
    const duplicate=allocationPayload(item); duplicate.allocationPlan.allocations.push(duplicate.allocationPlan.allocations[0]);
    assert.equal((await f.invoke('saveInventory',null,duplicate)).status,400);
    const missing=allocationPayload(item); missing.allocationPlan.allocations.pop();
    assert.equal((await f.invoke('saveInventory',null,missing)).status,409);
    const foreign=(await f.invoke('createProject',null,{name:'다른 계정'},'b')).body.project.id;
    const denied=allocationPayload(item); denied.allocationPlan.allocations.push({projectId:foreign,productId:null,quantity:1,stock:0,initialStock:0});
    assert.equal((await f.invoke('saveInventory',null,denied)).status,400);
    const productId=item.allocations.find(row=>row.project_id===f.first).product_id;
    assert.equal((await f.invoke('finalizeSale',f.first,{localOrderId:'stale-plan-sale',method:'cash',total:0,cart:[{type:'product',id:productId,name:item.name,unitPrice:0,qty:3}]})).status,200);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item))).status,409);
    const fresh=await f.read();
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(fresh,100,{[f.first]:2}))).status,400);
    assert.equal((await f.read()).stock,50);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(fresh),'b')).status,409);
  } finally {await f.db.close();}
});

test('allocation table can register a new event; archived and removed event products keep their restrictions', async () => {
  const f=await allocationFixture();
  try {
    const third=(await f.invoke('createProject',null,{name:'새 배정 행사'})).body.project.id;
    let item=await f.read(); const payload=allocationPayload(item);
    payload.allocationPlan.allocations.push({projectId:third,productId:null,quantity:15,stock:0,initialStock:0,dataRevision:null});
    assert.equal((await f.invoke('saveInventory',null,payload)).status,200);
    item=await f.read(); assert.equal(item.allocations.length,3); assert.equal(item.stock,35);
    assert.equal((await f.invoke(null,third)).body.products[0].price,1000);
    assert.equal((await f.invoke(null,f.first)).body.products[0].price,0);
    const assigned=item.allocations.find(row=>row.project_id===third);
    await f.db.query('UPDATE pos_products SET price=2500 WHERE project_id=$1 AND id=$2',[third,assigned.product_id]);
    await f.db.query('UPDATE pos_projects SET archived_at=NOW() WHERE id=$1',[f.second]);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,100,{[f.second]:21}))).status,409);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,100,{[f.second]:10}))).status,200);
    assert.equal((await f.invoke(null,third)).body.products[0].price,2500);
    item=await f.read(); const removed=item.allocations.find(row=>row.project_id===f.first);
    await f.invoke('removeProduct',f.first,{productId:removed.product_id});
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,100,{[f.first]:35}))).status,200);
    item=await f.read(); assert.equal(item.allocations.find(row=>row.project_id===f.first).is_active,false);
  } finally {await f.db.close();}
});

test('allocation plan rolls back common metadata, warehouse, event changes and ledgers after a downstream failure', async () => {
  const f=await allocationFixture();
  try {
    const item=await f.read();
    await f.db.exec("CREATE FUNCTION fail_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected plan failure'; END $$; CREATE TRIGGER fail_plan BEFORE UPDATE ON pos_inventory FOR EACH ROW EXECUTE FUNCTION fail_plan()");
    const payload=allocationPayload(item,110,{[f.first]:40,[f.second]:10}); payload.product.name='실패할 이름';
    assert.equal((await f.invoke('saveInventory',null,payload)).status,500);
    const after=await f.read(); assert.deepEqual(after,item);
    assert.equal(Number((await f.db.query('SELECT COUNT(*) AS n FROM pos_inventory_transfers')).rows[0].n),2);
    assert.equal(Number((await f.db.query('SELECT COUNT(*) AS n FROM pos_inventory_adjustments')).rows[0].n),1);
  } finally {await f.db.close();}
});

test('allocation plans preserve unrecorded legacy deductions and validate separated-event revisions', async () => {
  const f=await allocationFixture();
  try {
    let item=await f.read();
    const row=item.allocations.find(row=>row.project_id===f.first);
    await f.db.query('UPDATE pos_products SET stock=25,stock_qty=25 WHERE project_id=$1 AND id=$2',[f.first,row.product_id]);
    item=await f.read();
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,100,{[f.first]:4}))).status,400);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,100,{[f.first]:26}))).status,200);
    item=await f.read();
    assert.equal(item.allocations.find(row=>row.project_id===f.first).stock,21);
    assert.equal(item.history.find(row=>row.projectId===f.first).soldQty,0);
    await f.db.query("INSERT INTO pos_projects (id,admin_id,name) VALUES ('pxwiu2t','a','분리 행사')");
    await f.db.query("INSERT INTO pos_event_archives (project_id,revision,snapshot) VALUES ('pxwiu2t','plan-revision','{}')");
    const listed=(await f.invoke('listInventory')).body;
    assert.equal(listed.inventoryEvents.find(row=>row.id==='pxwiu2t').data_revision,'plan-revision');
    const payload=allocationPayload(item);payload.allocationPlan.allocations.push({projectId:'pxwiu2t',productId:null,quantity:10,stock:0,initialStock:0,dataRevision:'stale'});
    assert.equal((await f.invoke('saveInventory',null,payload)).status,409);
    payload.allocationPlan.allocations.at(-1).dataRevision='plan-revision';
    assert.equal((await f.invoke('saveInventory',null,payload)).status,200);
    assert.equal((await f.read()).allocations.find(row=>row.project_id==='pxwiu2t').data_revision,'plan-revision');
  } finally {await f.db.close();}
});

test('zero legacy opening quantities use remaining plus sold as allocation baseline without inventing physical stock', async () => {
  const f=await allocationFixture();
  try {
    let item=await f.read(); const row=item.allocations.find(row=>row.project_id===f.first);
    await f.db.query('UPDATE pos_products SET initial_stock_qty=0 WHERE project_id=$1 AND id=$2',[f.first,row.product_id]);
    assert.equal((await f.invoke('finalizeSale',f.first,{localOrderId:'zero-opening-sale',method:'cash',total:0,cart:[{type:'product',id:row.product_id,name:item.name,unitPrice:0,qty:3}]})).status,200);
    item=await f.read(); assert.equal(item.totalStock,100); assert.equal(item.remainingStock,97);
    assert.equal(item.allocations.find(row=>row.project_id===f.first).initial_stock,30);
    assert.equal((await f.invoke('saveInventory',null,allocationPayload(item,100,{[f.first]:40}))).status,200);
    item=await f.read(); assert.equal(item.stock,40); assert.equal(item.remainingStock,97);
    const changed=item.allocations.find(row=>row.project_id===f.first); assert.equal(changed.stock,37); assert.equal(changed.initial_stock,40);
  } finally {await f.db.close();}
});

test('event sale numbers move products to a unique position without touching quantities, prices, sales or other events', async () => {
  const f=await fixture();
  try {
    const event=(await f.invoke('createProject',null,{name:'번호 행사'})).body.project.id;
    const other=(await f.invoke('createProject',null,{name:'다른 번호 행사'})).body.project.id;
    for(const [projectId,id] of [[event,'number-a'],[event,'number-b'],[event,'number-c'],[other,'number-other']])assert.equal((await f.invoke('createEventProduct',null,{projectId,product:{id,name:id,goodsType:'키링',vtuberName:'',creatorName:'',genre:'',price:1000,stockQty:5}})).status,200);
    assert.equal((await f.invoke('finalizeSale',event,{localOrderId:'number-sale',method:'cash',total:1000,cart:[{type:'product',id:'number-a',name:'number-a',unitPrice:1000,qty:1}]})).status,200);
    const before=(await f.invoke(null,event)).body;
    assert.deepEqual(before.products.map(p=>p.saleNumber),[1,2,3]);
    const payload={productId:'number-c',saleNumber:1,expectedOrder:before.products.map(p=>p.id)};
    const moved=await f.invoke('reorderProducts',event,payload);
    assert.equal(moved.status,200,JSON.stringify(moved.body));
    assert.deepEqual(moved.body.products.map(p=>[p.id,p.saleNumber]),[['number-c',1],['number-a',2],['number-b',3]]);
    assert.equal(moved.body.products.find(p=>p.id==='number-a').stockQty,4);
    assert.equal(moved.body.products.every(p=>p.price===1000),true);
    assert.deepEqual(moved.body.sales,before.sales);
    assert.deepEqual((await f.invoke(null,other)).body.products.map(p=>p.saleNumber),[1]);
    assert.equal((await f.invoke('reorderProducts',event,payload)).status,409);
    const current=moved.body.products;
    assert.equal((await f.invoke('replaceProducts',event,{products:current.map(p=>({...p,saleNumber:999})).reverse()})).status,200);
    assert.deepEqual((await f.invoke(null,event)).body.products.map(p=>p.id),current.map(p=>p.id));
    const duplicate=await f.invoke('duplicateProject',event,{password:'test-password',name:'순서 복제'});
    assert.equal(duplicate.status,201,JSON.stringify(duplicate.body));
    assert.deepEqual((await f.invoke(null,duplicate.body.project.id)).body.products.map(p=>[p.id,p.saleNumber]),current.map(p=>[p.id,p.saleNumber]));
    assert.equal((await f.invoke('removeProduct',event,{productId:'number-c'})).status,200);
    assert.deepEqual((await f.invoke(null,event)).body.products.map(p=>p.saleNumber),[1,2]);
    await f.db.query('UPDATE pos_products SET sale_number=NULL WHERE project_id=$1',[event]);
    assert.equal((await f.invoke('createEventProduct',null,{projectId:event,product:{id:'number-d',name:'D',goodsType:'키링',vtuberName:'',creatorName:'',genre:'',price:1000,stockQty:1}})).status,200);
    assert.deepEqual((await f.invoke(null,event)).body.products.map(p=>p.id),['number-a','number-b','number-d']);
  } finally {await f.db.close();}
});

test('sale numbering rejects invalid/stale/archived/foreign changes and rolls back an injected reorder failure', async()=>{
 const f=await fixture();
 try{
  const event=(await f.invoke('createProject',null,{name:'검증 번호 행사'})).body.project.id;
  await f.invoke('replaceProducts',event,{products:[{id:'a',name:'A',price:0,stockQty:2},{id:'b',name:'B',price:1000,stockQty:2}]});
  const state=(await f.invoke(null,event)).body;
  const payload={productId:'b',saleNumber:1,expectedOrder:state.products.map(p=>p.id)};
  for(const saleNumber of [0,-1,1.2,3,'1'])assert.equal((await f.invoke('reorderProducts',event,{...payload,saleNumber})).status,400);
  assert.equal((await f.invoke('reorderProducts',event,{...payload,productId:'foreign'})).status,400);
  assert.equal((await f.invoke('reorderProducts',event,{...payload,expectedOrder:['b','a']})).status,409);
  assert.notEqual((await f.invoke('reorderProducts',event,payload,'b')).status,200);
  await f.db.query('UPDATE pos_projects SET archived_at=NOW() WHERE id=$1',[event]);
  assert.equal((await f.invoke('reorderProducts',event,payload)).status,409);
  await f.db.query('UPDATE pos_projects SET archived_at=NULL WHERE id=$1',[event]);
  await f.db.exec("CREATE FUNCTION fail_sale_number() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.sale_number IS DISTINCT FROM OLD.sale_number THEN RAISE EXCEPTION 'injected numbering failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_sale_number BEFORE UPDATE ON pos_products FOR EACH ROW EXECUTE FUNCTION fail_sale_number()");
  assert.equal((await f.invoke('reorderProducts',event,payload)).status,500);
  assert.deepEqual((await f.invoke(null,event)).body.products,state.products);
 }finally{await f.db.close();}
});
