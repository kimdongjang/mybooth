import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
test('payment toast announces completion, expires after four seconds and cancels the old timer on replacement',async()=>{
 let effect,timerId=0;const timers=new Map(),dismissed=[];
 const context=vm.createContext({setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>timers.delete(id)});
 const mocks={react:{useEffect:fn=>{effect=fn;}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}};
 const source=await readFile(new URL('../src/components/PaymentToast.jsx',import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
 const render=notice=>module.namespace.default({notice,onDismiss:value=>dismissed.push(value)});
 let tree=render(null);assert.equal(tree.props.role,'status');effect();assert.equal(timers.size,0);
 tree=render({message:'현금 결제가 완료되었습니다. 1,000원'});const cleanup=effect();assert.equal(timers.get(1).delay,4000);assert.equal(tree.props.children.props.children[0].props.children,'현금 결제가 완료되었습니다. 1,000원');
 cleanup();assert.equal(timers.size,0);tree=render({message:'계좌이체 결제가 완료되었습니다. 0원'});const close=effect();assert.equal(timers.size,1);timers.get(2).callback();assert.deepEqual(dismissed,[null]);
 tree.props.children.props.children[1].props.onClick();assert.deepEqual(dismissed,[null,null]);close();assert.equal(timers.size,0);
});
