import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {eventSettlementPreview} from '../src/utils/eventSettlement.js';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(waiting=0,mapped=false){
 let cursor=0,ref=0,mounted=false;const states=[],refs=[],effects=[],calls=[],confirmations=[];
 let financial={eventSettlements:[],settlements:[],state:{products:[{id:'p',creatorName:'제작자'}],sales:[{lines:[{type:'product',id:'p',creatorName:'제작자',qty:1,unitPrice:100}]}],bundles:[]}};
 if(mapped)financial.recipientMappings=[{project_id:'e',legacy_creator:'제작자',recipient_id:'recipient-a'}];
 const request=async(url,options)=>{if(!options)return financial;const body=JSON.parse(options.body);calls.push(body);financial={...financial,eventSettlements:[{projectId:'e',version:1,costs:[],closedAt:'2026-10-21',snapshot:eventSettlementPreview(financial.state,[],[]),history:[{action:'close',at:'2026-10-21'}]}]};return {eventSettlement:financial.eventSettlements[0]};};
 const mocks={react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:value=>refs[ref++]||=( {current:value}),useEffect:effect=>{if(!mounted)effects.push(effect);}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'../utils/eventSettlement':{eventSettlementPreview},'../database/orderRepository':{orderRepository:{countWaiting:async()=>waiting}},'../hooks/useUnsavedChanges':{useUnsavedChanges:()=>()=>{}},'../utils/confirmAction':{confirmAction:async message=>{confirmations.push(message);return true;}},'../utils/productDisplay':{won:String},'../utils/revenueSummary':{koreanDay:()=> '2026-10-21'},'./LoadingState':{default:'LoadingState'},'./SettlementEditor':{default:'SettlementEditor'}};
 const context=vm.createContext({crypto:globalThis.crypto});const source=await readFile(new URL('../src/components/EventSettlementPanel.jsx',import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
 const render=()=>{cursor=ref=0;const tree=module.namespace.default({request,projectId:'e',onChange:async()=>{}});mounted=true;return nodes(tree);};
 render();while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));
 return {render,calls,confirmations};
}
test('close UI blocks pending orders before confirmation and never posts a closure',async()=>{
 const h=await harness(1);await h.render().find(n=>n.type==='button'&&n.props.children==='정산 마감').props.onClick();
 assert.equal(h.calls.length,0);assert.equal(h.confirmations.length,0);assert.ok(h.render().some(n=>n.props.role==='alert'&&n.props.children.includes('미동기화')));
});
test('close UI submits the displayed preview and replaces cost editing with payout controls',async()=>{
 const h=await harness();await h.render().find(n=>n.type==='button'&&n.props.children==='정산 마감').props.onClick();
 assert.equal(h.calls[0].action,'closeEventSettlement');assert.equal(JSON.parse(h.calls[0].expectedPreview).net,100);assert.ok(h.confirmations[0].includes('모든 기기'));
 assert.ok(h.render().some(n=>n.type==='button'&&n.props.children==='지급 완료'));assert.ok(!h.render().some(n=>n.type==='button'&&n.props.children==='비용 저장'));
});
test('migrated event payout sends recipient identity without a creator-name write key',async()=>{
 const h=await harness(0,true);await h.render().find(n=>n.type==='button'&&n.props.children==='정산 마감').props.onClick();
 await h.render().find(n=>n.type==='button'&&n.props.children==='지급 완료').props.onClick();
 assert.equal(h.calls[1].action,'addPayment');assert.equal(h.calls[1].recipientId,'recipient-a');assert.equal(Object.hasOwn(h.calls[1],'creator'),false);
});


test('cost entry uses a dialog, adds a table row, supports deletion and submits the cost contract',async()=>{
 const h=await harness();
 const open=()=>h.render().find(n=>n.type==='button'&&n.props.children==='+ 비용 항목 추가').props.onClick();
 const add=async()=>{
  open();let tree=h.render();const dialog=tree.find(n=>n.type==='dialog');
  assert.equal(dialog.props['aria-labelledby'],'event-cost-dialog-title');
  tree.find(n=>n.type==='input'&&n.props.maxLength===80).props.onChange({target:{value:'부스임대료'}});
  tree.find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value:'10'}});
  tree=h.render();tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 };
 await add();let tree=h.render();assert.ok(tree.some(n=>n.type==='td'&&n.props.children==='부스임대료'));
 assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='정산 마감').props.disabled,true);
 tree.find(n=>n.type==='button'&&n.props['aria-label']==='부스임대료 삭제').props.onClick();
 assert.ok(!h.render().some(n=>n.type==='td'&&n.props.children==='부스임대료'));
 await add();await h.render().find(n=>n.type==='button'&&n.props.children==='비용 저장').props.onClick();
 assert.equal(h.calls[0].action,'saveEventCosts');assert.equal(h.calls[0].costs[0].label,'부스임대료');assert.equal(h.calls[0].costs[0].value,10);assert.equal(h.calls[0].costs[0].split,'equal');
});
