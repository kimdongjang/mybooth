import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as defaults from '../api/lib/defaultData.js';

// Run the real API handler with an isolated SQL adapter; no live DB credentials.
async function fixture() {
  const rows = {
    pos_projects: [{ id: 'project-a', admin_id: 'admin-a', seed_version: 0 }],
    pos_products: [], pos_bundles: [], pos_sales: [],
  };
  const statements = [];
  const sql = async (parts, ...values) => {
    const query = parts.join('?').replace(/\s+/g, ' ').trim();
    statements.push(query);
    if ((query.startsWith('CREATE ') || query.startsWith('ALTER ') || query.startsWith('DO '))) return { rows: [] };
    if (query.startsWith('SELECT id FROM pos_projects')) {
      return { rows: rows.pos_projects.filter(p => p.id === values[0] && p.admin_id === values[1]) };
    }
    if (query.startsWith('INSERT INTO ')) {
      const [, table, columns] = query.match(/^INSERT INTO (\w+) \(([^)]+)\)/);
      const row = Object.fromEntries(columns.split(', ').map((column, i) => [column, values[i]]));
      if (row.items) row.items = JSON.parse(row.items);
      const existing = rows[table].find(p => p.project_id === row.project_id && p.id === row.id);
      if (existing) {
        assert.match(query, /ON CONFLICT \(project_id, id\) DO NOTHING$/);
      } else rows[table].push(row);
      return { rows: [] };
    }
    if (query.startsWith('DELETE FROM ')) {
      const table = query.match(/^DELETE FROM (\w+)/)[1];
      rows[table] = rows[table].filter(row => row.project_id !== values[0]);
      return { rows: [] };
    }
    if (query.startsWith('UPDATE pos_projects SET seed_version')) {
      rows.pos_projects.find(p => p.id === values[1]).seed_version = values[0];
      return { rows: [] };
    }
    if (query.startsWith('UPDATE pos_products SET image_url')) {
      const product = rows.pos_products.find(p => p.project_id === values[1] && p.id === values[2]);
      if (product) product.image_url = values[0];
      return { rows: [] };
    }
    if (query.startsWith('SELECT ')) {
      const table = query.match(/ FROM (\w+)/)[1];
      return { rows: rows[table].filter(row => row.project_id === values[0]) };
    }
    throw new Error(`Unexpected SQL: ${query}`);
  };
  const context = vm.createContext({ console, URL });
  const source = await readFile(new URL('../api/pos.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link((specifier) => {
    const exports = specifier === '@vercel/postgres' ? { sql }
      : specifier === './lib/auth.js' ? {
        assertPostgresConnectionString() {},
        requireAuth: req => ({ id: req.adminId || 'admin-a' }),
        validateAdminPassword: async () => true,
      } : defaults;
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  const invoke = async (action, projectId = 'project-a', adminId = 'admin-a', payload = {}) => {
    const result = {};
    await module.namespace.default({ method: 'POST', adminId, body: { action, projectId, payload } }, {
      status(code) { result.status = code; return this; },
      json(body) { result.body = body; return this; },
    });
    return result;
  };
  return { rows, statements, invoke };
}

test('image update is scoped, preserves stock/sales and rejects foreign paths and owners', async () => {
  const { rows, invoke } = await fixture();
  const timestamp = '2026-10-14T00:00:00.000Z';
  rows.pos_products.push({ project_id: 'project-a', id: 'P001', stock: 3, created_at: timestamp, updated_at: timestamp }, { project_id: 'project-b', id: 'P001', stock: 7 });
  rows.pos_sales.push({ project_id: 'project-a', id: 'sale', time: timestamp, lines: [] });
  const beforeSales = structuredClone(rows.pos_sales);
  const imageUrl = 'https://example.public.blob.vercel-storage.com/products/project-a/P001/image-unique.png';
  assert.equal((await invoke('updateProductImage', 'project-a', 'admin-a', { productId: 'P001', imageUrl })).status, 200);
  assert.equal(rows.pos_products[0].image_url, imageUrl);
  assert.equal(rows.pos_products[0].stock, 3);
  assert.equal(rows.pos_products[1].image_url, undefined);
  assert.deepEqual(rows.pos_sales, beforeSales);
  for (const invalid of ['https://example.com/products/project-a/P001/a.png', imageUrl.replace('project-a', 'project-b'), imageUrl.replace('/P001/', '/P002/')]) {
    assert.equal((await invoke('updateProductImage', 'project-a', 'admin-a', { productId: 'P001', imageUrl: invalid })).status, 500);
    assert.equal(rows.pos_products[0].image_url, imageUrl);
  }
  assert.equal((await invoke('updateProductImage', 'project-a', 'admin-b', { productId: 'P001', imageUrl: null })).status, 500);
  assert.equal((await invoke('updateProductImage', 'project-a', 'admin-a', { productId: 'P001', imageUrl: null })).status, 200);
  assert.equal(rows.pos_products[0].image_url, null);
});

test('upsertDefaults preserves sales, custom/inactive rows and stock; only adds missing defaults', async () => {
  const { rows, statements, invoke } = await fixture();
  const timestamp = '2026-10-01T00:00:00.000Z';
  const existing = { project_id: 'project-a', id: 'P001', name: '수정 상품', price: 777,
    stock: 2, stock_qty: 2, initial_stock_qty: 99, is_active: false, created_at: timestamp, updated_at: timestamp };
  const custom = { ...existing, id: 'custom', is_active: true };
  const bundle = { project_id: 'project-a', id: 'b1', name: '수정 세트', price: 123,
    items: [{ productId: 'custom', qty: 2 }] };
  rows.pos_products.push(existing, custom);
  rows.pos_bundles.push(bundle, { ...bundle, id: 'custom-bundle' });
  rows.pos_sales.push({ project_id: 'project-a', id: 'sale-1', time: timestamp, total: 123, lines: [] });
  const before = structuredClone(rows);
  assert.equal((await invoke('upsertDefaults')).status, 200);
  for (const row of before.pos_products) assert.deepEqual(rows.pos_products.find(p => p.id === row.id), row);
  for (const row of before.pos_bundles) assert.deepEqual(rows.pos_bundles.find(p => p.id === row.id), row);
  assert.deepEqual(rows.pos_sales, before.pos_sales);
  assert.equal(rows.pos_products.length, 45);
  assert.equal(rows.pos_bundles.length, 8);
  const added = rows.pos_products.find(p => p.id === 'P002');
  assert.equal(added.stock_qty, defaults.getDefaultProducts()[1].stockQty);
  assert.equal(rows.pos_projects[0].seed_version, defaults.CURRENT_SEED_VERSION);
  const after = structuredClone(rows);
  assert.equal((await invoke('upsertDefaults')).status, 200);
  assert.deepEqual(rows, after);
  assert.equal(statements.some(q => q.startsWith('DELETE ')), false);
});

test('resetDefaults resets catalog and stock but preserves sales and other projects', async () => {
  const { rows, invoke } = await fixture();
  rows.pos_products.push({ project_id: 'project-a', id: 'custom' }, { project_id: 'project-b', id: 'P001', stock: 4 });
  rows.pos_bundles.push({ project_id: 'project-a', id: 'custom' }, { project_id: 'project-b', id: 'b1' });
  rows.pos_sales.push({ project_id: 'project-a', id: 'sale-1', time: '2026-10-01', lines: [] });
  const sales = structuredClone(rows.pos_sales);
  const otherProduct = structuredClone(rows.pos_products[1]);
  const otherBundle = structuredClone(rows.pos_bundles[1]);
  assert.equal((await invoke('resetDefaults')).status, 200);
  assert.deepEqual(rows.pos_sales, sales);
  assert.deepEqual(rows.pos_products.find(p => p.project_id === 'project-b'), otherProduct);
  assert.deepEqual(rows.pos_bundles.find(p => p.project_id === 'project-b'), otherBundle);
  assert.equal(rows.pos_products.filter(p => p.project_id === 'project-a').length, 44);
  assert.equal(rows.pos_bundles.filter(p => p.project_id === 'project-a').length, 7);
  const first = rows.pos_products.find(p => p.project_id === 'project-a' && p.id === 'P001');
  assert.equal(first.stock_qty, defaults.getDefaultProducts()[0].stockQty);
  assert.equal(rows.pos_products.some(p => p.id === 'custom'), false);
});

test('both default actions enforce ownership before any mutation', async () => {
  for (const action of ['upsertDefaults', 'resetDefaults']) {
    const { rows, statements, invoke } = await fixture();
    const before = structuredClone(rows);
    assert.equal((await invoke(action, 'project-a', 'admin-b')).status, 500);
    assert.deepEqual(rows, before);
    assert.equal(statements.some(q => /^(INSERT|UPDATE|DELETE) /.test(q)), false);
  }
});
