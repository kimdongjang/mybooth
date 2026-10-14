import test from 'node:test';
import assert from 'node:assert/strict';
import { managementQuantities, managementBundleStock } from '../src/utils/managementQuantities.js';

const bundles = [{ id: 'set', items: [{ productId: 'a', qty: 2 }, { productId: 'b', qty: 1 }] }];
test('management quantities include product and bundle units, prefer historical composition', () => {
  const sales = [{ lines: [{ type: 'product', id: 'a', qty: 3 }, { type: 'bundle', id: 'set', qty: 2 }] }, { lines: [{ type: 'bundle', id: 'deleted', qty: 1, subItems: [{ productId: 'b', qty: 4 }] }] }];
  const result = managementQuantities(sales, bundles);
  assert.equal(result.products.get('a'), 7);
  assert.equal(result.products.get('b'), 6);
  assert.equal(result.bundles.get('set'), 2);
  assert.equal(result.bundles.get('deleted'), 1);
  assert.equal(managementQuantities([], bundles).products.size, 0);
  assert.equal(managementQuantities(sales.slice(1), bundles).products.has('a'), false);
  assert.equal(managementQuantities(sales, []).products.get('a'), 3);
});
test('bundle availability shares remaining component stock and combines duplicate rows', () => {
  const products = [{ id: 'a', stockQty: 7 }, { id: 'b', stock: 2 }];
  assert.equal(managementBundleStock(bundles[0], products), 2);
  assert.equal(managementBundleStock({ items: [{ productId: 'a', qty: 2 }, { productId: 'a', qty: 2 }] }, products), 1);
  assert.equal(managementBundleStock(bundles[0], products.slice(0, 1)), 0);
  assert.equal(managementBundleStock({ items: [] }, products), 0);
  assert.equal(managementBundleStock({ items: [{ productId: 'a', qty: 0 }] }, products), 0);
  assert.equal(managementBundleStock(bundles[0], [{ id: 'a', stockQty: -1 }, { id: 'b', stockQty: 2 }]), 0);
});
