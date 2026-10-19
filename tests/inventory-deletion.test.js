import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(allocations = []) {
  const states = [], refs = [], deps = [], effects = [], calls = [], navigations = [], confirmations = [];
  let stateIndex, refIndex, effectIndex, confirmed = true, failure = false;
  const item = { id: 'original', name: '판매 이력 상품', version: 7, stock: 4, totalReceived: 10, remainingStock: 7, allocations, history: [] };
  const context = vm.createContext({ crypto: { randomUUID: () => 'new' }, sessionStorage: { getItem: () => null }, confirm: message => { confirmations.push(message); return confirmed; } });
  const mocks = {
    react: {
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
      useRef: initial => refs[refIndex++] ||= { current: initial },
      useEffect: (effect, next) => { const i = effectIndex++; if (!deps[i] || next.some((v,j) => deps[i][j] !== v)) { deps[i] = next; effects.push(effect); } },
    },
    'react/jsx-runtime': { Fragment: 'fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../utils/inventorySearch': { filterInventory: items => items },
    '../utils/productDisplay': { won: String },
  };
  const source = await readFile(new URL('../src/pages/InventoryPage.jsx', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link(name => {
    const exports = mocks[name] || { default: name, PageIntro: 'PageIntro', Input: 'Input', Quantity: 'Quantity', ProductImage: 'ProductImage' };
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key,value] of Object.entries(exports)) this.setExport(key,value); }, { context });
  });
  await module.evaluate();
  const props = { adminId: 'a', routeHash: '#/inventory/original', navigate: path => navigations.push(path), api: async (action, payload) => {
    calls.push({ action, payload });
    if (action === 'removeInventory' && failure) throw Object.assign(new Error('재고가 변경되었습니다. 최신 정보를 불러와주세요.'), { status: 409 });
    return { inventory: action === 'removeInventory' ? [] : [item] };
  } };
  const render = () => { stateIndex = refIndex = effectIndex = 0; const tree = module.namespace.default(props); while (effects.length) effects.shift()(); return tree; };
  render(); await Promise.resolve(); render(); render();
  const remove = () => nodes(render()).find(node => node.props?.children === '상품 삭제').props.onClick();
  return { render, remove, item, calls, navigations, confirmations, props, confirm: value => { confirmed = value; }, fail: value => { failure = value; } };
}

test('inventory delete confirms its scope, sends the saved version and keeps success feedback after returning to the list', async () => {
  const h = await harness();
  h.confirm(false); await h.remove();
  assert.equal(h.calls.filter(call => call.action === 'removeInventory').length, 0);
  h.confirm(true); await h.remove();
  const call = h.calls.find(call => call.action === 'removeInventory');
  assert.equal(call.payload.inventoryId, 'original'); assert.equal(call.payload.version, 7);
  assert.match(h.confirmations[0], /판매 이력/);
  assert.match(h.confirmations[0], /남은 수량/);
  assert.deepEqual(h.navigations, ['inventory']);
  h.props.routeHash = '#/inventory'; h.render();
  const tree = h.render();
  assert.equal(nodes(tree).some(node => node.props?.children === '상품 삭제'), false);
  assert.ok(nodes(tree).find(node => node.type === 'p' && typeof node.props.children === 'string' && node.props.children.includes('재고 관리에서 삭제했습니다')));
});

test('failed inventory deletion retains the detail and offers reload without showing success', async () => {
  const h = await harness(); h.fail(true); await h.remove();
  assert.deepEqual(h.navigations, []);
  const tree = h.render();
  assert.ok(nodes(tree).find(node => node.props?.role === 'alert'));
  assert.ok(nodes(tree).find(node => node.props?.children === '최신 정보 다시 불러오기'));
  assert.ok(nodes(tree).find(node => node.props?.children === '상품 삭제'));
  assert.equal(nodes(tree).some(node => node.type === 'p' && typeof node.props.children === 'string' && node.props.children.includes('재고 관리에서 삭제했습니다')), false);
});


test('active event links block inventory deletion including sold-out goods and preserve exact event/product routes', async () => {
  const h = await harness([
    { project_id: 'event/one', product_id: 'goods/one', event_name: '첫 행사', stock: 0, is_active: true, archived_at: null },
    { project_id: 'event-two', product_id: 'goods-two', event_name: '둘째 행사', stock: 3, is_active: true, archived_at: null },
    { project_id: 'archived', product_id: 'old', event_name: '보관 행사', stock: 2, is_active: true, archived_at: '2026-10-01' },
    { project_id: 'removed', product_id: 'gone', event_name: '제거 완료 행사', stock: 2, is_active: false, archived_at: null },
  ]);
  const tree = h.render();
  assert.equal(nodes(tree).find(node => node.props?.children === '상품 삭제').props.disabled, true);
  await h.remove();
  assert.equal(h.calls.filter(call => call.action === 'removeInventory').length, 0);
  assert.equal(h.confirmations.length, 0);
  const guidance = nodes(tree).find(node => node.props?.['aria-label'] === '재고 삭제 전 행사 상품 제거 안내');
  const links = nodes(guidance).filter(node => node.type === 'a');
  assert.equal(links.length, 2);
  assert.equal(links[0].props.href, '#/products?projectId=event%2Fone&productId=goods%2Fone');
  links[0].props.onClick({ button: 0, preventDefault() {} });
  assert.deepEqual(h.navigations, ['/products?projectId=event%2Fone&productId=goods%2Fone']);
  h.item.allocations = [];
  await nodes(guidance).find(node => node.props?.children === '최신 정보 불러오기').props.onClick();
  assert.equal(nodes(h.render()).find(node => node.props?.children === '상품 삭제').props.disabled, false);
});
