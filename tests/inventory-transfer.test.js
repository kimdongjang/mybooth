import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const nodes = node => !node || typeof node !== 'object' ? [] : [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const key='pos_inventory_move:a:source:event';
const request={inventoryId:'source',projectId:'event',direction:'allocate',qty:2,requestId:'original-request',dataRevision:'revision'};
async function harness(component,props,storage=new Map()) {
  const states=[],effects=[];let index,effect=false;
  const context=vm.createContext({sessionStorage:{get length(){return storage.size;},key:i=>[...storage.keys()][i],getItem:k=>storage.get(k)||null,removeItem:k=>storage.delete(k)}});
  const source=await readFile(new URL(`../src/components/${component}.jsx`,import.meta.url),'utf8');
  const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context});
  const mocks={ './LoadingState':{default:'LoadingState'}, './StockMovementForm':{default:'StockMovementForm'},react:{useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=typeof value==='function'?value(states[i]):value];},useEffect:callback=>{if(!effect){effect=true;effects.push(callback);}}},'./PosUI':{Quantity:'Quantity'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
  await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
  const render=()=>{index=0;const tree=module.namespace.default(props);while(effects.length)effects.shift()();return tree;};render();await Promise.resolve();await Promise.resolve();
  return {render,storage};
}

test('event inventory shows four read-only counts in the allocation detail without duplicate links or transfer controls',async()=>{
 const h=await harness('EventInventoryControls',{adminId:'a',projectId:'event',product:{id:'p',inventoryId:'source'},api:async()=>({inventory:[{id:'source',totalStock:1000,allocations:[{project_id:'event',product_id:'p',initial_stock:100,stock:97}],history:[{projectId:'event',productId:'p',soldQty:3}]}]})});
 const tree=h.render(); const counts=nodes(tree).filter(node=>node.type==='Quantity').map(node=>[node.props.label,node.props.value]);
 assert.deepEqual(counts,[['총재고',1000],['행사 배정 수량',100],['판매 수량',3],['남은 수량',97]]);
 assert.equal(nodes(tree).some(node=>node.type==='form'||node.type==='input'||node.type==='select'),false);
 assert.equal(nodes(tree).some(node=>node.type==='a'),false);
 assert.ok(nodes(tree).find(node=>node.props?.children==='행사 배정 재고 상세'));
 assert.ok(nodes(tree).find(node=>node.props?.className==='product-stock-grid event-inventory-grid'));
});

test('recovery only replays the exact stored request and keeps network-uncertain data across reload',async()=>{
 const storage=new Map([[key,JSON.stringify(request)]]),calls=[],blocked=[];
 const h=await harness('InventoryTransferRecovery',{adminId:'a',onBlocked:v=>blocked.push(v),onInventory(){},api:async(action,payload)=>{calls.push({action,payload});throw new Error('network');}},storage);
 await nodes(h.render()).find(node=>node.type==='button').props.onClick();
 assert.equal(storage.has(key),true); assert.equal(blocked.at(-1),true);
 const changes=[];
 const next=await harness('InventoryTransferRecovery',{adminId:'a',onBlocked:v=>blocked.push(v),onInventory:v=>changes.push(v),api:async(action,payload)=>{calls.push({action,payload});return{inventory:[{id:'source'}]};}},storage);
 await nodes(next.render()).find(node=>node.type==='button').props.onClick();
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].payload)),request);assert.equal(calls.every(call=>call.action==='transferInventory'),true);
 assert.equal(storage.size,0);assert.equal(blocked.at(-1),false);assert.equal(changes.length,1);
 assert.equal(nodes(next.render()).some(node=>node.type==='button'),false);
});

test('recovery preserves damaged storage, ignores other accounts, and releases definitive rejected requests',async()=>{
 const blocked=[],storage=new Map([[key,'{damaged'],['pos_inventory_move:b:source:event',JSON.stringify(request)]]);
 const damaged=await harness('InventoryTransferRecovery',{adminId:'a',onBlocked:v=>blocked.push(v),api:async()=>{throw new Error('must not send');}},storage);
 assert.equal(storage.get(key),'{damaged');assert.equal(blocked.at(-1),true);assert.ok(nodes(damaged.render()).find(node=>node.props?.role==='alert'));
 assert.equal(nodes(damaged.render()).some(node=>node.type==='button'),false);
 storage.set(key,JSON.stringify(request));
 const conflict=await harness('InventoryTransferRecovery',{adminId:'a',onBlocked:v=>blocked.push(v),api:async()=>{throw Object.assign(new Error('conflict'),{status:409});}},storage);
 await nodes(conflict.render()).find(node=>node.type==='button').props.onClick();
 assert.equal(storage.has(key),false);assert.equal(storage.size,1);assert.equal(blocked.at(-1),false);
});
