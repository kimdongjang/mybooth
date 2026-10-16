import test from 'node:test';
import assert from 'node:assert/strict';
import { filterInventory } from '../src/utils/inventorySearch.js';

const items = [
  { id: 'p1', name: '봄 키링', goodsType: '아크릴', vtuberName: 'Alice', creatorName: '작가 A', stock: 3 },
  { id: 'p2', productCode: 'SPRING-02', name: '봄 스티커', creatorName: '작가 B', stock: 0, allocations: [{ stock: 10 }] },
  { id: 'p3', name: '엽서', stock: 0 },
];
const ids = search => filterInventory(items, search).map(item => item.id);

test('inventory search combines creator, product metadata and legacy warehouse fallback when no total remaining is supplied', () => {
  assert.deepEqual(ids({ product: ' 봄 ', creator: '작가', stock: 'available' }), ['p1']);
  assert.deepEqual(ids({ product: '봄', creator: ' B ', stock: 'empty' }), ['p2']);
  assert.deepEqual(ids({ product: ' alice ' }), ['p1']);
  assert.deepEqual(ids({ product: '아크릴' }), ['p1']);
  assert.deepEqual(ids({ product: 'spring-02' }), ['p2']);
  assert.deepEqual(ids({ product: 'p3' }), ['p3']);
  assert.deepEqual(ids({ product: '키링', creator: 'B' }), []);
  assert.deepEqual(ids({ stock: 'empty' }), ['p2', 'p3']);
});

test('blank searches restore all inventory and missing creator can be searched without modifying source rows', () => {
  const before = structuredClone(items);
  assert.deepEqual(ids({ product: ' ', creator: ' ', stock: 'all' }), ['p1', 'p2', 'p3']);
  assert.deepEqual(ids({ creator: '미지정' }), ['p3']);
  assert.deepEqual(filterInventory([], { product: '봄' }), []);
  assert.deepEqual(items, before);
  const linked = [{ name: '굿즈', productNumber: 'UEW_0001', genre: '동방', stock: 0, remainingStock: 3 }];
  assert.equal(filterInventory(linked, { product: 'uew_0001', stock: 'available' }).length, 1);
  assert.equal(filterInventory(linked, { product: '동방' }).length, 1);
  assert.equal(filterInventory(linked, { stock: 'empty' }).length, 0);
});
