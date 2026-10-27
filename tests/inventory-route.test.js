import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('inventory deep links, direct refresh, back/forward and event history queries retain their route', async () => {
  let state, mounted = false, allowed = true;
  const stack = []; let position = -1;
  const listeners = new Map();
  const window = {
    location: { hash: '#/inventory/legacy%3Aevent%2Fproduct' },
    history: {
      state: null,
      pushState(data, _title, hash) { this.state = data; window.location.hash = hash; stack.splice(position + 1); stack.push({ data, hash }); position++; },
      replaceState(data, _title, hash) { this.state = data; if (hash) window.location.hash = hash; stack[position] = { data, hash: window.location.hash }; },
      go(delta) { position += delta; const entry = stack[position]; this.state = entry.data; window.location.hash = entry.hash; listeners.get('popstate')?.(); },
    },
    dispatchEvent(event) { listeners.get(event.type)?.(); },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener() {},
  };
  window.history.pushState({ posRouteIndex: 0 }, '', window.location.hash);
  const context = vm.createContext({ window, Event: class { constructor(type) { this.type = type; } }, document: { addEventListener() {}, removeEventListener() {} } });
  const module = new vm.SourceTextModule(await readFile(new URL('../src/hooks/usePageRoute.js', import.meta.url), 'utf8'), { context });
  await module.link(name => name !== 'react' ? new vm.SyntheticModule(['allowNavigation'], function () { this.setExport('allowNavigation', async () => allowed); }, { context }) : new vm.SyntheticModule(['useState','useEffect','useCallback'], function () {
    this.setExport('useState', initial => { if (!state) state = initial(); return [state, next => { state = next; }]; });
    this.setExport('useEffect', callback => { if (!mounted) { mounted = true; callback(); } });
    this.setExport('useCallback', callback => callback);
  }, { context }));
  await module.evaluate();
  const { usePageRoute, pageForHash, productIdForHash } = module.namespace;
  assert.equal(usePageRoute()[0], 'inventory');
  assert.equal(usePageRoute()[2], window.location.hash);
  assert.equal(pageForHash('#/project/manage?projectId=managed-event'), 'project');
  assert.equal(pageForHash('#/project?projectId=managed-event'), 'project');
  await usePageRoute()[1]('project');
  assert.equal(window.location.hash, '#/project/manage');
  assert.equal(usePageRoute()[0], 'project');
  await usePageRoute()[1]('inventory');
  assert.equal(window.location.hash, '#/inventory');
  await usePageRoute()[1]('/inventory/new');
  assert.equal(usePageRoute()[2], '#/inventory/new');
  await usePageRoute()[1]('/settlement?projectId=owned-event&productId=linked-id&productName=goods');
  assert.equal(usePageRoute()[0], 'log');
  assert.equal(usePageRoute()[2], window.location.hash);
  await usePageRoute()[1]('/products?projectId=another-event&productId=event-product');
  assert.equal(usePageRoute()[0], 'settings');
  assert.equal(usePageRoute()[2], '#/products?projectId=another-event&productId=event-product');
  window.location.hash = '#/inventory/a'; await listeners.get('popstate')();
  assert.equal(usePageRoute()[0], 'inventory');
  assert.equal(usePageRoute()[2], '#/inventory/a');
  window.location.hash = '#/inventory/b'; await listeners.get('hashchange')();
  assert.equal(usePageRoute()[2], '#/inventory/b');
  assert.equal(pageForHash('#/inventory'), 'inventory');
  assert.equal(pageForHash('#/inventory/a/b'), null);
  assert.equal(pageForHash('#/unknown'), null);
  await usePageRoute()[1]('dashboard');
  assert.equal(usePageRoute()[0], 'dashboard');
  assert.equal(pageForHash('#/account/revenue'), 'revenue');
  assert.equal(pageForHash('#/revenue'), 'revenue');
  await usePageRoute()[1]('revenue');
  assert.equal(usePageRoute()[0], 'revenue');
  assert.equal(usePageRoute()[2], '#/account/revenue');
  await usePageRoute()[1]('/revenue?projectId=event%2Ftwo');
  assert.equal(usePageRoute()[0], 'revenue');
  assert.equal(usePageRoute()[2], '#/revenue?projectId=event%2Ftwo');
  await usePageRoute()[1]('/products/goods%2Fone?projectId=event-two');
  assert.equal(usePageRoute()[0], 'settings');
  assert.equal(usePageRoute()[2], '#/products/goods%2Fone?projectId=event-two');
  assert.equal(productIdForHash(usePageRoute()[2]), 'goods/one');
  window.location.hash = '#/products'; await listeners.get('popstate')();
  assert.equal(productIdForHash(usePageRoute()[2]), '');
  window.location.hash = '#/products/goods%2Fone?projectId=event-two'; await listeners.get('popstate')();
  assert.equal(productIdForHash(usePageRoute()[2]), 'goods/one');
  assert.equal(pageForHash('#/products/new'), 'productNew');
  assert.equal(pageForHash('#/products/bundles/new'), 'bundleNew');
  assert.equal(pageForHash('#/products/a/b'), null);
  assert.equal(productIdForHash('#/products/new'), '');
  assert.equal(productIdForHash('#/products/%broken'), '');
  allowed = false;
  const before = window.location.hash;
  await usePageRoute()[1]('account');
  assert.equal(window.location.hash, before);
  allowed = true;
  await usePageRoute()[1]('projects');
  await usePageRoute()[1]('account');
  allowed = false;
  position--; window.history.state = stack[position].data; window.location.hash = stack[position].hash;
  await listeners.get('popstate')();
  assert.equal(window.location.hash, '#/account');
  assert.equal(usePageRoute()[0], 'account');
  allowed = true;
  position--; window.history.state = stack[position].data; window.location.hash = stack[position].hash;
  await listeners.get('popstate')();
  assert.equal(usePageRoute()[0], 'projects');
  state = undefined; mounted = false; window.location.hash = '#/products/refreshed-id?projectId=owned-event';
  assert.equal(usePageRoute()[0], 'settings');
  assert.equal(productIdForHash(usePageRoute()[2]), 'refreshed-id');
  await usePageRoute()[1]('projectSettlement');
  assert.equal(window.location.hash,'#/project/settlement');
  assert.equal(usePageRoute()[0],'projectSettlement');
  await usePageRoute()[1]('/inventory/import/review');
  assert.equal(usePageRoute()[0],'inventory');
  assert.equal(usePageRoute()[2],'#/inventory/import/review');
  await usePageRoute()[1]('/inventory');
  assert.equal(window.location.hash,'#/inventory');
  assert.equal(usePageRoute()[0],'inventory');
  state=undefined;mounted=false;
  assert.equal(usePageRoute()[0],'inventory');
});
