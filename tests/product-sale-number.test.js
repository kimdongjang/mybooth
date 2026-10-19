import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

async function harness(){
 const state=[],refs=[],dependencies=[],effects=[],frames=new Map(),listeners=new Map(),calls=[];let i,r,e,frameId=0,hit='a',fail=false;
 const container={scrollTop:0,getBoundingClientRect:()=>({top:0,bottom:500})};
 const button={closest:selector=>selector==='table'?{contains:row=>row.inside!==false}:container,focus(){},setPointerCapture(){},hasPointerCapture:()=>false};
 const context=vm.createContext({window:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},document:{elementFromPoint:()=>hit===null?null:{closest:()=>({dataset:{productRow:hit},inside:hit!=='foreign'})},querySelector:()=>({scrollIntoView(){}})},requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id)});
 const mod=new vm.SourceTextModule(await readFile(new URL('../src/hooks/useProductReorder.js',import.meta.url),'utf8'),{context});
 await mod.link(()=>new vm.SyntheticModule(['useState','useRef','useEffect'],function(){
  this.setExport('useState',initial=>{const n=i++;if(!(n in state))state[n]=initial;return[state[n],next=>state[n]=typeof next==='function'?next(state[n]):next];});
  this.setExport('useRef',initial=>refs[r++]||={current:initial});
  this.setExport('useEffect',(fn,deps)=>{const n=e++;if(!dependencies[n]||deps.some((value,j)=>value!==dependencies[n][j])){dependencies[n]=deps;effects.push(fn);}});
 },{context}));await mod.evaluate();
 const props={products:[{id:'a',name:'A'},{id:'b',name:'B'},{id:'c',name:'C'}],disabled:false,onSave:async payload=>{calls.push(payload);if(fail)throw new Error('stale order');return true;}};
 const render=()=>{i=r=e=0;const result=mod.namespace.useProductReorder(props);while(effects.length)effects.shift()();return result;};render();
 const pointer=(overrides={})=>({button:0,isPrimary:true,pointerId:1,clientX:100,clientY:200,currentTarget:button,preventDefault(){},...overrides});
 const key=value=>({key:value,preventDefault(){}});
 return {props,calls,render,pointer,key,container,frames,listeners,hit:value=>{hit=value;},fail:value=>{fail=value;},tick:()=>{const next=frames.entries().next().value;if(next){frames.delete(next[0]);next[1]();}}};
}

test('grab handle saves once on drop using immutable baseline order; pointer cancellation and outside drops never save',async()=>{
 const h=await harness();let api=h.render();api.handleProps(h.props.products[0]).onPointerDown(h.pointer());
 h.hit('c');api=h.render();api.handleProps(h.props.products[0]).onPointerMove(h.pointer());assert.equal(h.calls.length,0);
 assert.equal(h.render().state.to,2);
 await h.render().handleProps(h.props.products[0]).onPointerUp(h.pointer());
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{productId:'a',saleNumber:3,expectedOrder:['a','b','c']});
 await h.render().handleProps(h.props.products[0]).onPointerUp(h.pointer());assert.equal(h.calls.length,1);assert.equal(h.frames.size,0);
 h.hit('b');h.render().handleProps(h.props.products[0]).onPointerDown(h.pointer());h.render().handleProps(h.props.products[0]).onPointerCancel();assert.equal(h.render().state,null);
 h.render().handleProps(h.props.products[0]).onPointerDown(h.pointer());h.hit('foreign');await h.render().handleProps(h.props.products[0]).onPointerUp(h.pointer());assert.equal(h.calls.length,1);
});

test('touch pointer edge scrolling, keyboard move/drop, Escape and stale-list/read-only cancellation preserve scope',async()=>{
 const h=await harness();const a=h.props.products[0];
 h.render().handleProps(a).onPointerDown(h.pointer({clientY:490,pointerType:'touch'}));h.hit('b');h.tick();assert.equal(h.container.scrollTop,12);
 h.render().handleProps(a).onPointerCancel();
 h.render().handleProps(a).onKeyDown(h.key('Enter'));h.render().handleProps(a).onKeyDown(h.key('ArrowDown'));await h.render().handleProps(a).onKeyDown(h.key('Enter'));
 assert.equal(h.calls[0].saleNumber,2);
 h.render().handleProps(a).onKeyDown(h.key(' '));h.render().handleProps(a).onKeyDown(h.key('End'));h.render().handleProps(a).onKeyDown(h.key('Escape'));assert.equal(h.calls.length,1);
 h.render().handleProps(a).onPointerDown(h.pointer());h.props.products=[...h.props.products].reverse();h.render();await h.render().handleProps(a).onPointerUp(h.pointer());assert.equal(h.calls.length,1);
 h.props.disabled=true;h.render().handleProps(a).onPointerDown(h.pointer());assert.equal(h.render().state,null);
});

test('failed save keeps the original product order and reports the error',async()=>{
 const h=await harness();h.fail(true);const a=h.props.products[0];
 h.render().handleProps(a).onKeyDown(h.key('Enter'));h.render().handleProps(a).onKeyDown(h.key('End'));await h.render().handleProps(a).onKeyDown(h.key('Enter'));
 assert.deepEqual(h.props.products.map(p=>p.id),['a','b','c']);assert.equal(h.render().message,'stale order');assert.equal(h.render().busy,false);
});

test('sale-number ordering remains numeric with legacy unnumbered products last',async()=>{
 const source=await readFile(new URL('../src/utils/productDisplay.js',import.meta.url),'utf8');const mod=new vm.SourceTextModule(source);await mod.link(()=>{});await mod.evaluate();
 const products=[{id:'ten',saleNumber:10},{id:'legacy'},{id:'two',saleNumber:2},{id:'one',saleNumber:1}];products.sort(mod.namespace.compareProductSaleNumber);assert.deepEqual(products.map(p=>p.id),['one','two','ten','legacy']);
});

test('window blur cancels a grab and a pending save blocks another grab',async()=>{
 const h=await harness();const a=h.props.products[0];
 h.render().handleProps(a).onPointerDown(h.pointer());h.listeners.get('blur')();assert.equal(h.render().state,null);assert.equal(h.calls.length,0);
 let resolveSave;h.props.onSave=payload=>{h.calls.push(payload);return new Promise(resolve=>{resolveSave=resolve;});};
 h.render().handleProps(a).onKeyDown(h.key('Enter'));h.render().handleProps(a).onKeyDown(h.key('End'));
 const saving=h.render().handleProps(a).onKeyDown(h.key('Enter'));
 assert.equal(h.render().busy,true);h.render().handleProps(a).onPointerDown(h.pointer());assert.equal(h.render().state,null);assert.equal(h.calls.length,1);
 resolveSave(true);await saving;assert.equal(h.render().busy,false);
});
