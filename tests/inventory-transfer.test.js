import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const nodes = node => !node || typeof node !== 'object' ? [] : [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(storage = new Map(), fail = null) {
  const states=[], refs=[], calls=[], changes=[]; let index,refIndex,effect=false,sequence=0;
  const key='pos_inventory_move:a:source:event';
  const context=vm.createContext({sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=>`request-${++sequence}`}});
  const source=await readFile(new URL('../src/components/InventoryTransferForm.jsx',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context});
  const mocks={react:{useState:initial=>{const i=index++;if(!(i in states))states[i]=initial;return[states[i],value=>states[i]=value];},useRef:initial=>refs[refIndex++]||={current:initial},useEffect:callback=>{if(!effect){effect=true;callback();}}},'./PosUI':{Input:'Input'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
  await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
  const props={adminId:'a',inventoryId:'source',projectId:'event',onInventory:value=>changes.push(value),api:async(action,payload)=>{calls.push({action,payload});if(action==='getEventState')return{dataRevision:'revision'};if(fail)throw Object.assign(new Error('injected'),fail==='network'?{}:{status:409});return{inventory:[{id:'source',stock:4}]};}};
  const render=()=>{index=refIndex=0;return module.namespace.default(props);};render();
  return{render,submit:()=>render().props.onSubmit({preventDefault(){}}),calls,storage,key,changes,props};
}

test('transfer persists its project/revision/request ID and recovers the same command after response loss and reload',async()=>{
  const h=await harness(new Map(),'network');await h.submit();
  const pending=JSON.parse(h.storage.get(h.key));assert.equal(pending.projectId,'event');assert.equal(pending.inventoryId,'source');assert.equal(pending.dataRevision,'revision');
  assert.equal(nodes(h.render()).find(node=>node.type==='Input').props.disabled,true);
  const recovered=await harness(h.storage);await recovered.submit();
  assert.equal(recovered.calls.some(call=>call.action==='getEventState'),false);
  assert.deepEqual(JSON.parse(JSON.stringify(recovered.calls[0].payload)),pending);
  assert.equal(h.storage.has(h.key),false);assert.equal(recovered.changes.length,1);
});

test('transfer rejects invalid quantities and preserves damaged pending metadata without sending a command',async()=>{
  const h=await harness();nodes(h.render()).find(node=>node.type==='Input').props.onChange('0');await h.submit();assert.equal(h.calls.length,0);
  const storage=new Map([[h.key,'{damaged']]);const damaged=await harness(storage);await damaged.submit();assert.equal(damaged.calls.length,0);assert.equal(storage.get(h.key),'{damaged');
});

test('a definitive rejected transfer clears the pending command for a corrected new request',async()=>{
  const h=await harness(new Map(),'conflict');await h.submit();assert.equal(h.storage.has(h.key),false);assert.ok(nodes(h.render()).find(node=>node.props?.role==='alert'));
});
