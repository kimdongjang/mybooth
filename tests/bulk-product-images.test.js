import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

async function harness({ save = true, failAttach = false } = {}) {
  const state = [], refs = [], saved = [], uploaded = [], attached = [];
  let stateIndex, refIndex, fail = failAttach;
  const context = vm.createContext({ crypto: { randomUUID: () => `uuid-${refs.length}-${Math.random()}` }, navigator: { onLine: true }, sessionStorage: { getItem: () => 'test-token' } });
  const modules = {
    react: { useRef: value => { const i = refIndex++; return refs[i] ||= { current: value }; }, useState: value => { const i = stateIndex++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = next; }]; } },
    'react/jsx-runtime': { Fragment: 'fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '@vercel/blob/client': { upload: async (path, image, options) => { uploaded.push({ path, image, options }); return { url: `https://test.public.blob.vercel-storage.com/${path}` }; } },
    '../utils/productImage': { PRODUCT_IMAGE_HELP: 'test', prepareProductImage: async file => { if (file.name === 'bad.txt') throw new Error('invalid image'); return { type: 'image/webp' }; } },
  };
  const source = await readFile(new URL('../src/pages/BulkProductImages.jsx', import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText, { context });
  await module.link(name => {
    const exports = modules[name];
    return new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const render = () => {
    stateIndex = refIndex = 0;
    return module.namespace.default({ projectId: 'project-1', products: [{ id: 'existing' }], disabled: false, onBusy() {},
      persistProducts: async products => { saved.push(products); return save; },
      onImageChange: async (id, url) => { attached.push({ id, url }); if (fail) { fail = false; return false; } return true; },
    });
  };
  const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
  const select = async files => { const input = nodes(render()).find(node => node.type === 'input'); const event = { target: { files, value: 'selected' } }; input.props.onChange(event); while (!state[1]?.includes('상품') || state[1]?.includes('중')) await new Promise(resolve => setTimeout(resolve, 1)); };
  return { saved, uploaded, attached, state, select, retry: async () => { const button = nodes(render()).find(node => node.props?.children === '실패한 이미지 다시 저장'); await button.props.onClick(); } };
}

test('bulk creates valid products once, preserves existing products and skips invalid images', async () => {
  const h = await harness();
  await h.select([{ name: '키링.png' }, { name: 'bad.txt' }, { name: '엽서.jpg' }]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].length, 3);
  assert.equal(h.saved[0][0].id, 'existing');
  const products = h.saved[0].slice(1);
  assert.equal(products[0].name, '키링');
  assert.notEqual(products[0].id, products[1].id);
  for (const p of products) { assert.equal(p.price, 0); assert.equal(p.stock, 0); assert.equal(p.stockQty, 0); assert.equal(p.initialStockQty, 0); assert.equal(p.id, p.productCode); }
  assert.equal(h.uploaded.length, 2);
  assert.equal(h.attached.length, 2);
  assert.equal(JSON.parse(h.uploaded[0].options.clientPayload).projectId, 'project-1');
  assert.equal(h.state[2].length, 1);
});

test('failed image attachment retries the same URL without creating products or uploading again', async () => {
  const h = await harness({ failAttach: true });
  await h.select([{ name: '키링.png' }]);
  assert.equal(h.state[0].length, 1);
  await h.retry();
  assert.equal(h.saved.length, 1);
  assert.equal(h.uploaded.length, 1);
  assert.equal(h.attached.length, 2);
  assert.equal(h.attached[0].url, h.attached[1].url);
  assert.equal(h.state[0].length, 0);
});

test('failed product registration never starts image uploads', async () => {
  const h = await harness({ save: false });
  await h.select([{ name: '키링.png' }]);
  assert.equal(h.saved.length, 1);
  assert.equal(h.uploaded.length, 0);
});

