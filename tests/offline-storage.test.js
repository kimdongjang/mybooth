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
const {LocalFirstStore}=await load('../src/data/localFirst.ts');
const {createEventReadCache}=await load('../src/data/eventReadCache.ts');
const initial = { products: [{ id: 'p', stock: 5 }], bundles: [], sales: [], dataRevision: null };
const sold = { ...initial, products: [{ id: 'p', stock: 4 }], sales: [{ id: 'sale' }] };
const order = { projectId: 'a', localOrderId: 'sale', createdAt: '2026-10-15', payload: { projectId: 'a' }, syncStatus: 'PENDING', retryCount: 0 };

test('event reads reuse IndexedDB across remounts, coalesce misses, and reuse the workspace without another API',async()=>{
 const scope={actorId:'reader',boothId:'booth',projectId:'event'},store=new LocalFirstStore(db,()=>true),calls=[];
 const url='/api/booths?workspace=stockParticipants&projectId=event&boothId=booth';
 let release;const gate=new Promise(resolve=>release=resolve);
 const request=async(url,options)=>{calls.push({url,options});await gate;return {profiles:[{owner_id:'maker'}]};};
 const cache=createEventReadCache({scope,store,request,isCurrent:()=>true});
 try{
  await store.put({actorId:'reader'},'workspace',{profiles:[{owner_id:'self'}]});
  assert.equal((await cache.request('/api/booths?workspace=home')).profiles[0].owner_id,'self');assert.equal(calls.length,0);
  const first=cache.request(url),second=cache.request(url);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,1);
  release();assert.deepEqual(await first,await second);assert.equal(calls[0].options.background,true,'automatic auxiliary cache preparation never starts the global spinner');
  const reopened=createEventReadCache({scope,store,request:async()=>{throw new Error('cache must win');},isCurrent:()=>true});
  assert.equal((await reopened.request(url)).profiles[0].owner_id,'maker');
 }finally{await db.delete();await db.open();}
});

test('event background refresh is silent, updates subscribers, and stops requesting departed screens',async()=>{
 const scope={actorId:'reader',boothId:'booth',projectId:'event'},store=new LocalFirstStore(db,()=>true),calls=[];let version=1,updates=0;
 const cache=createEventReadCache({scope,store,isCurrent:()=>true,request:async(url,options)=>{calls.push(options);return {version};}});
 const unsubscribe=cache.request.subscribe(()=>updates++),url='/api/booths?artists=stock&ownerId=maker&projectId=event&boothId=booth';
 try{
  await cache.request(url);version=2;assert.equal(await cache.refresh({activeOnly:true}),true);
  assert.equal(calls.length,2);assert.equal(calls[1].background,true);assert.ok(calls[1].signal);assert.equal(updates,1);
  assert.equal((await cache.request(url)).version,2);assert.equal(calls.length,2);
  unsubscribe();await cache.refresh({activeOnly:true});assert.equal(calls.length,2);
 }finally{unsubscribe();await db.delete();await db.open();}
});

test('event cache commands stay online, invalidate saved and conflicted reads, and preserve orders/state',async()=>{
 const scope={actorId:'reader',boothId:'booth',projectId:'event'},store=new LocalFirstStore(db,()=>true);let version=1,fail=false,posts=0,gets=0;
 const url='/api/booths?workspace=access&projectId=event&boothId=booth';
 const cache=createEventReadCache({scope,store,isCurrent:()=>true,request:async(_url,options)=>{
  if(options.method==='POST'){posts++;if(fail)throw Object.assign(new Error('conflict'),{status:409});version++;return {saved:true};}
  gets++;return {version};
 }});
 try{
  await states.save('a',initial);await orders.add({...order});
  assert.equal((await cache.request(url)).version,1);
  await cache.request('/api/booths',{method:'POST',body:'command'});
  assert.equal((await cache.request(url)).version,2);assert.equal(gets,2);assert.equal(posts,1);
  fail=true;await assert.rejects(cache.request('/api/booths',{method:'POST'}),/conflict/);
  await cache.request(url);assert.equal(gets,3);
  assert.deepEqual(await states.get('a'),initial);assert.equal(await orders.countWaiting('a'),1);
 }finally{await db.delete();await db.open();}
});

