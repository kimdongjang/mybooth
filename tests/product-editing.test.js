import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function harness(filename = 'components/ProductEditForm.jsx') {
  const states = [], refs = [], calls = [];
  let index = 0, refIndex = 0, result = true, resolveSave;
  const context = vm.createContext({});
  const mocks = {
    '../hooks/useUnsavedChanges': { useUnsavedChanges: () => () => {} },
    react: { useState: initial => { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; }, useRef: initial => refs[refIndex++] ||= { current: initial }, useId: () => 'test-input' },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    './PosUI': { Input: 'Input', Quantity: 'Quantity' }, './ProductValueInput': { default: 'ProductValueInput' },
  };
  const cache = new Map();
  async function load(name) {
    if (cache.has(name)) return cache.get(name);
    const file = name.startsWith('../utils/') ? `utils/${name.slice('../utils/'.length)}.js` : filename;
    const module = mocks[name]
      ? new vm.SyntheticModule(Object.keys(mocks[name]), function () { for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value); }, { context })
      : new vm.SourceTextModule(ts.transpileModule(await readFile(new URL(`../src/${file}`, import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText, { context });
    cache.set(name, module);
    await module.link(dependency => load(dependency === './productDisplay' ? '../utils/productDisplay' : dependency));
    return module;
  }
  const module = await load('entry');
  await module.evaluate();
  const product = { name: '직접 입력한 상품', id: 'a', productCode: 'hidden', goodsType: '키링', vtuberName: '원본', creatorName: '제작자', price: 100, initialStockQty: 10, stockQty: 7, imageUrl: 'original' };
  const props = { product, products: [product, { id: 'b', price: 20 }], persistProducts: async next => { calls.push(next); return result === 'pending' ? await new Promise(resolve => { resolveSave = resolve; }) : result; }, disabled: false };
  const render = (override = {}) => { index = refIndex = 0; return module.namespace.default({ ...props, ...override }); };
  return { render, states, calls, props, setResult: value => { result = value; }, finish: value => resolveSave(value), utils: cache.get('../utils/productEditing')?.namespace };
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

test('product edits stay local until submit, preserve latest inventory/image and retain failed drafts', async () => {
  const h = await harness();
  const character = () => nodes(h.render()).find(node => node.props?.field === 'vtuberName');
  character().props.onChange('새 캐릭터');
  character().props.onChange('최종 캐릭터');
  assert.equal(h.calls.length, 0);
  h.props.products = h.props.products.map(product => product.id === 'a' ? { ...product, stockQty: 3, imageUrl: 'new-image' } : product);
  h.setResult(false);
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0].stockQty, 3);
  assert.equal(h.calls[0][0].imageUrl, 'new-image');
  assert.equal(h.calls[0][0].productCode, 'hidden');
  assert.equal(character().props.value, '최종 캐릭터');
  assert.equal(h.calls[0][1], h.props.products[1]);
  h.setResult('pending');
  const pending = h.render().props.onSubmit({ preventDefault() {} });
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 2);
  h.finish(true);
  await pending;
  assert.equal(h.calls[1][0].name, '직접 입력한 상품');
});

test('product edit validation allows free goods, rejects invalid price and offers no cancel action', async () => {
  const h = await harness();
  const price = () => nodes(h.render()).find(node => node.type === 'Input' && node.props.type === 'number');
  for (const value of ['', '-1', '1.5']) {
    price().props.onChange(value);
    await h.render().props.onSubmit({ preventDefault() {} });
  }
  assert.equal(h.calls.length, 0);
  price().props.onChange('0');
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls[0][0].price, 0);
  assert.equal(nodes(h.render()).some(node => node.props?.children === '변경 취소'), false);
  await h.render({ disabled: true }).props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 1);
});

test('recent suggestions are unique, newest first, scoped to supplied products and keyboard selectable', async () => {
  const h = await harness('components/ProductValueInput.jsx');
  const products = [{ creatorName: '예전', createdAt: '2026-10-01' }, { creatorName: '최근', createdAt: '2026-10-16' }, { creatorName: '최근', createdAt: '2026-10-15' }, { creatorName: ' ' }];
  let value = '';
  const render = () => h.render({ label: '제작자', field: 'creatorName', products, value, onChange: next => { value = next; } });
  const input = () => nodes(render()).find(node => node.type === 'Input');
  assert.equal(input().props['aria-expanded'], false);
  assert.equal(render().props.onMouseEnter, undefined);
  assert.equal(render().props.onMouseLeave, undefined);
  assert.equal(input().props.onClick, undefined);
  input().props.onFocus();
  assert.deepEqual(nodes(render()).filter(node => node.props?.role === 'option').map(node => node.props.children.props.children), ['최근', '예전']);
  input().props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  input().props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.equal(value, '최근');
  assert.equal(input().props['aria-expanded'], false);
  input().props.onChange('직접 입력');
  assert.equal(value, '직접 입력');
  input().props.onFocus();
  render().props.onBlur({ currentTarget: { contains: () => false }, relatedTarget: null });
  assert.equal(input().props['aria-expanded'], false);
});

