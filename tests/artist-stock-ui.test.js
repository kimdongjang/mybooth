import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness() {
  let cursor=0,effectIndex=0;const states=[],dependencies=[],effects=[],calls=[];
  const data={inventory:[],events:[],participations:[]};
  const request=async(url,options)=>{
    if(!options)return url.includes('artists=home')?{profiles:[{owner_id:'owner',display_name:'작가'}],booths:[]}:data;
    calls.push(JSON.parse(options.body));
    if(calls.length===1)throw new Error('응답 유실');
    return {inventory:{allocations:[]}};
  };
  const mocks={react:{useId:()=> 'stock-total-form',useRef:value=>{const i=cursor++;if(!(i in states))states[i]={current:value};return states[i];},useState:value=>{const i=cursor++;if(!(i in states))states[i]=value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(effect,deps)=>{const i=effectIndex++;if(!dependencies[i]||deps.some((v,j)=>!Object.is(v,dependencies[i][j]))){dependencies[i]=deps;effects.push(effect);}}},
    'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'../components/PosUI':{Input:'Input'}};
  const context=vm.createContext({crypto:globalThis.crypto});
  const source=await readFile(new URL('../src/pages/ArtistStockPage.jsx',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
  await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
  const render=(props=null)=>{cursor=effectIndex=0;const tree=props?module.namespace.StockItem(props):module.namespace.default({request});while(effects.length)effects.shift()();return nodes(tree);};
  return {render,renderAllocation:props=>{cursor=effectIndex=0;return nodes(module.namespace.AllocationQuantity(props));},calls,flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

test('event day disables artist allocation and price inputs while keeping own unassigned totals editable; operator can edit',async()=>{
  const item={id:'s',version:1,name:'상품',price:100,totalStock:20,remaining:20,warehouse:0,totalReceived:20,
    allocations:[{projectId:'e',initial:20,remaining:20,sold:0,price:70}]};
  const artist=await harness();
  const props={item,events:[{id:'e',name:'행사',operator:false,artistEditable:false}],busy:false};
  const tree=artist.render({...props,eventOnly:true});
  assert.equal(tree.find(n=>n.type==='Input'&&n.props.value==='70').props.disabled,true);
  assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='행사 재고 저장').props.disabled,true);
  const own=await harness();const personal=own.render(props);assert.equal(personal.find(n=>n.type==='button'&&n.props.children==='저장').props.disabled,false);assert.equal(personal.some(n=>n.props.children==='변경 사유'),false);assert.equal(personal.some(n=>n.props.children==='차감 기록'),false);
  const operator=await harness();
  assert.equal(operator.render({...props,eventOnly:true,events:[{id:'e',name:'행사',operator:true,artistEditable:false}]}).find(n=>n.type==='button'&&n.props.children==='행사 재고 저장').props.disabled,false);
});

test('uncertain shared stock submission freezes editing and retries the same command ID and content',async()=>{
  const h=await harness();h.render();await h.flush();h.render();await h.flush();
  let tree=h.render();
  tree.find(n=>n.type==='Input'&&n.props.maxLength===100).props.onChange('새 상품');
  tree=h.render();
  const form=tree.find(n=>n.type==='form'&&nodes(n).some(child=>child.type==='button'&&child.props.children==='상품 등록'));
  form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await h.flush();assert.equal(h.calls.length,1);
  tree=h.render();assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='상품 등록').props.disabled,true);
  await tree.find(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인').props.onClick();
  assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0],h.calls[1]);assert.match(h.calls[0].payload.requestId,/^[a-f0-9-]{36}$/);
  assert.equal(h.render().find(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인'),undefined);
});

test('personal inventory header saves the single total field with receipt for increases and correction for decreases',async()=>{
 const h=await harness(),changes=[];
 const props={item:{id:'s',name:'상품',price:100,totalStock:10,warehouse:2,minimumTotalStock:8,allocations:[]},events:[],busy:false,onAdjust:(item,value)=>changes.push(value)};
 let tree=h.render(props);assert.equal(tree.filter(n=>n.type==='Input').length,1);
 assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='저장').props.form,'stock-total-form');
 tree.find(n=>n.type==='Input').props.onChange('12');tree=h.render(props);tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(changes[0].reason,'receipt');assert.equal(changes[0].totalStock,12);
 tree.find(n=>n.type==='Input').props.onChange('8');tree=h.render(props);tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(changes[1].reason,'correction');assert.equal(changes[1].totalStock,8);
});


test('allocation edit preserves consumed stock, limits increases to warehouse and submits the event identity on blur',async()=>{
 const h=await harness(),saved=[];
 const props={item:{id:'s',version:1,warehouse:3,price:100},event:{id:'e',name:'행사',operator:true},allocation:{initial:10,remaining:6,price:0},onAllocate:async(item,value)=>{saved.push(value);return {ok:true};}};
 let tree=h.renderAllocation(props),input=tree[0];assert.equal(input.props.min,4);assert.equal(input.props.max,13);
 input.props.onChange('12');tree=h.renderAllocation(props);await tree[0].props.onBlur({target:{checkValidity:()=>true}});
 assert.equal(saved[0].quantity,12);assert.equal(saved[0].projectId,'e');assert.equal(saved[0].price,0);
 tree[0].props.onChange('3');tree=h.renderAllocation(props);let invalid=false;await tree[0].props.onBlur({target:{checkValidity:()=>false,reportValidity:()=>{invalid=true;}}});assert.equal(invalid,true);assert.equal(saved.length,1);
 assert.equal(h.renderAllocation({...props,event:{...props.event,operator:false}})[0].props.disabled,true);
});
