import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createApiReadTracker} from '../src/utils/apiReadTracker.js';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('API read indicator remains active until all overlapping reads finish',async()=>{
 const tracker=createApiReadTracker(),first=deferred(),second=deferred(),snapshots=[];
 const unsubscribe=tracker.subscribe(()=>snapshots.push(tracker.getSnapshot()));
 const a=tracker.run('/api/pos',{},()=>first.promise);
 const b=tracker.run('https://example.invalid/api/settlements',{method:'get'},()=>second.promise);
 assert.equal(tracker.getSnapshot(),2);
 second.resolve('second');assert.equal(await b,'second');assert.equal(tracker.getSnapshot(),1);
 first.resolve('first');assert.equal(await a,'first');assert.equal(tracker.getSnapshot(),0);
 assert.deepEqual(snapshots,[1,2,1,0]);
 unsubscribe();await tracker.run('/api/pos',{},()=>1);assert.equal(snapshots.length,4);
});

test('failed, aborted and synchronous read errors always clear the indicator; writes and assets do not show it',async()=>{
 const tracker=createApiReadTracker();
 for(const error of [new Error('network'),Object.assign(new Error('aborted'),{name:'AbortError'})]){
  await assert.rejects(tracker.run('/api/booths',{},()=>Promise.reject(error)),err=>err===error);
  assert.equal(tracker.getSnapshot(),0);
 }
 await assert.rejects(tracker.run('/api/pos',{},()=>{throw new Error('sync');}));
 assert.equal(tracker.getSnapshot(),0);
 for(const [url,options] of [['/api/pos',{method:'POST'}],['/api/pos',{method:'DELETE'}],['/brand/logo.png',{}],['/mobile-updates/latest.json',{}]]){
  const pending=deferred();const result=tracker.run(url,options,()=>pending.promise);
  assert.equal(tracker.getSnapshot(),0);pending.resolve('done');assert.equal(await result,'done');
 }
});

test('shared JSON request tracks response parsing and clears after HTTP failures',async()=>{
 const tracker=createApiReadTracker(),body=deferred();
 const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('async function requestJson('),app.indexOf('\nexport default function App'));
 let ok=true;
 const request=vm.runInNewContext(`(${source.trim()})`,{
  apiReadTracker:tracker,AUTH_TOKEN_KEY:'test-auth',sessionStore:{getItem:()=>null},
  apiContracts:{prepare:(_token,_url,options)=>options,observe(){}},
  fetch:async()=>({ok,status:ok?200:403,json:()=>body.promise}),
 });
 const result=request('/api/booths');await Promise.resolve();
 assert.equal(tracker.getSnapshot(),1);
 body.resolve({events:[]});assert.deepEqual(await result,{events:[]});assert.equal(tracker.getSnapshot(),0);
 ok=false;await assert.rejects(request('/api/booths'),err=>err.status===403);
 assert.equal(tracker.getSnapshot(),0);
});


test('background reads stay silent while overlapping foreground reads keep their indicator',async()=>{
 const tracker=createApiReadTracker(),background=deferred(),foreground=deferred(),snapshots=[];
 tracker.subscribe(()=>snapshots.push(tracker.getSnapshot()));
 const quiet=tracker.run('/api/pos?projectId=event',{background:true},()=>background.promise);
 assert.equal(tracker.getSnapshot(),0);
 const visible=tracker.run('/api/pos?projectId=event',{},()=>foreground.promise);
 background.resolve('updated');assert.equal(await quiet,'updated');assert.equal(tracker.getSnapshot(),1);
 foreground.resolve('loaded');await visible;assert.deepEqual(snapshots,[1,0]);
 await assert.rejects(tracker.run('/api/pos',{background:true},()=>Promise.reject(new Error('network'))));
 assert.equal(tracker.getSnapshot(),0);
});

test('JSON request strips background UI option from fetch while preserving HTTP errors',async()=>{
 const tracker=createApiReadTracker(),app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
 const source=app.slice(app.indexOf('async function requestJson('),app.indexOf('\nexport default function App'));
 let captured;
 const request=vm.runInNewContext(`(${source.trim()})`,{apiReadTracker:tracker,AUTH_TOKEN_KEY:'test-auth',sessionStore:{getItem:()=>null},apiContracts:{prepare:(_token,_url,options)=>options,observe(){}},fetch:async(_url,options)=>{captured=options;assert.equal(tracker.getSnapshot(),0);return {ok:false,status:403,json:async()=>({error:'denied'})};}});
 await assert.rejects(request('/api/pos',{background:true}),error=>error.status===403);
 assert.equal(Object.hasOwn(captured,'background'),false);assert.equal(tracker.getSnapshot(),0);
});
