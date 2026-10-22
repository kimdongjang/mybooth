import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(allocations = []) {
  const states = [], refs = [], deps = [], effects = [], calls = [], navigations = [], confirmations = [], alerts = [], uploads = [];
  let stateIndex, refIndex, effectIndex, confirmed = true, failure = false;
  const item = { id: 'original', name: '판매 이력 상품', version: 7, stock: 4, totalReceived: 10, remainingStock: 7, allocations, history: [] };
  const context = vm.createContext({ URL: { createObjectURL: () => 'blob:preview', revokeObjectURL() {} }, alert: message => alerts.push(message), crypto: { randomUUID: () => 'new' }, sessionStorage: { getItem: () => null }, confirm: message => { confirmations.push(message); return confirmed; } });
  const mocks = {
    '../hooks/useUnsavedChanges': { useUnsavedChanges: () => () => {} },
    '../utils/confirmAction': { confirmAction: async message => { confirmations.push(message); return confirmed; } },
    react: {
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
      useRef: initial => refs[refIndex++] ||= { current: initial },
      useEffect: (effect, next) => { const i = effectIndex++; if (!deps[i] || next.some((v,j) => deps[i][j] !== v)) { deps[i] = next; effects.push(effect); } },
    },
    'react/jsx-runtime': { Fragment: 'fragment', jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    '../components/RegistrationDateForm': { default:'../components/RegistrationDateForm', dateValue: value => value ? value.slice(0,10) : '' },
    '../utils/productImage': { prepareProductImage: async file => file },
    '../utils/uploadProductImage': { uploadInventoryImage: async (...args) => { uploads.push(args); return { url: 'https://test.public.blob.vercel-storage.com/inventory/a/original/image.png' }; } },
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
  return { render, remove, item, calls, alerts, uploads, navigations, confirmations, props, confirm: value => { confirmed = value; }, fail: value => { failure = value; } };
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
  assert.equal(nodes(tree).some(node => node.props?.children === '최신 정보 불러오기'), false);
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
  assert.equal(nodes(tree).find(node => node.props?.children === '상품 삭제').props.disabled, false);
  assert.equal(nodes(tree).some(node => node.type === 'dialog'), false);
  await h.remove();
  assert.equal(h.calls.filter(call => call.action === 'removeInventory').length, 0);
  assert.equal(h.confirmations.length, 0);
  const guidance = nodes(h.render()).find(node => node.type === 'dialog');
  const links = nodes(guidance).filter(node => node.type === 'a');
  assert.equal(links.length, 2);
  assert.equal(links[0].props.href, '#/products?projectId=event%2Fone&productId=goods%2Fone');
  links[0].props.onClick({ button: 0, preventDefault() {} });
  assert.deepEqual(h.navigations, ['/products?projectId=event%2Fone&productId=goods%2Fone']);
  h.item.allocations = [];
  h.item.version = 8;
  await h.remove();
  assert.equal(h.calls.find(call => call.action === 'removeInventory').payload.version, 8);
});


test('inventory header exposes the external form save before deletion and omits verbose notes and refresh actions', async () => {
  const h = await harness();
  const tree = h.render();
  const header = nodes(tree).find(node => node.props?.className === 'management-product-header inventory-detail-header');
  const buttons = nodes(header).filter(node => node.type === 'button');
  assert.equal(buttons[0].props.form, 'inventory-product-form');
  assert.equal(buttons[0].props.type, 'submit');
  assert.equal(buttons[1].props.children, '상품 삭제');
  assert.ok(nodes(tree).find(node => node.type === 'form' && node.props.id === buttons[0].props.form));
  assert.equal(nodes(tree).filter(node => node.props?.children === '수정').length, 1);
  const text = nodes(tree).map(node => typeof node.props?.children === 'string' ? node.props.children : '').join(' ');
  assert.equal(text.includes('과거 누락된 입고'), false);
  assert.equal(text.includes('최신 정보 불러오기'), false);
});

test('blocked-delete popup can be dismissed with Escape without deleting inventory', async () => {
  const h = await harness([{ project_id: 'active', product_id: 'p', event_name: '활성 행사', stock: 0, is_active: true }]);
  await h.remove();
  const dialog = nodes(h.render()).find(node => node.type === 'dialog');
  assert.ok(dialog);
  dialog.props.onCancel({ preventDefault() {} });
  assert.equal(nodes(h.render()).some(node => node.type === 'dialog'), false);
  assert.equal(h.calls.some(call => call.action === 'removeInventory'), false);
});


test('inventory saves common fields and the allocation plan together, with alert-only success', async () => {
  const h = await harness([{ project_id: 'event', product_id: 'goods', event_name: '행사', initial_stock: 6, stock: 6 }]);
  h.item.totalStock = 10;
  let tree = h.render();
  assert.equal(nodes(tree).some(node => node.props?.label === '누적 입고 수량'), false);
  assert.equal(nodes(tree).some(node => node.props?.['aria-label'] === '창고 보관 수량'), false);
  assert.equal(nodes(tree).some(node => node.props?.children === '배정·회수할 행사'), false);
  assert.equal(nodes(tree).find(node => node.props?.['aria-label'] === '총재고').type, 'output');
  nodes(h.render()).find(node => node.props?.['aria-label'] === '행사 배정 수량').props.onChange('7');
  await nodes(h.render()).find(node => node.type === 'form' && node.props.id === 'inventory-product-form').props.onSubmit({ preventDefault() {} });
  const plan = h.calls.find(call => call.action === 'saveInventory').payload.allocationPlan;
  assert.equal(plan.totalStock, 10);
  assert.equal(plan.allocations[0].quantity, 7);
  assert.equal(plan.allocations[0].stock, 6);
  assert.equal(plan.allocations[0].initialStock, 6);
  assert.deepEqual(h.alerts, ['상품과 재고를 저장했습니다.']);
  assert.equal(nodes(h.render()).some(node => node.props?.children === '상품과 재고를 저장했습니다.'), false);
  assert.equal(nodes(h.render()).find(node => node.props?.['aria-label'] === '행사 판매 수량').type, 'output');
});

test('allocation total overflow blocks saving before sending a mutation', async () => {
  const h = await harness([{ project_id: 'event', product_id: 'goods', event_name: '행사', initial_stock: 6, stock: 6 }]);
  nodes(h.render()).find(node => node.props?.['aria-label'] === '행사 배정 수량').props.onChange('2147483647');
  await nodes(h.render()).find(node => node.type === 'form' && node.props.id === 'inventory-product-form').props.onSubmit({ preventDefault() {} });
  assert.equal(h.calls.some(call => call.action === 'saveInventory'), false);
  assert.ok(nodes(h.render()).find(node => node.props?.role === 'alert'));
});

test('allocation event names link to the exact event settings and preserve native modified clicks', async () => {
  const h=await harness([{project_id:'event/one',product_id:'goods',event_name:'행사',initial_stock:6,stock:6}]);
  const link=nodes(h.render()).find(node=>node.type==='a'&&node.props?.children==='행사');
  assert.equal(link.props.href,'#/products?projectId=event%2Fone');
  link.props.onClick({button:0,ctrlKey:true,preventDefault(){throw new Error('native click intercepted');}});
  assert.equal(h.navigations.length,0);
  link.props.onClick({button:0,preventDefault(){}});
  assert.deepEqual(h.navigations,['/products?projectId=event%2Fone']);
});

test('inventory list uses a single breadcrumb row instead of separate page and section titles', async()=>{
 const h=await harness();h.props.routeHash='#/inventory';h.render();
 const tree=h.render();
 const breadcrumb=nodes(tree).find(node=>node.props?.className==='inventory-breadcrumb');
 assert.ok(breadcrumb);
 assert.equal(nodes(breadcrumb).find(node=>node.type==='a').props.children,'재고관리');
 assert.equal(nodes(breadcrumb).find(node=>node.type==='h1').props.children,'재고 목록');
 assert.equal(nodes(tree).some(node=>node.type==='PageIntro'),false);
});


test('inventory image attachment failure retries the cached upload without changing allocation requests', async () => {
 const h=await harness();
 let failAttach=true;
 const api=h.props.api;
 h.props.api=async(action,payload)=>{
  if(action==='saveInventory' && payload.product.imageUrl) {
   h.calls.push({action,payload});
   if(failAttach) throw new Error('attachment failed');
   return {inventory:[{...h.item,imageUrl:payload.product.imageUrl}]};
  }
  return api(action,payload);
 };
 const input=()=>nodes(h.render()).find(n=>n.type==='input'&&n.props.type==='file');
 const file={type:'image/webp'};
 await input().props.onChange({target:{files:[file],value:'file'}});
 await new Promise(setImmediate);h.render();
 assert.equal(nodes(h.render()).find(n=>n.type==='ProductImage').props.imageUrl,'blob:preview');
 const submit=()=>nodes(h.render()).find(n=>n.type==='form'&&n.props.id==='inventory-product-form').props.onSubmit({preventDefault(){}});
 await submit();
 assert.equal(h.uploads.length,1);
 assert.equal(h.uploads[0][0],'a');
 assert.equal(h.uploads[0][1],'original');
 assert.equal(h.alerts.length,0);
 assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'&&String(n.props.children).includes('attachment failed')));
 failAttach=false;await submit();
 assert.equal(h.uploads.length,1);
 assert.equal(h.calls.filter(c=>c.action==='saveInventory').length,4);
 assert.equal(h.calls.filter(c=>c.payload?.product?.imageUrl).every(c=>!c.payload.allocationPlan),true);
 assert.equal(h.alerts.length,1);
});

test('new inventory header shares breadcrumb and omits unissued code; image removal clears draft', async () => {
 const h=await harness();h.props.routeHash='#/inventory/new';h.render();
 const tree=h.render();
 assert.ok(nodes(tree).some(n=>n.type==='nav'&&n.props.className==='inventory-breadcrumb'));
 assert.ok(nodes(tree).some(n=>n.type==='a'&&n.props.href==='#/inventory'));
 assert.equal(nodes(tree).some(n=>String(n.props?.children).includes('번호 발급 전')),false);
 const input=nodes(tree).find(n=>n.type==='input'&&n.props.type==='file');
 await input.props.onChange({target:{files:[{type:'image/webp'}],value:'file'}});
 await new Promise(setImmediate);h.render();
 await nodes(h.render()).find(n=>n.type==='button'&&n.props.children==='이미지 제거').props.onClick();
 h.render();assert.equal(nodes(h.render()).find(n=>n.type==='ProductImage').props.imageUrl,null);
 assert.equal(h.uploads.length,0);
});

test('registration date save sends inventory version and preserves unsaved product edits',async()=>{
 const h=await harness();const seen=[];
 h.props.api=async(action,payload)=>{seen.push({action,payload});return{inventory:[{...h.item,createdAt:'2024-02-29T00:00:00.000Z',version:8}]};};
 nodes(h.render()).find(n=>String(n.type).endsWith('/InventoryProductFields')).props.onChange('name','미저장 이름');
 const form=nodes(h.render()).find(n=>String(n.type).endsWith('/RegistrationDateForm'));
 assert.equal(await form.props.onSave('2024-02-29'),true);
 assert.equal(seen[0].action,'updateInventoryRegistrationDate');assert.equal(seen[0].payload.version,7);assert.equal(seen[0].payload.inventoryId,h.item.id);
 const fields=nodes(h.render()).find(n=>String(n.type).endsWith('/InventoryProductFields'));
 assert.equal(fields.props.draft.name,'미저장 이름');assert.equal(fields.props.draft.version,8);
});
