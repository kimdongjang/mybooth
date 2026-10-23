import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness({closed=false,waiting=false,uncertain=false}={}) {
 let cursor=0,effectIndex=0,checks=0;const states=[],dependencies=[],effects=[],calls=[];
 const report={policy:{version:0,legacyWritesClosed:closed},ready:true,issues:[],fingerprint:'source',counts:{sales:126}};
 const request=async(url,options)=>{
  if(!options)return url.includes('artists=home')?{booths:[{id:'booth',name:'부스',role:'owner'}]}:report;
  calls.push(JSON.parse(options.body));
  if(uncertain&&calls.length===1)throw new Error('응답 유실');
  return {};
 };
 const beforeClose=async()=>{checks++;if(waiting)throw new Error('미동기화 주문');};
 const mocks={react:{useRef:value=>{const i=cursor++;if(!(i in states))states[i]={current:value};return states[i];},useState:value=>{const i=cursor++;if(!(i in states))states[i]=value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(effect,deps)=>{const i=effectIndex++;if(!dependencies[i]||deps.some((v,j)=>!Object.is(v,dependencies[i][j]))){dependencies[i]=deps;effects.push(effect);}}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
 const context=vm.createContext({crypto:globalThis.crypto});
 const source=await readFile(new URL('../src/components/ContractRetirement.jsx',import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
 const render=()=>{cursor=effectIndex=0;const result=nodes(module.namespace.default({request,beforeClose}));while(effects.length)effects.shift()();return result;};
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 render();await flush();render();await flush();render();
 const setCredentials=()=>{let tree=render();tree.find(n=>n.props.type==='password').props.onChange({target:{value:'current-password'}});tree.find(n=>n.props.type==='checkbox')?.props.onChange({target:{checked:true}});};
 const submit=()=>render().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 return {render,calls,setCredentials,submit,checks:()=>checks};
}
test('retirement checks current-device queue before posting; recovery remains available with waiting orders',async()=>{
 const close=await harness({waiting:true});
 assert.equal(close.render().find(n=>n.type==='button').props.disabled,true);
 close.setCredentials();await close.submit();assert.equal(close.calls.length,0);assert.equal(close.checks(),1);
 assert.ok(close.render().some(n=>n.props.role==='alert'&&n.props.children.includes('미동기화')));
 const recovery=await harness({closed:true,waiting:true});recovery.setCredentials();await recovery.submit();
 assert.equal(recovery.checks(),0);assert.equal(recovery.calls[0].payload.closed,false);
});
test('uncertain retirement retry keeps the exact command and does not reapply the empty-queue gate',async()=>{
 const h=await harness({uncertain:true});h.setCredentials();await h.submit();
 assert.ok(h.render().some(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인'));
 await h.submit();assert.equal(h.checks(),1);assert.equal(h.calls.length,2);
 assert.deepEqual(h.calls[0],h.calls[1]);
});
