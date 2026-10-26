import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
const nodes=n=>!n||typeof n!=='object'?[]:[n,...[n.props?.children].flat(Infinity).flatMap(nodes)];
async function harness({review=false,parseError=false,networkError=false}={}){
 const states=[],refs=[],deps=[],effects=[],calls=[],navigations=[],registered=[];let cursor=0,ref=0,effect=0,firstFailure=networkError;
 const product={id:'original-id',name:'무료 상품',stock:2,price:0,cost:0,version:-1};
 const props={adminId:'a',review,navigate:async(path,replace)=>{navigations.push([path,replace]);props.review=path==='/inventory/import/review';},onRegistered:data=>registered.push(data),api:async(action,payload)=>{calls.push({action,payload});if(firstFailure){firstFailure=false;throw Object.assign(new Error('응답 유실'),{status:500});}return {inventory:[{...product,version:0}]};}};
 const mocks={react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return [states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:value=>refs[ref++]||={current:value},useEffect:(fn,next)=>{const i=effect++;if(!deps[i]||next.some((v,j)=>v!==deps[i][j])){deps[i]=next;effects.push(fn);}}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'../utils/productWorkbook':{columns:[['name','상품명'],['stock','재고'],['price','판매가'],['cost','원가']],exampleWorkbook:()=>new Uint8Array(),readProducts:async()=>{if(parseError)throw new Error('잘못된 엑셀');return [{...product}];}},'../utils/productImage':{prepareProductImage:async f=>f},'../utils/uploadProductImage':{uploadInventoryImage:async()=>({url:'image'})},'../hooks/useUnsavedChanges':{useUnsavedChanges:()=>()=>{}}};
 const context=vm.createContext({});const source=await readFile(new URL('../src/pages/InventoryImport.jsx',import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
 const render=()=>{cursor=ref=effect=0;const tree=nodes(module.namespace.default(props));while(effects.length)effects.shift()();return tree;};
 const upload=async()=>{render().find(n=>n.type==='input'&&n.props.accept==='.xlsx').props.onChange({target:{files:[{name:'products.xlsx'}],value:'file'}});await new Promise(resolve=>setImmediate(resolve));};
 render();return {render,upload,props,calls,navigations,registered};
}
test('upload page has an always-visible guide, no editor/registration button; parsing moves to review without API writes',async()=>{
 const h=await harness();const initial=h.render();
 assert.ok(initial.some(n=>n.type==='h2'&&n.props.children==='예시 엑셀 작성 가이드'));
 assert.ok(!initial.some(n=>n.type==='details'));
 assert.ok(!initial.some(n=>n.type==='button'&&n.props.children==='일괄 등록'));
 assert.ok(!initial.some(n=>n.props['aria-label']==='상품 일괄 등록 편집 표'));
 await h.upload();assert.equal(h.navigations[0][0],'/inventory/import/review');assert.equal(h.calls.length,0);
 const review=h.render();assert.ok(review.some(n=>n.props['aria-label']==='상품 일괄 등록 편집 표'));
 review.find(n=>n.props['aria-label']==='1행 상품명').props.onChange({target:{value:'수정한 상품'}});
 await h.render().find(n=>n.type==='button'&&n.props.children==='일괄 등록').props.onClick();
 assert.equal(h.calls[0].payload.products[0].name,'수정한 상품');assert.equal(h.calls[0].payload.products[0].price,0);assert.equal(h.registered.length,1);assert.equal(h.navigations.at(-1)[0],'inventory');
});
test('invalid files remain on upload; a direct review link without draft returns to upload',async()=>{
 const invalid=await harness({parseError:true});await invalid.upload();assert.equal(invalid.navigations.length,0);assert.equal(invalid.calls.length,0);assert.ok(invalid.render().some(n=>n.props.role==='alert'));
 const direct=await harness({review:true});assert.equal(direct.navigations[0][0],'/inventory/import');assert.equal(direct.navigations[0][1],true);
});
test('review retries the unchanged batch after a lost response and keeps edit controls locked',async()=>{
 const h=await harness({networkError:true});await h.upload();await h.render().find(n=>n.type==='button'&&n.props.children==='일괄 등록').props.onClick();
 assert.equal(h.render().find(n=>n.props['aria-label']==='1행 상품명').props.disabled,true);
 await h.render().find(n=>n.type==='button'&&n.props.children==='이전 등록 재확인').props.onClick();
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].payload,h.calls[1].payload);assert.equal(h.calls[1].payload.products[0].id,'original-id');
});

test('a definitive rejection after an uncertain retry unlocks editing for correction',async()=>{
 const h=await harness({networkError:true});await h.upload();await h.render().find(n=>n.type==='button'&&n.props.children==='일괄 등록').props.onClick();
 h.props.api=async()=>{throw Object.assign(new Error('수량을 수정해주세요.'),{status:400});};
 await h.render().find(n=>n.type==='button'&&n.props.children==='이전 등록 재확인').props.onClick();
 assert.equal(h.render().find(n=>n.props['aria-label']==='1행 상품명').props.disabled,false);
});
