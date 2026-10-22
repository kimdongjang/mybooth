import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('email signup, database uniqueness, legacy migration and unchanged login', async () => {
  const db = new PGlite();
  try {
    const salt = 'legacy-salt';
    const hash = `${salt}:${crypto.scryptSync('old-password', salt, 64).toString('hex')}`;
    await db.exec('CREATE TABLE pos_admins (id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW())');
    await db.query('INSERT INTO pos_admins (id, password_hash) VALUES ($1, $2), ($3, $2)', ['admin', hash, 'existing']);
    await db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, admin_id TEXT REFERENCES pos_admins(id)); INSERT INTO projects VALUES ('event', 'admin')");
    const sql = (parts, ...values) => db.query(parts.reduce((q, part, i) => q + (i ? `$${i}` : '') + part, ''), values);
    const context = vm.createContext({ Buffer, process: { env: { POSTGRES_URL: 'isolated-test' } } });
    const auth = new vm.SourceTextModule(await readFile(new URL('../api/lib/auth.js', import.meta.url), 'utf8'), { context });
    await auth.link(specifier => new vm.SyntheticModule(specifier === 'node:crypto' ? ['default'] : ['sql'], function () {
      this.setExport(specifier === 'node:crypto' ? 'default' : 'sql', specifier === 'node:crypto' ? crypto : sql);
    }, { context }));
    await auth.evaluate();
    const api = new vm.SourceTextModule(await readFile(new URL('../api/auth.js', import.meta.url), 'utf8'), { context });
    await api.link(() => auth);
    await api.evaluate();
    const invoke = async body => {
      const result = {};
      await api.namespace.default({ method: 'POST', body }, {
        status(code) { result.status = code; return this; },
        json(body) { result.body = body; return this; },
      });
      return result;
    };
    await auth.namespace.initAuthDb();
    await auth.namespace.initAuthDb();
    assert.equal((await db.query("SELECT email FROM pos_admins WHERE id = 'admin'")).rows[0].email, 'naru3644@gmail.com');
    assert.equal((await db.query("SELECT password_hash FROM pos_admins WHERE id = 'admin'")).rows[0].password_hash, hash);
    assert.equal((await db.query('SELECT admin_id FROM projects')).rows[0].admin_id, 'admin');
    assert.equal((await invoke({ id: 'admin', password: 'old-password' })).status, 200);
    assert.equal((await invoke({ id: 'existing', password: 'old-password' })).status, 200);
    assert.equal(await auth.namespace.validateAdminPassword('existing', 'old-password', sql), true);
    assert.equal(await auth.namespace.validateAdminPassword('existing', 'wrong', sql), false);
    assert.equal((await invoke({ id: 'admin', password: 'wrong-password' })).status, 401);
    for (const email of [undefined, '', 'invalid', 'a b@example.com', 'x'.repeat(255)]) {
      assert.equal((await invoke({ mode: 'signup', id: 'new-user', password: 'password', email })).status, 400);
    }
    const signup = await invoke({ mode: 'signup', id: 'new-user', password: 'password', email: ' User@Example.com ' });
    assert.equal(signup.status, 201);
    assert.match(signup.body.admin.nickname, /^(똑똑한|맛있는|즐거운|다정한|용감한|반짝이는) (자동차|딸기|고양이|구름|토끼|별)$/);
    assert.equal((await invoke({ mode: 'signup', id: 'nick-user', password: 'password', email: 'nick@example.com', nickname: '  부스작가  ' })).body.admin.nickname, '부스작가');
    assert.equal((await invoke({ mode: 'signup', id: 'long-nick', password: 'password', email: 'long@example.com', nickname: 'x'.repeat(31) })).status, 400);
    assert.equal(signup.body.admin.email, 'user@example.com');
    assert.equal(auth.namespace.verifyToken(signup.body.token).id, 'new-user');
    assert.notEqual((await db.query("SELECT password_hash FROM pos_admins WHERE id = 'new-user'")).rows[0].password_hash, 'password');
    assert.equal((await invoke({ mode: 'signup', id: 'another', password: 'password', email: 'USER@example.com' })).status, 409);
    assert.equal((await invoke({ mode: 'signup', id: 'new-user', password: 'password', email: 'other@example.com' })).status, 409);
    await assert.rejects(db.query('INSERT INTO pos_admins (id, email, password_hash) VALUES ($1, $2, $3)', ['direct', ' USER@EXAMPLE.COM ', hash]), error => error.code === '23505');
    await db.query("UPDATE pos_admins SET email = 'assigned@example.com' WHERE id = 'admin'");
    await auth.namespace.initAuthDb();
    assert.equal((await db.query("SELECT email FROM pos_admins WHERE id = 'admin'")).rows[0].email, 'assigned@example.com');
    await db.query("UPDATE pos_admins SET deleted_at=NOW(),password_hash='',email=NULL,nickname=NULL WHERE id='new-user'");
    assert.equal((await invoke({ id: 'new-user', password: 'password' })).status, 401);
    assert.equal((await invoke({ mode: 'signup', id: 'new-user', password: 'password', email: 'reuse@example.com' })).status, 409);
  } finally {
    await db.close();
  }
});