test('event cache isolates actor/booth/event, supports offline reads, and hides denied snapshots',async()=>{
 const scope={actorId:'reader',boothId:'booth',projectId:'event'};let online=true,denied=false;
 const store=new LocalFirstStore(db,()=>online),url='/api/booths?artists=history';
 const request=async()=>{if(!online)throw new Error('offline');if(denied)throw Object.assign(new Error('forbidden'),{status:403});return {privateValue:1};};
 const cache=createEventReadCache({scope,store,request,isCurrent:()=>true});
 try{
  await cache.request(url);online=false;assert.equal((await cache.request(url)).privateValue,1);
  await cache.invalidate();assert.equal((await cache.request(url)).privateValue,1);
  for(const other of [{...scope,actorId:'other'},{...scope,boothId:'other'},{...scope,projectId:'other'}]){
   const isolated=createEventReadCache({scope:other,store,request,isCurrent:()=>true});await assert.rejects(isolated.request(url),/인터넷/);
  }
  online=true;denied=true;assert.equal(await cache.refresh(),false);
  await assert.rejects(cache.request(url),/forbidden/);
 }finally{await db.delete();await db.open();}
});

test('late event reads cannot overwrite a mutation refresh or survive an account switch',async()=>{
 const scope={actorId:'reader',boothId:'booth',projectId:'event'},store=new LocalFirstStore(db,()=>true),url='/api/booths?artists=stock&ownerId=maker';
 let release,first=true,active=true;const gate=new Promise(resolve=>release=resolve);
 const cache=createEventReadCache({scope,store,isCurrent:()=>active,request:async()=>{if(first){first=false;await gate;return {version:1};}return {version:2};}});
 try{
  const old=cache.request(url);await new Promise(resolve=>setImmediate(resolve));await cache.invalidate();
  assert.equal((await cache.request(url)).version,2);release();await assert.rejects(old,/범위/);
  assert.equal((await cache.request(url)).version,2);active=false;await assert.rejects(cache.request(url),/범위/);
 }finally{release();await db.delete();await db.open();}
});

test('local-first reads return durable cache before the remote result, isolate scope and revoke denied data',async()=>{
 await db.open();const store=new LocalFirstStore(db,()=>true),scope={actorId:'artist-a',boothId:'booth-a'};
 try{
  await store.put(scope,'list',[1]);let release;const response=new Promise(resolve=>release=resolve);
  const result=await store.read({scope,resource:'list',fetchRemote:()=>response});assert.equal(result.source,'local');assert.deepEqual(result.value,[1]);
  assert.equal(await store.get({actorId:'artist-b',boothId:'booth-a'},'list'),undefined);assert.equal(await store.get({...scope,boothId:'booth-b'},'list'),undefined);
  release([2]);assert.deepEqual(await result.refresh,[2]);assert.deepEqual(await store.get(scope,'list'),[2]);
  const offline=new LocalFirstStore(db,()=>false);const cached=await offline.read({scope,resource:'list',fetchRemote:()=>{throw new Error('must not fetch');}});assert.deepEqual(cached.value,[2]);await assert.rejects(cached.refresh,/인터넷/);
  const denied=await store.read({scope,resource:'list',fetchRemote:async()=>{throw Object.assign(new Error('forbidden'),{status:403});}});await assert.rejects(denied.refresh,/forbidden/);assert.equal(await store.get(scope,'list'),undefined);
 }finally{await db.delete();await db.open();}
});

