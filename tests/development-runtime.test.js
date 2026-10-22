import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { disableDevelopmentServiceWorker } from '../src/platform/developmentServiceWorker.js';
test('development unregisters only the app worker/cache and reloads a controlled page once',async()=>{
 const removed=[],deleted=[],memory=new Map();let reloads=0;
 const options={serviceWorker:{controller:{scriptURL:'http://localhost/sw.js'},getRegistrations:async()=>[{active:{scriptURL:'http://localhost/sw.js'},unregister:async()=>removed.push('app')},{active:{scriptURL:'http://localhost/other.js'},unregister:async()=>removed.push('other')}]},cacheStorage:{keys:async()=>['booth-pos-app-v128','other-cache'],delete:async key=>deleted.push(key)},origin:'http://localhost',storage:{getItem:key=>memory.get(key),setItem:(key,v)=>memory.set(key,v),removeItem:key=>memory.delete(key)},reload:()=>reloads++,now:1000};
 assert.equal(await disableDevelopmentServiceWorker(options),true);assert.deepEqual(removed,['app']);assert.deepEqual(deleted,['booth-pos-app-v128']);assert.equal(reloads,1);
 assert.equal(await disableDevelopmentServiceWorker({...options,now:1100}),false);assert.equal(reloads,1);
 options.serviceWorker.controller=null;assert.equal(await disableDevelopmentServiceWorker(options),false);assert.equal(memory.size,0);
});
test('service worker bypasses Vite modules while retaining production asset and navigation caching',async()=>{
 const handlers={};const self={location:{origin:'http://localhost'},addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL,caches:{open:async()=>({match:async()=>({cached:true})})},fetch:async()=>({ok:false}),Response});
 for(const path of ['/src/App.jsx','/node_modules/.vite/deps/react.js?v=abc','/@vite/client','/@react-refresh','/src/hooks/useUnsavedChanges.js?t=1']){
  let used=false;handlers.fetch({request:{method:'GET',url:'http://localhost'+path},respondWith:()=>used=true});assert.equal(used,false,path);
 }
 let response;handlers.fetch({request:{method:'GET',url:'http://localhost/assets/index-123.js'},respondWith:p=>response=p});assert.deepEqual(await response,{cached:true});
});
