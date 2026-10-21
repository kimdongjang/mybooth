import test from 'node:test';
import assert from 'node:assert/strict';
import { httpsOrigin, apiTarget, validUpdate } from '../src/platform/mobileConfig.js';

test('mobile requests preserve project queries and never redirect external upload URLs', () => {
  assert.equal(apiTarget('/api/pos?projectId=a%2Fb', 'https://pos.example', 'https://localhost'), 'https://pos.example/api/pos?projectId=a%2Fb');
  assert.equal(apiTarget('https://blob.example/upload', 'https://pos.example', 'https://localhost'), 'https://blob.example/upload');
  assert.equal(apiTarget('/images/default-product.svg', 'https://pos.example', 'https://localhost'), '/images/default-product.svg');
  for (const value of ['http://pos.example', 'https://user:password@pos.example', 'https://pos.example/api', 'https://pos.example?x=y']) {
    assert.throws(() => httpsOrigin(value));
  }
});

test('updates reject incompatible native contracts, malformed hashes and external bundles', () => {
  const valid = { nativeContract: 1, nativeVersion: '1.0', version: '2026.10.20-1', url: 'https://pos.example/mobile-updates/v1.zip', checksum: 'a'.repeat(64) };
  assert.equal(validUpdate(valid, 'https://pos.example', '1.0'), true);
  for (const override of [{ nativeContract: 2 }, { nativeVersion: '2.0' }, { checksum: '' }, { url: 'https://evil.example/mobile-updates/v1.zip' }, { url: 'http://pos.example/mobile-updates/v1.zip' }, { version: '../escape' }]) {
    assert.equal(validUpdate({ ...valid, ...override }, 'https://pos.example', '1.0'), false);
  }
});
