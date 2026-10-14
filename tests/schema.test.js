import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { PGlite } from '@electric-sql/pglite';
import * as defaults from '../api/lib/defaultData.js';

// Embedded PostgreSQL: no network, credentials or production database.
for (const legacy of [true, false]) {
  test(`project creation and repeat initialization on ${legacy ? 'legacy' : 'fresh'} PostgreSQL`, async () => {
    const db = new PGlite();
    try {
      await db.exec("CREATE TABLE pos_admins (id TEXT PRIMARY KEY); INSERT INTO pos_admins VALUES ('admin'), ('admin-a'), ('admin-b')");
      if (legacy) await db.exec(`
        CREATE TABLE pos_projects (id TEXT PRIMARY KEY, admin_id TEXT NOT NULL REFERENCES pos_admins(id), name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW());
        CREATE TABLE pos_products (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, stock INTEGER NOT NULL);
        CREATE TABLE pos_bundles (id TEXT PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL, items JSONB NOT NULL);
        CREATE TABLE pos_sales (id TEXT PRIMARY KEY, time TIMESTAMPTZ NOT NULL, method TEXT NOT NULL, total INTEGER NOT NULL, lines JSONB NOT NULL);
        INSERT INTO pos_products VALUES ('P001', 'legacy product', 0, 7);
        INSERT INTO pos_bundles VALUES ('b1', 'legacy bundle', 123, '[]');
        INSERT INTO pos_sales VALUES ('old-sale', '2026-10-01', 'cash', 123, '[]');
      `);
      if (legacy) await assert.rejects(db.query('SELECT project_id FROM pos_sales'), /column "project_id" does not exist/);
      const sql = (parts, ...values) => db.query(parts.reduce((query, part, i) => query + (i ? `$${i}` : '') + part, ''), values);
      const context = vm.createContext({ URL });
      const module = new vm.SourceTextModule(await readFile(new URL('../api/pos.js', import.meta.url), 'utf8'), { context });
      await module.link(specifier => {
        const exports = specifier === '@vercel/postgres' ? { sql }
          : specifier === './lib/auth.js' ? {
            assertPostgresConnectionString() {},
            requireAuth: req => ({ id: req.adminId }),
            validateAdminPassword: async () => true,
          } : defaults;
        return new vm.SyntheticModule(Object.keys(exports), function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
        }, { context });
      });
      await module.evaluate();
      const invoke = async (action, projectId, adminId = 'admin-a') => {
        const result = {};
        await module.namespace.default({ method: action ? 'POST' : 'GET', adminId, query: { projectId }, body: { action, projectId, payload: { name: '12월 행사' } } }, {
          status(code) { result.status = code; return this; },
          json(body) { result.body = body; return this; },
        });
        return result;
      };
      const first = await invoke('createProject');
      assert.equal(first.status, 201, JSON.stringify(first.body));
      const second = await invoke('createProject');
      assert.equal(second.status, 201, JSON.stringify(second.body));
      assert.notEqual(first.body.project.id, second.body.project.id);
      const other = await invoke('createProject', undefined, 'admin-b');
      assert.equal(other.status, 201);
      assert.equal((await invoke(null, other.body.project.id, 'admin-b')).body.products.length, 0);
      assert.equal((await invoke('upsertDefaults', other.body.project.id)).status, 500);
      for (const project of [first.body.project, second.body.project]) {
        const empty = await invoke(null, project.id);
        assert.equal(empty.body.products.length, 0);
        assert.equal(empty.body.bundles.length, 0);
        assert.equal((await invoke('upsertDefaults', project.id)).status, 200);
        const state = await invoke(null, project.id);
        assert.equal(state.status, 200);
        assert.equal(state.body.products.length, defaults.getDefaultProducts().length);
        assert.equal(state.body.bundles.length, defaults.getDefaultBundles().length);
        assert.equal(state.body.sales.length, 0);
        assert.equal((await invoke(null, project.id, 'admin-b')).status, 500);
      }
      if (legacy) {
        const projects = await invoke(null, undefined, 'admin');
        assert.equal(projects.body.projects.length, 1);
        const july = projects.body.projects[0];
        assert.equal(july.name, '7월 서코행사');
        const state = await invoke(null, july.id, 'admin');
        assert.equal(state.body.products[0].price, 0);
        assert.equal(state.body.products[0].stock, 7);
        assert.equal(state.body.bundles[0].name, 'legacy bundle');
        assert.equal(state.body.sales[0].total, 123);
        assert.equal((await invoke(null, july.id)).status, 500);
        assert.equal((await invoke('replaceProducts', july.id, 'admin-b')).status, 500);
        assert.equal((await invoke(null, undefined, 'admin')).body.projects.length, 1);
        assert.equal((await db.query('SELECT * FROM pos_products WHERE project_id IS NULL')).rows.length, 0);
      }
    } finally {
      await db.close();
    }
  });
}
