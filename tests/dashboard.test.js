import { revenueSummary } from '../src/utils/revenueSummary.js';
import { dashboardSummary, loadDashboard } from '../src/utils/dashboardSummary.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(file) {
  const states = [], effects = [];
  let cursor = 0, mounted = false;
  const context = vm.createContext({});
  const source = await readFile(new URL(`../src/pages/${file}.jsx`, import.meta.url), 'utf8');
  const module = new vm.SourceTextModule(ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText, { context });
  const mocks = {
    '../components/EventSettlementPanel': {default:'EventSettlementPanel'},
    '../components/LoadingState': {default:'LoadingState'},
    react: { useState: initial => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; }, useEffect: effect => { if (!mounted) effects.push(effect); } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    dexie: { liveQuery: () => ({ subscribe: () => ({ unsubscribe() {} }) }) },
    '../database/orderRepository': { orderRepository: { countWaiting: async () => 0 } },
    '../utils/revenueSummary': { revenueSummary },
    '../utils/dashboardSummary': { dashboardSummary, loadDashboard },
    '../components/PageLayout': { PageIntro: 'PageIntro', PageTabs: 'PageTabs' },
    '../utils/productDisplay': { won: String },
    '../utils/saleSearch': { filterSales: sales => sales },
    '../components/PosUI': { Stat: 'Stat' },
    '../components/SearchFilters': { default: 'SearchFilters' },
  };
  await module.link(name => new vm.SyntheticModule(Object.keys(mocks[name]), function () { for (const [key, value] of Object.entries(mocks[name])) this.setExport(key, value); }, { context }));
  await module.evaluate();
  return { effects, render(props) { cursor = 0; const tree = module.namespace.default(props); mounted = true; return nodes(tree); } };
}

test('dashboard totals use server stock fields and server sales; late responses after leaving are ignored', async () => {
  const h = await harness('DashboardPage');
  const requests = [];
  const props = { request: (...args) => new Promise(resolve => requests.push({ args, resolve })) };
  h.render(props);
  const cleanup = h.effects[0]();
  assert.equal(requests[0].args[0], '/api/pos');
  assert.equal(JSON.parse(requests[1].args[1].body).action, 'listInventory');
  requests[0].resolve({ projects: [{ id: 'a/b', name: 'A', summary: { products: 1, remainingStock: 3, sales: 2, total: 0 } }] });
  requests[1].resolve({ inventory: [{ stock: 2, allocations: [{stock:1}], history: [{ soldQty: 4 }] }] });
  await new Promise(resolve => setImmediate(resolve));
  requests[2].resolve({ products: [{id:'x',stockQty:1}],sales:[],bundles:[] });
  await new Promise(resolve => setImmediate(resolve));
  requests[3].resolve({ settlements: [] });
  await new Promise(resolve => setImmediate(resolve));
  const tree = h.render(props);
  const metric = label => tree.find(node => node.props?.label === label)?.props.value;
  assert.equal(metric('전체 판매액'), '0원');
  assert.equal(metric('미분배 재고'), '2개');
  assert.equal(metric('거래 건수'), '0건');
  assert.ok(tree.some(node => node.props?.href === '#/settlement?projectId=a%2Fb'));
  cleanup();

  const other = await harness('DashboardPage');
  const delayed = [];
  const next = { request: () => new Promise(resolve => delayed.push(resolve)) };
  other.render(next); other.effects[0]()();
  delayed[0]({ projects: [] }); delayed[1]({ inventory: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(other.render(next).some(node => node.props?.label === '미분배 재고'), false);
});

test('revenue history preserves export but cannot cancel sales or clear them', async () => {
  const h = await harness('SettlementPage');
  const props = { reportOnly: true, initialTab: 'history', stats: { total: 1000, cash: 1000, transfer: 0 }, sales: [{ id: 's' }], visibleSales: [{ id: 's', time: '2026-10-21', total: 1000, method: 'cash', lines: [] }], creatorSalesSummary: [] };
  const labels = h.render(props).filter(node => node.type === 'button').map(node => node.props.children);
  assert.ok(labels.includes('판매 내역 내보내기'));
  assert.ok(!labels.includes('취소'));
  assert.ok(!labels.includes('전체 판매 내역 초기화'));
});


test('account summary combines historical creator snapshots across events and preserves free sales and exact event links', () => {
 const data = { projects:[{id:'a',name:'A'},{id:'b',name:'B',archivedAt:'2026-01-01'}], inventory:[{id:'original',name:'키링',stock:7,history:[{soldQty:3}],allocations:[{project_id:'a',stock:1,is_active:true}]}], states:[
  {products:[{id:'same',creatorName:'변경 이름',price:9999,stockQty:1}],sales:[{total:1000,method:'cash',lines:[{type:'product',id:'same',name:'키링',creatorName:' 작가 ',unitPrice:500,qty:2}]}]},
  {products:[{id:'same',creatorName:'다른 작가',stockQty:4}],sales:[{total:0,method:'transfer',lines:[{type:'product',id:'same',name:'키링',creatorName:'작가',unitPrice:0,qty:1}]}]},
 ]};
 const summary = dashboardSummary(data);
 assert.equal(summary.total,1000);assert.equal(summary.transactions,2);assert.equal(summary.average,500);
 assert.equal(summary.cash,1000);assert.equal(summary.activeEvents,1);
 assert.deepEqual(summary.stock,{sold:3,allocated:1,unallocated:7});
 assert.equal(summary.creators.length,1);assert.equal(summary.creators[0].amount,1000);assert.equal(summary.creators[0].qty,3);
 assert.equal(summary.creators[0].events.length,2);assert.equal(summary.goods[0].qty,3);
 assert.equal(summary.alerts.length,2);
 assert.equal(summary.events.find(event=>event.id==='a').sellThrough,2/3*100);
});

test('bundle allocations match settlement weights and partial failures never produce a misleading account total', async () => {
 const summary = dashboardSummary({projects:[{id:'a',name:'A'}],inventory:[],states:[{products:[],sales:[{total:900,method:'transfer',lines:[{type:'bundle',qty:1,unitPrice:900,subItems:[{productId:'x',name:'X',creatorName:'one',qty:2,unitPrice:100},{productId:'y',name:'Y',creatorName:'two',qty:1,unitPrice:100}]}]}]}]});
 assert.equal(summary.creators[0].amount,600);assert.equal(summary.creators[1].amount,300);
 assert.equal(summary.transfer,900);
 await assert.rejects(loadDashboard(async (url,options) => options ? {inventory:[]} : url==='/api/pos' ? {projects:[{id:'a'},{id:'b'}]} : url.endsWith('a') ? {sales:[]} : Promise.reject(new Error('unavailable'))),/unavailable/);
 const empty=dashboardSummary({projects:[],inventory:[],states:[]});
 assert.equal(empty.average,0);assert.deepEqual(empty.creators,[]);assert.deepEqual(empty.alerts,[]);
});
