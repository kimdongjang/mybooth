import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(inventoryId = 'warehouse/원본', initialProductId = '') {
  const state = [], refs = [], calls = [], navigations = [];
  let index = 0, refIndex = 0, confirmed = true, result = true;
  const context = vm.createContext({ confirm: () => confirmed });
  const mocks = {
    '../hooks/useUnsavedChanges': { allowNavigation: async () => true },
    '../utils/confirmAction': { confirmAction: async () => confirmed },
    '../hooks/useProductReorder': { useProductReorder: () => ({busy:false,message:'',rowProps:()=>({}),handleProps:()=>({})}) },
    react: { useState: initial => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; }, useRef: initial => refs[refIndex++] ||= { current: initial }, useMemo: fn => fn(), useEffect() {} },
    'react/jsx-runtime': { Fragment: 'fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../utils/productDisplay': { won: String, compareProductSaleNumber: (a,b)=>(a.saleNumber||0)-(b.saleNumber||0), creatorNameOf: () => '', productNameWithoutCreator: p => p.name },
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
  const props = { initialProductId, projectId: 'event/one', navigate: path => { navigations.push(path); props.initialProductId = path.startsWith('/products/') ? decodeURIComponent(path.split('?')[0].slice('/products/'.length)) : ''; }, products: [product], bundles: [], sales: [], onRemove: async id => { calls.push(id); return result; } };
  const render = () => { index = refIndex = 0; return module.namespace.ProductSettingsPanel(props); };
  if (!initialProductId) nodes(render()).find(node => node.props?.['aria-label'] === '행사 상품 상세보기').props.onClick({ button: 0, preventDefault() {} });
  const remove = () => nodes(render()).find(node => node.props?.['aria-label'] === '행사 상품 상품 제거').props.onClick();
  return { render, remove, calls, props, navigations, confirm: value => { confirmed = value; }, result: value => { result = value; } };
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


test('event detail omits the context block and duplicate heading and moves its inventory link into the product header', async () => {
  const h = await harness('warehouse-original', 'event-product');
  h.props.projectName = '2026 행사';
  h.props.products[0].imageUrl = 'https://example.test/image.webp';
  const tree = h.render();
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === '현재 관리 위치'), false);
  assert.equal(nodes(tree).some(node => node.props?.children === '행사 상품 상세' || node.props?.children === '← 목록으로'), false);
  const header = nodes(tree).find(node => node.props?.className === 'management-product-header inventory-detail-header');
  assert.equal(nodes(header).find(node => node.type === 'a').props.href, '#/inventory/warehouse-original');
  assert.equal(nodes(header).find(node => node.props?.children === '수정').props.form, 'event-product-edit-form');
  assert.ok(nodes(header).find(node => node.props?.children === '상품 삭제'));
  assert.ok(nodes(tree).find(node => node.props?.formId === 'event-product-edit-form' && node.props.hideSubmit));
  assert.ok(nodes(tree).find(node => node.props?.className === 'management-upload product-image-upload'));
  assert.ok(nodes(tree).find(node => node.props?.className === 'product-image-remove'));
});

test('product selection uses encoded detail URLs, modified clicks remain native, and route props control back/forward selection', async () => {
  const h = await harness(); h.props.initialProductId = ''; h.navigations.length = 0;
  let link = nodes(h.render()).find(node => node.props?.['aria-label'] === '행사 상품 상세보기');
  assert.equal(link.type, 'a');
  assert.equal(link.props.href, '#/products/event-product?projectId=event%2Fone');
  link.props.onClick({button:0,ctrlKey:true,preventDefault(){throw new Error('native tab click intercepted');}});
  assert.equal(h.navigations.length,0);
  link.props.onClick({button:0,preventDefault(){}});
  assert.equal(h.navigations[0],'/products/event-product?projectId=event%2Fone');
  assert.ok(nodes(h.render()).find(node=>node.props?.['aria-label']==='행사 상품 상품 제거'));
  h.props.initialProductId='';
  assert.ok(nodes(h.render()).find(node=>node.props?.['aria-label']==='행사 상품 상세보기'));
  h.props.initialProductId='missing-product';
  assert.ok(nodes(h.render()).find(node=>node.props?.children==='상품을 찾을 수 없습니다'));
  const back=nodes(h.render()).find(node=>node.props?.children==='상품 목록으로');
  assert.equal(back.props.href,'#/products?projectId=event%2Fone');
});

test('all products expose grab handles with read-only numbers and compact detail identity',async()=>{
 const h=await harness();h.props.initialProductId='';
 h.props.products=Array.from({length:30},(_,i)=>({id:`p${i}`,name:`상품 ${i}`,saleNumber:i+1,inventoryId:'original'}));
 const tree=h.render();
 assert.equal(nodes(tree).filter(node=>node.props?.className==='product-grab-handle').length,30);
 assert.equal(nodes(tree).filter(node=>node.type==='output'&&node.props?.className==='product-sale-number').length,30);
 assert.equal(nodes(tree).some(node=>node.type==='input'&&node.props?.type==='number'),false);
 assert.equal(nodes(tree).some(node=>node.props?.['aria-label']==='상품 목록 페이지'),false);
 h.props.initialProductId='p0';
 const detail=h.render();assert.ok(nodes(detail).find(node=>node.props?.className==='event-product-meta'));
 const number=nodes(detail).find(node=>node.props?.className==='event-product-tag');
 assert.equal([number.props.children].flat().join(''),'1번 상품');
});