test('custom product names are required, trimmed and saved without metadata recomposition', async () => {
  const h = await harness();
  const name = () => nodes(h.render()).find(node => node.type === 'Input' && !node.props.type);
  name().props.onChange('  ');
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 0);
  name().props.onChange('  여름 한정판 (리뉴얼)  ');
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls[0][0].name, '여름 한정판 (리뉴얼)');
});

test('only initial inventory is editable and remaining is calculated on explicit save', async () => {
  const h = await harness('components/ProductStockForm.jsx');
  const render = () => h.render({ soldQty: 3, onSave: h.props.persistProducts });
  const input = () => nodes(render()).find(node => node.type === 'Input');
  const remaining = () => nodes(render()).find(node => node.type === 'Quantity' && node.props.label === '남은 재고');
  assert.equal(nodes(render()).filter(node => node.type === 'Input').length, 1);
  assert.equal(input().props['aria-label'], '초기재고');
  assert.equal(nodes(render()).find(node => node.type === 'Quantity' && node.props.label === '판매수량').props.value, 3);
  assert.equal(nodes(render()).some(node => node.props?.children === '변경 취소'), false);
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 0);
  input().props.onChange('100');
  assert.equal(remaining().props.value, 97);
  assert.equal(h.calls.length, 0);
  h.setResult(false);
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(input().props.value, '100');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])), { initialStockQty: 100, stockQty: 97, stock: 97 });
  h.setResult('pending');
  const pending = render().props.onSubmit({ preventDefault() {} });
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 2);
  h.finish(true);
  await pending;
});

test('initial inventory rejects invalid quantities, stale stock and underselling; zero inventory is valid', async () => {
  const h = await harness('components/ProductStockForm.jsx');
  const render = (extra = {}) => h.render({ soldQty: 3, onSave: h.props.persistProducts, ...extra });
  const input = () => nodes(render()).find(node => node.type === 'Input');
  for (const value of ['', '-1', '1.5', '2']) {
    input().props.onChange(value);
    await render().props.onSubmit({ preventDefault() {} });
  }
  assert.equal(h.calls.length, 0);
  input().props.onChange('20');
  h.props.product = { ...h.props.product, stockQty: 6 };
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 0);
  const fresh = await harness('components/ProductStockForm.jsx');
  const next = () => fresh.render({ soldQty: 0, onSave: fresh.props.persistProducts });
  nodes(next()).find(node => node.type === 'Input').props.onChange('0');
  await next().props.onSubmit({ preventDefault() {} });
  assert.equal(fresh.calls[0].initialStockQty, 0);
  assert.equal(fresh.calls[0].stockQty, 0);
  assert.equal(fresh.calls[0].stock, 0);
});


test('event product genre is editable, trimmed, and submitted by the external header form', async () => {
  const h = await harness();
  const render = () => h.render({ formId: 'event-product-edit-form', hideSubmit: true });
  nodes(render()).find(node => node.props?.field === 'genre').props.onChange('  게임  ');
  assert.equal(render().props.id, 'event-product-edit-form');
  assert.equal(nodes(render()).some(node => node.type === 'button' && node.props.type === 'submit'), false);
  await render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls[0][0].genre, '게임');
});


test('shared event edits submit the baseline inventory version instead of silently overwriting external common changes', async () => {
  const h = await harness(); h.props.product.inventoryVersion = 3;
  const calls = [];
  const onSave = async (patch, version) => { calls.push(version); return { ...patch, inventoryVersion: 4 }; };
  await h.render({ onSave }).props.onSubmit({ preventDefault() {} });
  assert.equal(calls[0], 3);
  h.props.product = { ...h.props.product, name: '다른 곳에서 수정', inventoryVersion: 9 };
  await h.render({ onSave }).props.onSubmit({ preventDefault() {} });
  assert.equal(calls[1], 4);
});


test('stock-only version updates preserve unsaved product fields and cancelled cross-form saves retain the draft',async()=>{
 const h=await harness();h.props.product.inventoryVersion=1;let tree=h.render();
 nodes(tree).find(n=>n.type==='Input'&&n.props.value==='직접 입력한 상품').props.onChange('상품 편집 중');
 h.props.product={...h.props.product,inventoryVersion:2};
 let before=false;await h.render({onBeforeSave:async()=>before}).props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);
 const calls=[];before=true;await h.render({onBeforeSave:async()=>before,onSave:async(patch,version)=>{calls.push({patch,version});return {inventoryVersion:3};}}).props.onSubmit({preventDefault(){}});
 assert.equal(calls[0].version,2);assert.equal(calls[0].patch.name,'상품 편집 중');
});
