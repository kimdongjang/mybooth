import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const urls = new Map();
function sourceUrl(path) {
  if (urls.has(path)) return urls.get(path);
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  code = code.replace(/from ['"]([^'"]+)['"]/g, (match, name) => {
    if (!name.startsWith('.') && name !== 'dexie') throw new Error(`Unmapped dependency: ${name}`);
    if (name === 'dexie') return `from '${new URL('../node_modules/dexie/dist/dexie.mjs', import.meta.url).href}'`;
    const target = new URL(`${name}.ts`, new URL(path, import.meta.url));
    return `from '${sourceUrl(target.href)}'`;
  });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  urls.set(path, url);
  return url;
}
// Canonical URLs ensure all modules share the same Dexie instance.
const load = path => import(sourceUrl(new URL(path, import.meta.url).href));
const { db } = await load('../src/database/dexie.ts');
const { stateRepository: states } = await load('../src/database/stateRepository.ts');
const { orderRepository: orders } = await load('../src/database/orderRepository.ts');
const initial = { products: [{ id: 'p', stock: 5 }], bundles: [], sales: [], dataRevision: null };
const sold = { ...initial, products: [{ id: 'p', stock: 4 }], sales: [{ id: 'sale' }] };
const order = { projectId: 'a', localOrderId: 'sale', createdAt: '2026-10-15', payload: { projectId: 'a' }, syncStatus: 'PENDING', retryCount: 0 };

test('v3 to v4 upgrade preserves legacy payloads and binds cached state only after owner-confirmed remote reads',async()=>{
  await db.delete();
  const legacy=new Dexie(db.name);
  legacy.version(3).stores({orders:'++id, projectId, [projectId+syncStatus], [projectId+localOrderId], localOrderId, createdAt, syncStatus, retryCount, lastSyncAt',posState:'key, projectId, updatedAt'});
  await legacy.table('orders').add({...order});
  await legacy.table('posState').put({key:'project:a:latest',projectId:'a',updatedAt:'2026-10-15',state:initial});
  legacy.close();
  try {
    await db.open();
    assert.equal(db.verno,4);assert.deepEqual((await orders.getAll('a'))[0].payload,order.payload);
    assert.equal((await orders.getAll('a'))[0].localOrderId,'sale');
    assert.equal(await states.getForActor('a','a'),null,'unbound legacy cache is not shown offline as a different user');
    await assert.rejects(states.acceptRemote('a',{...initial,actorId:'b',legacyActorId:'a'}),/원래 계정/);
    const bound=await states.acceptRemote('a',{...sold,actorId:'a',legacyActorId:'a',boothId:'booth-a'});
    assert.deepEqual(bound.products,initial.products);assert.equal(bound.actorId,'a');
    assert.equal((await orders.getAll('a'))[0].actorId,undefined,'migration does not invent a legacy author');
    assert.equal(await states.getForActor('a','b'),null);
    const scoped={...order,actorId:'a',boothId:'booth-a',localOrderId:'scoped',payload:{projectId:'a',actorId:'a',boothId:'booth-a'}};
    await states.commitOrder('a',scoped,initial,sold);
    assert.equal((await states.getForActor('a','a')).boothId,'booth-a');
    await assert.rejects(states.commitOrder('a',{...scoped,actorId:'b'},sold,initial),/계정/);
  }finally{await db.delete();await db.open();}
});

test('IndexedDB atomic sale/cancel, injected failure, stale tabs and remote response races', async () => {
  try {
    await states.save('a', initial);
    const version = await states.queueVersion('a');
    await states.commitOrder('a', order, initial, sold);
    assert.deepEqual(await states.get('a'), sold);
    assert.equal(await orders.countWaiting('a'), 1);
    await assert.rejects(states.commitOrder('a', order, initial, sold), /다른 탭/);
    assert.equal((await orders.getAll('a')).length, 1);
    // A response obtained before the sale must not erase it, even after upload.
    await orders.updateStatus((await orders.getAll('a'))[0].id, 'SYNCED');
    assert.deepEqual(await states.acceptRemote('a', initial, version), sold);
    const fail = () => { throw new Error('injected quota failure'); };
    db.posState.hook('updating', fail);
    await assert.rejects(states.commitOrder('a', { ...order, localOrderId: 'void_sale' }, sold, initial), /injected quota/);
    db.posState.hook('updating').unsubscribe(fail);
    assert.deepEqual(await states.get('a'), sold);
    assert.equal((await orders.getAll('a')).length, 1);
    await states.commitOrder('a', { ...order, localOrderId: 'void_sale' }, sold, initial);
    assert.deepEqual(await states.get('a'), initial);
    assert.equal((await orders.getAll('a')).length, 2);
    assert.equal(await orders.countWaiting('b'), 0);
    assert.deepEqual(await states.acceptRemote('a', sold), initial);
    const pending = (await orders.getPendingOrders('a'))[0];
    await orders.updateStatus(pending.id, 'SYNCING');
    assert.equal((await orders.getPendingOrders('a'))[0].localOrderId, 'void_sale');
    const locked=await states.acceptRemote('a',{...sold,settlementClosedAt:'2026-10-21'});
    assert.deepEqual(locked.products,initial.products);
    assert.equal(locked.settlementClosedAt,'2026-10-21');
    assert.equal((await orders.getAll('a')).length,2);
    await assert.rejects(states.commitOrder('a',{...order,localOrderId:'closed-order'},locked,sold),/마감/);
    await states.setSettlementClosedAt('a',null);
    assert.equal((await states.get('a')).settlementClosedAt,null);
  } finally { await db.delete(); }
});

