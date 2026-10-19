import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(inventoryId = 'warehouse/원본', initialProductId = '') {
  const state = [], refs = [], calls = [];
  let index = 0, refIndex = 0, confirmed = true, result = true;
  const context = vm.createContext({ confirm: () => confirmed });
  const mocks = {
    react: { useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef: initial => refs[refIndex++] ||= { current: initial }, useMemo: fn => fn(), useEffect() {} },
    'react/jsx-runtime': { Fragment: 'fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../utils/productDisplay': { won: String, creatorNameOf: () => '', productNameWithoutCreator: p => p.name },
    '../utils/managementQuantities': { managementQuantities: () => ({ products: new Map(), bundles: new Map() }), managementBundleStock: () => 0 },
  };
  let source = await readFile(new URL('../src/pages/ProductsPage.jsx', import.meta.url), 'utf8');
  source += '\nexport { ProductSettingsPanel };';
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link(name => {
    const exports = mocks[name] || { default: name, Panel: 'Panel', Input: 'Input', Quantity: 'Quantity', ProductImage: 'ProductImage', PageIntro: 'PageIntro', PageTabs: 'PageTabs', prepareProductImage() {}, uploadProductImage() {} };
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const product = { id: 'event-product', inventoryId, name: '행사 상품', price: 0, stock: 2 };
  const props = { initialProductId, products: [product], bundles: [], sales: [], onRemove: async id => { calls.push(id); return result; } };
  const render = () => { index = refIndex = 0; return module.namespace.ProductSettingsPanel(props); };
  if (!initialProductId) nodes(render()).find(node => node.props?.['aria-label'] === '행사 상품 상세보기').props.onClick();
  const remove = () => nodes(render()).find(node => node.props?.['aria-label'] === '행사 상품 상품 제거').props.onClick();
  return { render, remove, calls, props, confirm: value => { confirmed = value; }, result: value => { result = value; } };
}

test('removal notice appears only after success and links to the exact encoded inventory detail', async () => {
  const h = await harness();
  h.confirm(false); await h.remove(); assert.equal(h.calls.length, 0);
  h.confirm(true); h.result(false); await h.remove();
  assert.equal(nodes(h.render()).some(node => node.props?.role === 'status' && node.props?.['aria-label'] === '상품 제거 완료'), false);
  h.result(true); await h.remove(); h.props.products = [];
  const notice = nodes(h.render()).find(node => node.props?.['aria-label'] === '상품 제거 완료');
  assert.ok(notice);
  assert.equal(nodes(notice).find(node => node.props?.children === '재고관리에서 확인하기').props.href, '#/inventory/warehouse%2F%EC%9B%90%EB%B3%B8');
  nodes(notice).find(node => node.props?.children === '닫기').props.onClick();
  assert.equal(nodes(h.render()).some(node => node.props?.['aria-label'] === '상품 제거 완료'), false);
});

test('legacy products without inventory links offer the inventory list instead of an invalid detail', async () => {
  const h = await harness(null); await h.remove(); h.props.products = [];
  const notice = nodes(h.render()).find(node => node.props?.['aria-label'] === '상품 제거 완료');
  assert.equal(nodes(notice).find(node => node.type === 'a').props.href, '#/inventory');
  assert.equal(nodes(notice).some(node => node.props?.children === '재고관리에서 확인하기'), false);
});


test('inventory event shortcut opens the requested event product detail immediately', async () => {
  const h = await harness('warehouse-original', 'event-product');
  assert.ok(nodes(h.render()).find(node => node.props?.['aria-label'] === '행사 상품 상품 제거'));
  assert.equal(h.calls.length, 0);
});
