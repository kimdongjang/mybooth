import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('inventory deep links, direct refresh, back/forward and event history queries retain their route', async () => {
  let state;
  const listeners = new Map();
  const window = {
    location: { hash: '#/inventory/legacy%3Aevent%2Fproduct' },
    history: { pushState(_state, _title, hash) { window.location.hash = hash; }, replaceState(_state, _title, hash) { window.location.hash = hash; } },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener() {},
  };
  const context = vm.createContext({ window });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/hooks/usePageRoute.js', import.meta.url), 'utf8'), { context });
  await module.link(() => new vm.SyntheticModule(['useState','useEffect','useCallback'], function () {
    this.setExport('useState', initial => { if (!state) state = initial(); return [state, next => { state = next; }]; });
    this.setExport('useEffect', callback => callback());
    this.setExport('useCallback', callback => callback);
  }, { context }));
  await module.evaluate();
  const { usePageRoute, pageForHash } = module.namespace;
  assert.equal(usePageRoute()[0], 'inventory');
  assert.equal(usePageRoute()[2], window.location.hash);
  usePageRoute()[1]('inventory');
  assert.equal(window.location.hash, '#/inventory');
  usePageRoute()[1]('/inventory/new');
  assert.equal(usePageRoute()[2], '#/inventory/new');
  usePageRoute()[1]('/settlement?projectId=owned-event&productId=linked-id&productName=goods');
  assert.equal(usePageRoute()[0], 'log');
  assert.equal(usePageRoute()[2], window.location.hash);
  window.location.hash = '#/inventory/a'; listeners.get('popstate')();
  assert.equal(usePageRoute()[0], 'inventory');
  assert.equal(usePageRoute()[2], '#/inventory/a');
  window.location.hash = '#/inventory/b'; listeners.get('hashchange')();
  assert.equal(usePageRoute()[2], '#/inventory/b');
  assert.equal(pageForHash('#/inventory'), 'inventory');
  assert.equal(pageForHash('#/inventory/a/b'), null);
  assert.equal(pageForHash('#/unknown'), null);
});
