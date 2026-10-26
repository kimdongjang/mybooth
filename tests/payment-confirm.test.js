import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const nodes=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(){
 const states=[],refs=[],deps=[],effects=[],calls=[];let si=0,ri=0,ei=0;
 const mocks={react:{useState:v=>{const i=si++;if(!(i in states))states[i]=v;return[states[i],v=>states[i]=v];},useRef:v=>refs[ri++]||=( {current:v??{showModal(){},close(){}}} ),useEffect:(fn,d)=>{const i=ei++;if(!deps[i]||d.some((v,j)=>v!==deps[i][j])){deps[i]=d;effects.push(fn);}}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},'../utils/productDisplay':{won:String,productNameWithoutCreator:p=>p.name,creatorNameOf:()=>'',eventCreatorNameOf:()=>''}};
 const context=vm.createContext({});const source=await readFile(new URL('../src/pages/SalesPage.jsx',import.meta.url),'utf8');
 const m=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await m.link(name=>{const ex=mocks[name]||{PageIntro:'intro',PageTabs:'tabs',ItemButton:'item'};return new vm.SyntheticModule(Object.keys(ex),function(){for(const[k,v]of Object.entries(ex))this.setExport(k,v);},{context});});await m.evaluate();
 const props={project:{id:'one'},cart:[{id:'p',type:'product',name:'상품',qty:1,unitPrice:1000}],total:1000,visibleProducts:[],visibleBundles:[],creators:[],purchaseTab:'products',finalizeSale:async method=>calls.push(method)};
 const render=()=>{si=ri=ei=0;const tree=m.namespace.default(props);while(effects.length)effects.shift()();return tree;};render();
 const click=text=>nodes(render()).find(n=>n.type==='button'&&n.props.children===text).props.onClick();
 return{props,render,click,calls};
}
test('cash and transfer require confirmation; cancel and Escape never save',async()=>{
 const h=await harness();h.click('현금 결제');assert.equal(h.calls.length,0);h.click('취소');assert.equal(h.calls.length,0);
 h.click('계좌이체');nodes(h.render()).find(n=>n.type==='dialog').props.onCancel({preventDefault(){}});assert.equal(h.calls.length,0);
 h.click('현금 결제');await h.click('결제하기');assert.deepEqual(h.calls,['cash']);
 h.click('계좌이체');await h.click('결제하기');assert.deepEqual(h.calls,['cash','transfer']);
});
test('double confirmation and stale cart, project or read-only state do not create another order',async()=>{
 const h=await harness();h.click('현금 결제');const confirm=nodes(h.render()).find(n=>n.props?.className==='payment-confirm-ok').props.onClick;
 await Promise.all([confirm(),confirm()]);assert.equal(h.calls.length,1);
 for(const change of [()=>h.props.cart=[...h.props.cart],()=>h.props.project={id:'two'},()=>h.props.readOnly=true]){
 h.click('현금 결제');change();await h.click('결제하기');assert.equal(h.calls.length,1);
 }
});
