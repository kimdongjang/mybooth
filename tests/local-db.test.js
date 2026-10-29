import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { registerHooks } from 'node:module';

test('local DB persists auth and serializes transactions without remote credentials', async () => {
  await mkdir('.local-data', { recursive: true });
  const directory = await mkdtemp('.local-data/test-local-');
  process.env.POS_LOCAL_DATA_DIR = directory;
  process.env.POSTGRES_URL = 'postgres://local-only';
  delete process.env.ADMIN_PASSWORD;
  const url = new URL('../scripts/local/postgres.mjs', import.meta.url).href;
  const hook = registerHooks({ resolve(name, context, next) {
    return name === '@vercel/postgres' ? { url, shortCircuit: true } : next(name, context);
  } });
  let db;
  try {
    const { sql } = await import(url);
    db = globalThis[Symbol.for('withbooth.local.database')];
    const { createAdmin, validateAdmin } = await import('../api/lib/auth.js');
    await createAdmin('local-user', 'test-password', 'local@example.test', 'Local');
    assert.equal((await validateAdmin('local-user', 'test-password')).id, 'local-user');
    const client = await sql.connect();
    await client.query('BEGIN');
    await client.sql`UPDATE pos_admins SET nickname=${'rollback'} WHERE id=${'local-user'}`;
    let acquired = false;
    const waiting = sql.connect().then(c => { acquired = true; return c; });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(acquired, false);
    await client.query('ROLLBACK'); client.release();
    (await waiting).release();
    assert.equal((await validateAdmin('local-user', 'test-password')).nickname, 'Local');
    await db.close();
    const { PGlite } = await import('@electric-sql/pglite');
    db = new PGlite(directory);
    assert.equal((await db.query('SELECT id FROM pos_admins')).rows[0].id, 'local-user');
  } finally {
    hook.deregister();
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
