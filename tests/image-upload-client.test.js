import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('image uploads authenticate token requests and never upload after token failures', async () => {
  let response, request, uploads = 0;
  const context = vm.createContext({
    crypto: { randomUUID: () => 'image-id' },
    sessionStorage: { getItem: () => 'session-token' },
    fetch: async (url, options) => { request = { url, ...options }; return response; },
  });
  const source = await readFile(new URL('../src/utils/uploadProductImage.js', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => new vm.SyntheticModule(['put'], function () {
    this.setExport('put', async (path, image, options) => {
      uploads++;
      assert.equal(path, 'products/project%2F1/product%2F1/image-id.webp');
      assert.equal(options.token, 'vercel_blob_client_test');
      assert.equal(options.access, 'public');
      return { url: 'https://example.com/image.webp' };
    });
  }, { context }));
  await module.evaluate();
  const upload = () => module.namespace.uploadProductImage('project/1', 'product/1', { type: 'image/webp' });
  response = { ok: false, status: 503, json: async () => ({ code: 'BLOB_NOT_CONFIGURED' }) };
  await assert.rejects(upload, /이미지 저장소가 연결되지 않았습니다/);
  response = { ok: false, status: 401, json: async () => ({}) };
  await assert.rejects(upload, /인증에 실패했습니다\. 다시 로그인/);
  response = { ok: true, status: 200, json: async () => { throw new Error('HTML'); } };
  await assert.rejects(upload, /업로드 권한/);
  assert.equal(uploads, 0);
  response = { ok: true, status: 200, json: async () => ({ clientToken: 'vercel_blob_client_test' }) };
  await upload();
  assert.equal(uploads, 1);
  assert.equal(request.url, '/api/product-images');
  assert.equal(request.headers.Authorization, 'Bearer session-token');
  const body = JSON.parse(request.body);
  assert.equal(body.type, 'blob.generate-client-token');
  assert.equal(JSON.parse(body.payload.clientPayload).projectId, 'project/1');
});
