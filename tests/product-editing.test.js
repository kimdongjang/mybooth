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
    react: { useState: initial => { const i = index++; if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; }, useRef: initial => refs[refIndex++] ||= { current: initial }, useId: () => 'test-input' },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    './PosUI': { Input: 'Input' }, './ProductValueInput': { default: 'ProductValueInput' },
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
  const product = { id: 'a', productCode: 'hidden', goodsType: '키링', vtuberName: '원본', creatorName: '제작자', price: 100, stockQty: 7, imageUrl: 'original' };
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
  assert.equal(h.calls[1][0].name, '최종 캐릭터 키링 (제작자)');
});

test('product edit validation allows free goods, rejects invalid price and cancel restores saved fields', async () => {
  const h = await harness();
  const price = () => nodes(h.render()).find(node => node.type === 'Input');
  for (const value of ['', '-1', '1.5']) {
    price().props.onChange(value);
    await h.render().props.onSubmit({ preventDefault() {} });
  }
  assert.equal(h.calls.length, 0);
  price().props.onChange('0');
  await h.render().props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls[0][0].price, 0);
  nodes(h.render()).find(node => node.props?.children === '변경 취소').props.onClick();
  assert.equal(price().props.value, '100');
  await h.render({ disabled: true }).props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.length, 1);
});

test('recent suggestions are unique, newest first, scoped to supplied products and keyboard selectable', async () => {
  const h = await harness('components/ProductValueInput.jsx');
  const products = [{ creatorName: '예전', createdAt: '2026-10-01' }, { creatorName: '최근', createdAt: '2026-10-16' }, { creatorName: '최근', createdAt: '2026-10-15' }, { creatorName: ' ' }];
  let value = '';
  const render = () => h.render({ label: '제작자', field: 'creatorName', products, value, onChange: next => { value = next; } });
  const input = () => nodes(render()).find(node => node.type === 'Input');
  input().props.onFocus();
  assert.deepEqual(nodes(render()).filter(node => node.props?.role === 'option').map(node => node.props.children.props.children), ['최근', '예전']);
  input().props.onKeyDown({ key: 'ArrowDown', preventDefault() {} });
  input().props.onKeyDown({ key: 'Enter', preventDefault() {} });
  assert.equal(value, '최근');
  assert.equal(input().props['aria-expanded'], false);
  input().props.onChange('직접 입력');
  assert.equal(value, '직접 입력');
  assert.equal(input().props['aria-expanded'], false);
});
