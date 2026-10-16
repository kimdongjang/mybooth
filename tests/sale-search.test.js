import test from 'node:test';
import assert from 'node:assert/strict';
import { filterSales } from '../src/utils/saleSearch.js';

const sales = [
  { id: 'cash', method: 'cash', lines: [{ id: 'P001', name: '아크릴', entries: [{ name: '아크릴', productId: 'P001' }], creators: ['하늘'] }] },
  { id: 'set', method: 'transfer', lines: [{ id: 'B001', name: '여름 세트', entries: [{ name: '엽서', productId: 'P002' }], creators: ['바다', '하늘'] }] },
  { id: 'mixed', method: 'cash', lines: [{ name: '엽서', creators: ['바다'] }, { name: '키링', creators: ['하늘'] }] },
];
const search = (filters, source = sales) => filterSales(source, filters, (line) => line.entries || [], (line) => line.creators || []).map((sale) => sale.id);

test('sales search combines payment, product and creator and searches bundle contents/codes', () => {
  assert.deepEqual(search({}), ['cash', 'set', 'mixed']);
  assert.deepEqual(search({ method: 'transfer', product: ' 엽서 ', creator: '하늘' }), ['set']);
  assert.deepEqual(search({ product: 'p002' }), ['set']);
  assert.deepEqual(search({ product: '여름' }), ['set']);
  assert.deepEqual(search({ creator: '바' }), ['set', 'mixed']);
  assert.deepEqual(search({ method: 'cash', product: '엽서', creator: '하늘' }), []);
  assert.deepEqual(search({ product: '없는 상품' }), []);
  assert.deepEqual(search({}, []), []);
  assert.deepEqual(sales.map((sale) => sale.id), ['cash', 'set', 'mixed']);
});

test('inventory history matches exact product IDs despite name changes and overlapping legacy IDs', () => {
  const source = [
    { id: 'exact', lines: [{ type: 'product', id: 'p1', name: '과거 이름' }] },
    { id: 'prefix', lines: [{ type: 'product', id: 'p10', name: '과거 이름' }] },
    { id: 'bundle', lines: [{ type: 'bundle', id: 'set', entries: [{ productId: 'p1', name: '다른 이름' }] }] },
    { id: 'bundle-id-only', lines: [{ type: 'bundle', id: 'p1', entries: [{ productId: 'p2' }] }] },
  ];
  assert.deepEqual(search({ productId: 'p1' }, source), ['exact', 'bundle']);
  assert.deepEqual(search({ productId: 'p2' }, source), ['bundle-id-only']);
});
