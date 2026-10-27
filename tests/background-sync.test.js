import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
import {createBackgroundSync, SYNC_INTERVAL_MS} from '../src/sync/backgroundSync.js';

const deferred=()=>{let resolve;const promise=new Promise(yes=>resolve=yes);return {promise,resolve};};

test('background cycle uploads before reading and coalesces overlapping reconnect/manual calls',async()=>{
  const gate=deferred(),calls=[];
  const run=createBackgroundSync({online:()=>true,upload:async()=>{calls.push('upload');await gate.promise;return {pendingCount:0};},refresh:async()=>{calls.push('read');}});
  const first=run();const second=run({force:true});
  assert.equal(first,second);assert.deepEqual(calls,['upload']);
  gate.resolve();await first;assert.deepEqual(calls,['upload','read']);
});

test('failed uploads preserve the projection, back off and allow immediate manual/reconnect retry',async()=>{
  let clock=0,attempts=0,reads=0;
  const run=createBackgroundSync({now:()=>clock,online:()=>true,upload:async()=>{attempts++;return {pendingCount:1};},refresh:async()=>{reads++;}});
  await run();assert.equal(reads,0);
  clock=SYNC_INTERVAL_MS;await run();assert.equal(attempts,2);
  clock+=SYNC_INTERVAL_MS;await run();assert.equal(attempts,2);
  await run({force:true});assert.equal(attempts,3);
});

test('offline and obsolete scopes do not fetch; switching during upload cannot refresh the new scope',async()=>{
  let active=true,online=false,uploads=0,reads=0;const gate=deferred();
  const run=createBackgroundSync({online:()=>online,isCurrent:()=>active,upload:async()=>{uploads++;await gate.promise;},refresh:async()=>{reads++;}});
  await run();assert.equal(uploads,0);
  online=true;const pending=run();active=false;gate.resolve();await pending;
  assert.equal(reads,0);await run({force:true});assert.equal(uploads,1);
});

test('read failure backs off and a successful cycle resets the delay',async()=>{
  let clock=0,reads=0,ok=false;
  const run=createBackgroundSync({online:()=>true,now:()=>clock,upload:async()=>null,refresh:async()=>{reads++;return ok;}});
  await run();await run();assert.equal(reads,1);
  clock=SYNC_INTERVAL_MS;ok=true;await run();await run();assert.equal(reads,3);
});

async function eventReader({cached=null,remote=async()=>({products:[]})}={}) {
  const source=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  const code=source.slice(source.indexOf('  const loadState ='),source.indexOf('  const loadProjects ='));
  const applied=[],loading=[],requests=[];
  const context=vm.createContext({Map,AbortSignal,scope:'scope-a',token:'token-a',adminId:'actor-a',
    selectedProject:{id:'event-a',boothId:'booth-a'},stateReads:{current:new Map()},activeScope:{current:'scope-a'},
    activeToken:{current:'token-a'},navigator:{onLine:true},
    stateRepository:{getForActor:async()=>cached,queueVersion:async()=>'queue-v1'},
    orderRepository:{countWaiting:async()=>0},
    applyState:async(...args)=>applied.push(args),setLoading:value=>loading.push(value),setError:()=>{},
    setReadyScope:()=>{},setProducts:()=>{},setBundles:()=>{},setSales:()=>{},setCart:()=>{},logout:()=>{},
    requestJson:async(...args)=>{requests.push(args);return remote();},
  });
  vm.runInContext(`${code}\nglobalThis.read=loadState;`,context);
  return {context,applied,loading,requests,read:context.read};
}

test('event entry renders the actor/booth cache without a GET; periodic refresh uses background reads',async()=>{
  const cached={actorId:'actor-a',boothId:'booth-a',products:[{stock:4}],sales:[{id:'local'}]};
  const h=await eventReader({cached});
  await h.read();assert.equal(h.requests.length,0);assert.equal(h.applied[0][0],cached);assert.equal(h.applied[0][1],true);
  assert.equal(h.loading.at(-1),false);
  await h.read({background:true});assert.equal(h.requests.length,1);assert.equal(h.requests[0][1].background,true);
});

test('uncached event reads coalesce and an old scope response cannot replace the new event',async()=>{
  const gate=deferred();const h=await eventReader({remote:()=>gate.promise});
  const first=h.read();const second=h.read({background:true});assert.equal(first,second);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.requests.length,1);
  h.context.activeScope.current='scope-b';gate.resolve({products:[]});await first;
  assert.equal(h.applied.length,0);assert.equal(h.context.stateReads.current.size,0);
});

test('a cache from a different booth is not accepted on entry',async()=>{
  const h=await eventReader({cached:{actorId:'actor-a',boothId:'booth-other',products:[]}});
  await h.read();assert.equal(h.requests.length,1);assert.equal(h.applied[0][1],false);
});

test('sync hook waits 30 seconds, pauses hidden polling, resumes immediately and cleans up',async()=>{
  const effects=[],timers=[],windowEvents=new Map(),documentEvents=new Map(),calls=[];
  const document={hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn),removeEventListener:name=>documentEvents.delete(name)};
  let network;
  const mocks={
    react:{useCallback:fn=>fn,useRef:value=>({current:value}),useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn)},
    '../sync/syncService':{syncService:{configure:()=>{},subscribe:()=>()=>{},sync:async()=>{calls.push('upload');return {pendingCount:0};},refreshPendingCount:async()=>{}}},
    '../sync/network':{isOnline:()=>true,subscribeNetwork:fn=>{network=fn;return()=>{network=null;};}},
    '../sync/backgroundSync':{createBackgroundSync,SYNC_INTERVAL_MS},
  };
  const context=vm.createContext({document,window:{setInterval:(fn,ms)=>{timers.push({fn,ms});return 1;},clearInterval:id=>calls.push(`clear:${id}`)}});
  const source=await readFile(new URL('../src/hooks/useSync.ts',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context});
  await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[key,value]of Object.entries(mocks[name]))this.setExport(key,value);},{context}));await module.evaluate();
  const hook=module.namespace.useSync({enabled:true,projectId:'event-a',actorId:'actor-a',boothId:'booth-a',getAuthToken:()=> 'token',onRefresh:async()=>{calls.push('read');}});
  const cleanup=effects.map(fn=>fn()).filter(fn=>typeof fn==='function');
  assert.deepEqual(calls,[]);assert.equal(timers.length,1);assert.equal(timers[0].ms,30_000);
  document.hidden=true;timers[0].fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,[]);
  document.hidden=false;timers[0].fn();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls,['upload','read']);
  network(true);await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(calls.slice(-2),['upload','read']);
  await hook.syncNow();assert.equal(calls.length,6);
  documentEvents.get('visibilitychange')();await new Promise(resolve=>setImmediate(resolve));assert.equal(calls.length,8);
  cleanup.forEach(fn=>fn());assert.equal(documentEvents.size,0);assert.equal(network,null);
  await hook.syncNow();assert.equal(calls.at(-1),'clear:1');
});