test('retired contract preserves queued sale, dependent cancel and local projection until compatibility recovery', async () => {
  const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),previousFetch=globalThis.fetch,warn=console.warn;
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true,locks:{request:async(_name,_options,callback)=>callback({})}}});
  const {syncService}=await load('../src/sync/syncService.ts');
  const payload={projectId:'a',action:'finalizeSale',payload:{localOrderId:'sale',lines:[],total:0}};
  const sent=[];
  try {
    await db.open();await states.save('a',sold);
    await orders.add({...order,payload});
    await orders.add({...order,localOrderId:'void_sale',payload:{projectId:'a',action:'voidSale',payload:{localOrderId:'void_sale',saleId:'sale'}}});
    syncService.configure({projectId:'a',getAuthToken:()=> 'a-token'});
    globalThis.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:false,status:410,json:async()=>({error:'구형 쓰기 계약이 종료되었습니다.'})};};
    console.warn=()=>{};await syncService.sync();
    assert.deepEqual(sent,[payload]);
    assert.deepEqual((await orders.getAll('a')).map(o=>o.syncStatus),['FAILED','PENDING']);
    assert.deepEqual((await orders.getAll('a'))[0].payload,payload);
    assert.equal((await orders.getAll('a'))[0].localOrderId,'sale');
    assert.equal(await orders.countWaiting('a'),2);
    assert.deepEqual(await states.acceptRemote('a',initial),sold);
    globalThis.fetch=async(_url,options)=>{sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};};
    await syncService.sync();
    assert.deepEqual(sent[1],payload,'recovery retries the exact original contract and identity');
    assert.equal(sent[2].action,'voidSale');assert.equal(await orders.countWaiting('a'),0);
  } finally {
    console.warn=warn;globalThis.fetch=previousFetch;
    if(previousNavigator)Object.defineProperty(globalThis,'navigator',previousNavigator);else delete globalThis.navigator;
    await db.delete();await db.open();
  }
});

test('sync recovers SYNCING in insertion order, stops dependencies on failure, and freezes credentials', async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalFetch = globalThis.fetch;
  let held = false;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    onLine: true,
    locks: { async request(_name, _options, callback) {
      if (held) return callback(null);
      held = true;
      try { return await callback({}); } finally { held = false; }
    } },
  } });
  const { syncService } = await load('../src/sync/syncService.ts');
  let snapshot;
  const unsubscribe = syncService.subscribe(value => { snapshot = value; });
  let token = 'a-token';
  const calls = [];
  try {
    await db.open();
    await orders.add({ ...order, syncStatus: 'SYNCING', createdAt: '2099-01-01', payload: { projectId: 'a', action: 'finalizeSale' } });
    await orders.add({ ...order, localOrderId: 'void_sale', createdAt: '2000-01-01', payload: { projectId: 'a', action: 'voidSale' } });
    syncService.configure({ projectId: 'a', getAuthToken: () => token });
    globalThis.fetch = async (_url, options) => {
      calls.push(JSON.parse(options.body).action);
      assert.ok(options.signal);
      throw new Error('response lost');
    };
    const warn = console.warn;
    console.warn = () => {};
    try { await syncService.sync(); } finally { console.warn = warn; }
    assert.deepEqual(calls, ['finalizeSale']);
    assert.deepEqual((await orders.getAll('a')).map(o => o.syncStatus).sort(), ['FAILED', 'PENDING']);
    calls.length = 0;
    let release;
    globalThis.fetch = async (_url, options) => {
      calls.push(JSON.parse(options.body).action);
      assert.equal(options.headers.Authorization, 'Bearer a-token');
      await new Promise(resolve => { release = resolve; });
      return { ok: true, json: async () => ({}) };
    };
    const running = syncService.sync();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    await syncService.sync();
    assert.equal(calls.length, 1);
    token = 'b-token';
    syncService.configure({ projectId: 'b', getAuthToken: () => token });
    release();
    await running;
    assert.equal(snapshot.lastSyncedAt, null, 'old project response must not set the current project sync time');
    assert.deepEqual(calls, ['finalizeSale']);
    assert.equal(await orders.countWaiting('a'), 1);
    syncService.configure({ projectId: 'a', getAuthToken: () => 'a-token' });
    globalThis.fetch = async (_url, options) => { calls.push(JSON.parse(options.body).action); return { ok: true, json: async () => ({}) }; };
    await syncService.sync();
    assert.deepEqual(calls, ['finalizeSale', 'voidSale']);
    assert.equal(await orders.countWaiting('a'), 0);
    assert.ok(Number.isFinite(Date.parse(snapshot.lastSyncedAt)), 'successful order upload records its actual timestamp');
    syncService.configure({ projectId: 'b', getAuthToken: () => 'b-token' });
    assert.equal(snapshot.lastSyncedAt, null, 'project change clears the previous project sync time');
  } finally {
    unsubscribe();
    globalThis.fetch = originalFetch;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
    await db.delete();
  }
});
