import * as storageContract from '../api/lib/storageContract.js';
import * as eventAccess from '../api/lib/eventAccess.js';
import * as boothFoundation from '../api/lib/boothFoundation.js';
import * as eventSettlement from '../api/lib/eventSettlement.js';
import * as accountInventory from '../api/lib/accountInventory.js';
import { hashPassword } from '../api/lib/auth.js';
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
      const context = vm.createContext({ URL, crypto: globalThis.crypto });
      const module = new vm.SourceTextModule(await readFile(new URL('../api/pos.js', import.meta.url), 'utf8'), { context });
      await module.link(specifier => {
        const exports = specifier === '@vercel/postgres' ? { sql }
          : specifier === './lib/auth.js' ? {
            hashPassword,
            assertPostgresConnectionString() {},
            requireAuth: req => ({ id: req.adminId }),
            validateAdminPassword: async (_id, password) => password === 'test-password',
          } : specifier === './lib/storageContract.js' ? storageContract : specifier === './lib/eventAccess.js' ? eventAccess : specifier === './lib/boothFoundation.js' ? boothFoundation : specifier === './lib/accountInventory.js' ? accountInventory : specifier === './lib/eventSettlement.js' ? eventSettlement : defaults;
        return new vm.SyntheticModule(Object.keys(exports), function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
        }, { context });
      });
      await module.evaluate();
      const invoke = async (action, projectId, adminId = 'admin-a', extraBody = {}) => {
        const result = {};
        await module.namespace.createHandler(sql)({ method: action ? 'POST' : 'GET', adminId, query: { projectId }, body: { action, projectId, payload: { name: '12월 행사' }, ...extraBody } }, {
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
      if (!legacy) {
        await db.exec(`
          INSERT INTO pos_projects (id, admin_id, name, seed_version) VALUES
            ('pxwiu2t', 'admin', '12 서코', 3), ('s4fjgga', 'admin', '12월 행사', 3),
            ('legacy-admin-july-seoul-comic', 'admin', '7월 서코행사', 0),
            ('untouched', 'admin-b', '12월 행사', 3);
          INSERT INTO pos_products (project_id, id, name, price, stock) SELECT id, 'P001', 'original', 0, 7 FROM pos_projects;
          INSERT INTO pos_bundles (project_id, id, name, price, items) SELECT id, 'b1', 'original set', 100, '[]' FROM pos_projects;
          INSERT INTO pos_sales (project_id, id, time, method, total, lines) SELECT id, 'sale1', NOW(), 'cash', 100, '[]' FROM pos_projects;
        `);
        await db.exec(`CREATE FUNCTION reject_event_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'injected cleanup failure'; END $$;
          CREATE TRIGGER fail_cleanup BEFORE DELETE ON pos_products FOR EACH ROW
          WHEN (OLD.project_id = 's4fjgga') EXECUTE FUNCTION reject_event_cleanup();`);
        assert.equal((await invoke(null, 'pxwiu2t', 'admin')).status, 500);
        assert.equal((await db.query('SELECT * FROM pos_event_archives')).rows.length, 0);
        assert.equal((await db.query("SELECT * FROM pos_products WHERE project_id IN ('pxwiu2t', 's4fjgga')")).rows.length, 2);
        assert.equal((await db.query("SELECT * FROM pos_sales WHERE project_id IN ('pxwiu2t', 's4fjgga')")).rows.length, 2);
        await db.exec('DROP TRIGGER fail_cleanup ON pos_products; DROP FUNCTION reject_event_cleanup()');
        for (const id of ['pxwiu2t', 's4fjgga']) {
          const separated = await invoke(null, id, 'admin');
          assert.equal(separated.status, 200);
          assert.equal(separated.body.dataRevision, 'separate-july-data-v1');
          assert.equal(separated.body.products.length, 0);
          assert.equal(separated.body.bundles.length, 0);
          assert.equal(separated.body.sales.length, 0);
          const archive = (await db.query('SELECT snapshot FROM pos_event_archives WHERE project_id = $1', [id])).rows[0].snapshot;
          assert.equal(archive.products[0].stock, 7);
          assert.equal(archive.products[0].price, 0);
          assert.equal(archive.bundles[0].name, 'original set');
          assert.equal(archive.sales[0].total, 100);
          assert.equal((await invoke('replaceProducts', id, 'admin')).status, 409);
          assert.equal((await invoke('finalizeSale', id, 'admin')).status, 409);
          assert.equal((await invoke('voidSale', id, 'admin')).status, 409);
          assert.equal((await invoke('replaceProducts', id, 'admin-b')).status, 500);
          const revision = { dataRevision: separated.body.dataRevision };
          assert.equal((await invoke('upsertDefaults', id, 'admin', revision)).status, 200);
          assert.equal((await invoke(null, id, 'admin')).body.products.length, defaults.getDefaultProducts().length);
        }
        assert.equal((await invoke(null, 'legacy-admin-july-seoul-comic', 'admin')).body.products[0].stock, 7);
        assert.equal((await invoke(null, 'untouched', 'admin-b')).body.sales[0].total, 100);
        assert.equal((await db.query('SELECT * FROM pos_event_archives')).rows.length, 2);
        await db.exec(`DELETE FROM pos_products WHERE project_id IN ('${first.body.project.id}', '${second.body.project.id}');
          DELETE FROM pos_bundles WHERE project_id IN ('${first.body.project.id}', '${second.body.project.id}');
          DELETE FROM pos_sales WHERE project_id IN ('${first.body.project.id}', '${second.body.project.id}');`);
      }
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
      const target = first.body.project.id;
      const manage = (action, payload, adminId = 'admin-a') => invoke(action, target, adminId, { payload: { password: 'test-password', ...payload } });
      assert.equal((await manage('renameProject', { name: '   ' })).status, 400);
      assert.equal((await manage('renameProject', { name: 'x'.repeat(101) })).status, 400);
      assert.equal((await manage('renameProject', { name: 'stolen' }, 'admin-b')).status, 404);
      assert.equal((await manage('renameProject', { name: '  새 행사  ' })).status, 200);
      assert.equal((await db.query('SELECT name FROM pos_projects WHERE id = $1', [target])).rows[0].name, '새 행사');
      assert.equal((await invoke(null, target)).body.products.length, defaults.getDefaultProducts().length);
      await db.query("INSERT INTO pos_sales (project_id, id, time, method, total, lines) VALUES ($1, 'delete-sale', NOW(), 'cash', 0, '[]')", [target]);
      assert.equal((await manage('deleteProject', { confirmName: '새 행사', password: 'wrong' })).status, 403);
      assert.equal((await manage('deleteProject', { confirmName: 'wrong', password: 'test-password' })).status, 400);
      assert.equal((await manage('deleteProject', { confirmName: '새 행사', password: 'test-password' }, 'admin-b')).status, 404);
      assert.equal((await invoke(null, target)).body.sales.length, 1);
      assert.equal((await manage('deleteProject', { confirmName: '새 행사', password: 'test-password' })).status, 200);
      for (const table of ['pos_projects', 'pos_products', 'pos_bundles', 'pos_sales']) {
        assert.equal((await db.query(`SELECT * FROM ${table} WHERE ${table === 'pos_projects' ? 'id' : 'project_id'} = $1`, [target])).rows.length, 0);
      }
      assert.equal((await invoke(null, second.body.project.id)).body.products.length, defaults.getDefaultProducts().length);
      assert.equal((await manage('deleteProject', { confirmName: '새 행사', password: 'test-password' })).status, 404);
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
