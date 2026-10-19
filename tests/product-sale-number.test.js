import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(){
 const state=[],refs=[],calls=[];let i,r,effect=false;
 const context=vm.createContext({});
 const source=await readFile(new URL('../src/components/ProductSaleNumberForm.jsx',import.meta.url),'utf8');
 const mod=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText,{context});
 const mocks={react:{useState:initial=>{const n=i++;if(!(n in state))state[n]=initial;return[state[n],value=>state[n]=typeof value==='function'?value(state[n]):value];},useRef:initial=>refs[r++]||={current:initial},useEffect:callback=>{if(!effect){effect=true;callback();}}},'./PosUI':{Input:'Input'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
 await mod.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await mod.evaluate();
 const props={product:{id:'a',name:'상품',saleNumber:1},order:['a','b','c'],onSave:async payload=>{calls.push(payload);return true;}};
 const render=()=>{i=r=0;return mod.namespace.default(props);};render();
 return{render,calls,props,change:value=>nodes(render()).find(node=>node.type==='Input').props.onChange(value),submit:()=>render().props.onSubmit({preventDefault(){}})};
}

test('sale-number editor submits the target product and full baseline order only on explicit apply',async()=>{
 const h=await harness();h.change('3');assert.equal(h.calls.length,0);await h.submit();
 assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0])),{productId:'a',saleNumber:3,expectedOrder:['a','b','c']});
 for(const value of ['','0','1.5','4']){h.change(value);await h.submit();}
 assert.equal(h.calls.length,1);assert.ok(nodes(h.render()).find(node=>node.props?.role==='alert'));
 h.change('2');h.props.disabled=true;await h.submit();assert.equal(h.calls.length,1);
});

test('sale-number ordering is numeric, deterministic, and places legacy unnumbered products last',async()=>{
 const source=await readFile(new URL('../src/utils/productDisplay.js',import.meta.url),'utf8');
 const mod=new vm.SourceTextModule(source);await mod.link(()=>{});await mod.evaluate();
 const products=[{id:'ten',saleNumber:10},{id:'legacy'},{id:'two',saleNumber:2},{id:'one',saleNumber:1}];
 products.sort(mod.namespace.compareProductSaleNumber);
 assert.deepEqual(products.map(p=>p.id),['one','two','ten','legacy']);
});
