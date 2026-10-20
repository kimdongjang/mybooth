import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('upload tokens require authentication, owned product and matching path; restrict size/type', async () => {
  const env = { BLOB_READ_WRITE_TOKEN: 'test-only' };
  const context = vm.createContext({ encodeURIComponent, process: { env } });
  const source = await readFile(new URL('../api/product-images.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  let tokenOptions;
  let owned = true;
  let archived = false;
  const dependencies = {
    '@vercel/blob/client': { handleUpload: async options => {
      tokenOptions = await options.onBeforeGenerateToken(options.body.pathname, options.body.clientPayload);
      return { type: 'token' };
    } },
    '@vercel/postgres': { sql: async parts => {
      assert.match(parts.join('?'), /project\.archived_at IS NULL|product->>'removedAt' IS NULL/);
      return { rows: owned && !archived ? [{ id: 'P001' }] : [] };
    } },
    './lib/auth.js': { requireAuth: (req, res) => {
      if (req.authenticated) return { id: 'admin-a' };
      res.status(401).json({ error: 'Unauthorized' });
      return null;
    } },
  };
  await module.link(specifier => new vm.SyntheticModule(Object.keys(dependencies[specifier]), function () {
    for (const [name, value] of Object.entries(dependencies[specifier])) this.setExport(name, value);
  }, { context }));
  await module.evaluate();
  const invoke = async (authenticated, pathname = 'products/project-a/P001/image.png', scope = { projectId: 'project-a', productId: 'P001' }) => {
    const res = { headersSent: false, status(code) { this.code = code; return this; }, json() { this.headersSent = true; return this; } };
    await module.namespace.default({ method: 'POST', authenticated, body: { type: 'blob.generate-client-token', pathname, clientPayload: JSON.stringify(scope) } }, res);
    return res.code;
  };
  delete env.BLOB_READ_WRITE_TOKEN;
  assert.equal(await invoke(false), 401);
  assert.equal(await invoke(true), 503);
  env.BLOB_READ_WRITE_TOKEN = 'test-only';
  assert.equal(await invoke(false), 401);
  assert.equal(await invoke(true), 200);
  assert.deepEqual(Array.from(tokenOptions.allowedContentTypes), ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(tokenOptions.maximumSizeInBytes, 5 * 1024 * 1024);
  assert.equal(tokenOptions.allowOverwrite, false);
  assert.equal(await invoke(true, 'products/project-b/P001/image.png'), 400);
  assert.equal(await invoke(true, 'inventory/admin-a/P001/image.png', { inventoryId: 'P001' }), 200);
  assert.equal(await invoke(true, 'inventory/admin-b/P001/image.png', { inventoryId: 'P001' }), 400);
  assert.equal(await invoke(true, 'inventory/admin-a/other/image.png', { inventoryId: 'P001' }), 400);
  archived = true;
  assert.equal(await invoke(true), 400);
  archived = false;
  owned = false;
  assert.equal(await invoke(true, 'inventory/admin-a/P001/image.png', { inventoryId: 'P001' }), 400);
  assert.equal(await invoke(true), 400);
});