test('local-first create/update/delete commands commit atomically and protect pending projections from stale reads',async()=>{
 const store=new LocalFirstStore(db,()=>true),scope={actorId:'a',projectId:'event'};
 store.register('edit',{offline:'queue',execute:async()=>{},reduce:(rows,p)=>p.remove?rows.filter(r=>r.id!==p.id):[...rows.filter(r=>r.id!==p.id),p]});
 try{
  await store.put(scope,'items',[]);let release;const response=new Promise(resolve=>release=resolve);
  const read=await store.read({scope,resource:'items',fetchRemote:()=>response});
  await store.mutate({scope,resource:'items',operation:'edit',payload:{id:'p',quantity:1}});
  await store.mutate({scope,resource:'items',operation:'edit',payload:{id:'p',quantity:2}});
  release([]);assert.deepEqual(await read.refresh,[{id:'p',quantity:2}]);assert.equal((await store.pending('a')).length,2);
  const fail=()=>{throw new Error('quota');};db.table('resources').hook('updating',fail);
  await assert.rejects(store.mutate({scope,resource:'items',operation:'edit',payload:{id:'p',remove:true}}),/quota/);db.table('resources').hook('updating').unsubscribe(fail);
  assert.equal((await store.pending('a')).length,2);assert.deepEqual(await store.get(scope,'items'),[{id:'p',quantity:2}]);
  await store.mutate({scope,resource:'items',operation:'edit',payload:{id:'p',remove:true}});assert.deepEqual(await store.get(scope,'items'),[]);
  await assert.rejects(store.put(scope,'items',[]),/미동기화/);
 }finally{await db.delete();await db.open();}
});

test('resource replay preserves IDs after uncertain responses, resumes SYNCING, blocks conflicts and ignores another actor',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{locks:{request:async(_name,_options,fn)=>fn({})}}});
 const scope={actorId:'a',projectId:'event'},sent=[];let attempt=0;
 const store=new LocalFirstStore(db,()=>true);
 store.register('edit',{offline:'queue',reduce:(rows,p)=>[...rows,p],execute:async(_scope,_payload,id)=>{sent.push(id);if(attempt++===0)throw new Error('response lost');}});
 try{
  await store.put(scope,'items',[]);const command=await store.mutate({scope,resource:'items',operation:'edit',payload:'p'});
  await store.sync('b');assert.equal(sent.length,0);await store.sync('a');assert.equal((await store.pending('a'))[0].status,'FAILED');
  const row=(await store.pending('a'))[0];await db.table('resourceCommands').update(row.sequence,{status:'SYNCING'});
  await store.sync('a');assert.deepEqual(sent,[command.id,command.id]);assert.equal((await store.pending('a')).length,0);
  store.register('conflict',{offline:'queue',reduce:rows=>rows,execute:async()=>{throw Object.assign(new Error('stale version'),{status:409});}});
  await store.mutate({scope,resource:'items',operation:'conflict',payload:{}});await store.mutate({scope,resource:'items',operation:'edit',payload:'later'});
  await store.sync('a');assert.equal((await store.pending('a'))[0].status,'CONFLICT');await store.sync('a');assert.equal(sent.length,2);
  let current=true,release;await store.put({actorId:'old'},'other',[]);
  const read=await store.read({scope:{actorId:'old'},resource:'other',isCurrent:()=>current,fetchRemote:()=>new Promise(resolve=>release=resolve)});current=false;release(['late']);await assert.rejects(read.refresh,/변경/);assert.deepEqual(await store.get({actorId:'old'},'other'),[]);
 }finally{if(descriptor)Object.defineProperty(globalThis,'navigator',descriptor);else delete globalThis.navigator;await db.delete();await db.open();}
});

test('v3 to v5 upgrade preserves legacy payloads and binds cached state only after owner-confirmed remote reads',async()=>{
  await db.delete();
  const legacy=new Dexie(db.name);
  legacy.version(3).stores({orders:'++id, projectId, [projectId+syncStatus], [projectId+localOrderId], localOrderId, createdAt, syncStatus, retryCount, lastSyncAt',posState:'key, projectId, updatedAt'});
  await legacy.table('orders').add({...order});
  await legacy.table('posState').put({key:'project:a:latest',projectId:'a',updatedAt:'2026-10-15',state:initial});
  legacy.close();
  try {
    await db.open();
    assert.equal(db.verno,5);assert.deepEqual((await orders.getAll('a'))[0].payload,order.payload);
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
