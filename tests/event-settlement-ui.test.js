import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {eventSettlementPreview,validateEventCosts,recipientSettled,settlementPhaseLabel,recipientSettlementLabel} from '../src/utils/eventSettlement.js';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(waiting=0,mapped=false,failPayment=false,failCost=false,saleAmount=100){
 let cursor=0,ref=0,mounted=false;const states=[],refs=[],effects=[],calls=[],confirmations=[];
 let financial={eventSettlements:[],settlements:[],state:{products:[{id:'p',creatorName:'제작자'}],sales:[{lines:[{type:'product',id:'p',creatorName:'제작자',qty:1,unitPrice:saleAmount}]}],bundles:[]}};
 if(mapped)financial.recipientMappings=[{project_id:'e',legacy_creator:'제작자',recipient_id:'recipient-a'}];
 const request=async(url,options)=>{if(!options)return financial;const body=JSON.parse(options.body);calls.push(body);if(['addPayment','completeRecipientSettlement'].includes(body.action)){
  if(failPayment && body.action==='addPayment'){failPayment=false;throw new Error('응답 유실');}
  const settlement={projectId:'e',creator:'제작자',version:body.version+1,payments:[...(financial.settlements[0]?.payments||[]),{id:body.requestId,amount:body.action==='completeRecipientSettlement'?saleAmount-(financial.settlements[0]?.payments||[]).reduce((s,p)=>s+p.amount,0):body.amount,settlementComplete:body.action==='completeRecipientSettlement'}],deductions:[]};
  financial={...financial,settlements:[settlement]};return {settlement};
 }
 const current=financial.eventSettlements[0]||{projectId:'e',version:0,costs:[],history:[]};
 const updated={...current,version:current.version+1};
 if(body.action==='saveEventCosts'){if(failCost){failCost=false;throw new Error('비용 응답 유실');}updated.costs=body.costs;}
 if(body.action==='closeEventSettlement')Object.assign(updated,{closedAt:'2026-10-21',snapshot:eventSettlementPreview(financial.state,current.costs,[]),history:[{action:'close',at:'2026-10-21'}]});
 if(body.action==='finishEventSettlement')updated.finishedAt='2026-10-22';
 if(body.action==='resumeEventSettlement')updated.finishedAt=null;
 financial={...financial,eventSettlements:[updated]};return {eventSettlement:updated};};
 const mocks={'react-dom':{createPortal:node=>node},'../hooks/useEventReadRefresh':{useEventReadRefresh:()=>0},react:{useState:initial=>{const i=cursor++;if(!(i in states))states[i]=initial;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},useRef:value=>refs[ref++]||=( {current:value}),useEffect:effect=>{if(!mounted)effects.push(effect);}},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'../utils/eventSettlement':{eventSettlementPreview,validateEventCosts,recipientSettled,settlementPhaseLabel,recipientSettlementLabel},'../database/orderRepository':{orderRepository:{countWaiting:async()=>waiting}},'../hooks/useUnsavedChanges':{useUnsavedChanges:()=>()=>{}},'../utils/confirmAction':{confirmAction:async message=>{confirmations.push(message);return true;}},'../utils/productDisplay':{won:String},'../utils/revenueSummary':{koreanDay:()=> '2026-10-21'},'./LoadingState':{default:'LoadingState'},'./SettlementEditor':{default:'SettlementEditor'}};
 const context=vm.createContext({crypto:globalThis.crypto,document:{body:{}}});const source=await readFile(new URL('../src/components/EventSettlementPanel.jsx',import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>new vm.SyntheticModule(Object.keys(mocks[name]),function(){for(const[k,v]of Object.entries(mocks[name]))this.setExport(k,v);},{context}));await module.evaluate();
 const render=()=>{cursor=ref=0;const tree=module.namespace.default({request,projectId:'e',onChange:async()=>{}});mounted=true;return nodes(tree);};
 render();while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));
 return {render,calls,confirmations};
}
async function closeWithPassword(h,password='test-password'){
 await h.render().find(n=>n.type==='button'&&n.props.children==='정산 시작').props.onClick();
 let tree=h.render();const dialog=tree.find(n=>n.type==='dialog'&&n.props['aria-labelledby']==='event-close-password-title');
 assert.ok(JSON.stringify(dialog).includes('모든 기기'));
 nodes(dialog).find(n=>n.type==='input'&&n.props.type==='password').props.onChange({target:{value:password}});
 tree=h.render();await nodes(tree.find(n=>n.type==='dialog'&&n.props['aria-labelledby']==='event-close-password-title')).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
}

test('close UI blocks pending orders before confirmation and never posts a closure',async()=>{
 const h=await harness(1);await h.render().find(n=>n.type==='button'&&n.props.children==='정산 시작').props.onClick();
 assert.equal(h.calls.length,0);assert.equal(h.confirmations.length,0);assert.ok(h.render().some(n=>n.props.role==='alert'&&n.props.children.includes('미동기화')));
});
test('close UI submits the displayed preview and replaces cost editing with payout controls',async()=>{
 const h=await harness();await closeWithPassword(h);
 assert.equal(h.calls[0].action,'closeEventSettlement');assert.equal(JSON.parse(h.calls[0].expectedPreview).net,100);assert.equal(h.calls[0].password,'test-password');
 assert.ok(h.render().some(n=>n.type==='button'&&n.props.children==='정산 완료'));assert.ok(!h.render().some(n=>n.type==='button'&&n.props.children==='비용 저장'));
});
test('close UI requires a password and cancellation sends no closure',async()=>{
 const h=await harness();await h.render().find(n=>n.type==='button'&&n.props.children==='정산 시작').props.onClick();
 let tree=h.render(),dialog=tree.find(n=>n.type==='dialog'&&n.props['aria-labelledby']==='event-close-password-title');
 await nodes(dialog).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(h.calls.length,0);
 nodes(dialog).find(n=>n.type==='input'&&n.props.type==='password').props.onChange({target:{value:'temporary'}});
 tree=h.render();dialog=tree.find(n=>n.type==='dialog'&&n.props['aria-labelledby']==='event-close-password-title');nodes(dialog).find(n=>n.type==='button'&&n.props.children==='취소').props.onClick();
 assert.equal(h.calls.length,0);assert.equal(h.render().some(n=>n.type==='input'&&n.props.type==='password'),false);
});

test('migrated event payout sends recipient identity without a creator-name write key',async()=>{
 const h=await harness(0,true);await closeWithPassword(h);await enterPayment(h);
 await h.render().find(n=>n.type==='button'&&n.props.children==='정산 완료').props.onClick();
 assert.equal(h.calls[2].action,'completeRecipientSettlement');assert.equal(h.calls[1].recipientId,'recipient-a');assert.equal(Object.hasOwn(h.calls[1],'creator'),false);
 assert.equal(Object.hasOwn(h.calls[1],'password'),false);
});



const button=(h,label)=>h.render().find(n=>n.type==='button'&&n.props.children===label);
async function enterCost(h,value='2.35'){
 button(h,'+ 비용 항목 추가').props.onClick();
 let tree=h.render();
 tree.find(n=>n.type==='input'&&n.props.maxLength===80).props.onChange({target:{value:'수수료'}});
 tree.find(n=>n.type==='select'&&n.props.value==='fixed').props.onChange({target:{value:'percent'}});
 tree=h.render();tree.find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value}});
 await h.render().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
}
test('cost mutations persist immediately and percentage editing replaces rather than duplicates',async()=>{
 const h=await harness();await enterCost(h);
 assert.equal(h.calls[0].action,'saveEventCosts');assert.equal(h.calls[0].costs[0].value,235);
 assert.equal(button(h,'비용 저장'),undefined);assert.equal(button(h,'변경 취소'),undefined);
 h.render().find(n=>n.props['aria-label']==='수수료 수정').props.onClick();
 let tree=h.render();assert.equal(tree.find(n=>n.type==='input'&&n.props.type==='number').props.value,'2.35');
 tree.find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value:'3.25'}});
 await h.render().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(h.calls[1].costs.length,1);assert.equal(h.calls[1].costs[0].value,325);assert.equal(h.calls[1].version,1);
 await h.render().find(n=>n.props['aria-label']==='수수료 삭제').props.onClick();
 assert.deepEqual(h.calls[2].costs,[]);assert.equal(h.calls[2].version,2);
});
test('cost draft cancellation sends no command and pending orders reject immediate saving',async()=>{
 const h=await harness();button(h,'+ 비용 항목 추가').props.onClick();button(h,'취소').props.onClick();assert.equal(h.calls.length,0);
 const blocked=await harness(1);await enterCost(blocked);assert.equal(blocked.calls.length,0);
 assert.ok(blocked.render().some(n=>n.props.role==='alert'&&n.props.children.includes('미동기화')));
});
test('settlement lifecycle starts explicitly, completes recipients, ends and resumes',async()=>{
 const h=await harness();assert.ok(h.render().some(n=>n.props.children==='정산 시작 전'));
 await closeWithPassword(h);assert.ok(h.render().some(n=>n.props.children==='정산 진행 중'));
 assert.equal(button(h,'정산 종료').props.disabled,true);
 await enterPayment(h);await button(h,'정산 완료').props.onClick();assert.equal(button(h,'정산 종료').props.disabled,false);
 await button(h,'정산 종료').props.onClick();assert.ok(h.render().some(n=>n.props.children==='정산 종료'));
 assert.equal(button(h,'지급하기').props.disabled,false);
 await button(h,'정산 종료 해제').props.onClick();assert.equal(button(h,'지급하기').props.disabled,false);
});
test('payout response loss retries the exact command and blocks competing controls',async()=>{
 const h=await harness(0,true,true);await closeWithPassword(h);
 await enterPayment(h);
 assert.equal(button(h,'지급 요청 재확인'),undefined);
 await enterPayment(h);
 assert.deepEqual(h.calls[1],h.calls[2]);assert.equal(h.calls[2].recipientId,'recipient-a');
});


test('immediate cost response loss preserves draft and retries identical command',async()=>{
 const h=await harness(0,false,false,true);await enterCost(h);
 assert.equal(button(h,'정산 시작').props.disabled,false);assert.equal(button(h,'이전 요청 재확인'),undefined);
 await h.render().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.deepEqual(h.calls[0],h.calls[1]);
 assert.ok(h.render().some(n=>n.type==='td'&&n.props.children==='2.35%'));
});


test('zero net creator requires and accepts explicit settlement completion',async()=>{
 const h=await harness(0,false,false,false,0);await closeWithPassword(h);
 assert.equal(button(h,'정산 완료').props.disabled,false);assert.equal(button(h,'정산 종료').props.disabled,true);
 await button(h,'정산 완료').props.onClick();assert.equal(h.calls[1].amount,0);
 assert.equal(button(h,'정산 종료').props.disabled,false);
});

async function enterPayment(h,amount='100',date='2026-10-28'){
 button(h,'지급하기').props.onClick();
 let dialog=h.render().find(n=>n.props.role==='dialog'&&n.props['aria-labelledby']==='event-payment-title');
 assert.equal(nodes(dialog).filter(n=>n.type==='input').length,2);
 nodes(dialog).find(n=>n.type==='input'&&n.props.type==='number').props.onChange({target:{value:amount}});
 nodes(dialog).find(n=>n.type==='input'&&n.props.type==='date').props.onChange({target:{value:date}});
 dialog=h.render().find(n=>n.props.role==='dialog'&&n.props['aria-labelledby']==='event-payment-title');
 await nodes(dialog).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
}
test('payment popup records only amount and date and enables completion after full payout',async()=>{
 const h=await harness();await closeWithPassword(h);
 await enterPayment(h,'40');assert.equal(h.calls[1].amount,40);assert.equal(h.calls[1].paidAt,'2026-10-28');assert.equal(h.calls[1].memo,'');
 assert.equal(button(h,'정산 완료').props.disabled,false);assert.equal(button(h,'정산 종료').props.disabled,true);
 await button(h,'정산 완료').props.onClick();assert.equal(h.calls[2].action,'completeRecipientSettlement');
 assert.equal(button(h,'정산 완료').props.disabled,true);assert.equal(button(h,'정산 종료').props.disabled,false);
});

test('payment popup cancellation and invalid amount never write payments',async()=>{
 const h=await harness();await closeWithPassword(h);
 button(h,'지급하기').props.onClick();
 const dialog=h.render().find(n=>n.props.role==='dialog'&&n.props['aria-labelledby']==='event-payment-title');
 nodes(dialog).find(n=>n.type==='button'&&n.props.children==='취소').props.onClick();assert.equal(h.calls.length,1);
 await enterPayment(h,'101');assert.equal(h.calls.length,1);
 assert.ok(h.render().some(n=>n.props.role==='alert'&&n.props.children.includes('지급 금액')));
});
test('completion marker preserves zero negative and reversed payment boundaries',()=>{
 const marker={id:'done',amount:0,settlementComplete:true};
 assert.equal(recipientSettled({net:-100},[]),false);
 assert.equal(recipientSettled({net:-100},[marker]),true);
 assert.equal(recipientSettled({net:100},[{id:'pay',amount:100}]),false);
 assert.equal(recipientSettled({net:100},[{id:'pay',amount:100},marker]),true);
 assert.equal(recipientSettled({net:100},[{id:'pay',amount:100},marker,{amount:-100,reversalOf:'pay'}]),false);
 assert.equal(recipientSettled({net:0},[marker,{amount:0,reversalOf:'done'}]),false);
});

test('payment popup renders visibly on click and can close and reopen',async()=>{
 const h=await harness();await closeWithPassword(h);
 const modal=()=>h.render().find(n=>n.props.role==='dialog'&&n.props['aria-labelledby']==='event-payment-title');
 assert.equal(modal(),undefined);
 button(h,'지급하기').props.onClick();assert.ok(modal());assert.equal(modal().props['aria-modal'],'true');
 assert.ok(h.render().some(n=>n.props.className==='event-payment-overlay'));
 nodes(modal()).find(n=>n.type==='button'&&n.props.children==='취소').props.onClick();assert.equal(modal(),undefined);
 button(h,'지급하기').props.onClick();assert.ok(modal());assert.equal(h.calls.length,1);
});

test('payout button stays enabled for zero balance and finished events while recording stays blocked',async()=>{
 for(const amount of [0,100]){
  const h=await harness(0,false,false,false,amount);await closeWithPassword(h);
  assert.equal(button(h,'지급하기').props.disabled,false);
  if(amount>0)await enterPayment(h);
  assert.equal(button(h,'지급하기').props.disabled,false);
  button(h,'지급하기').props.onClick();assert.equal(button(h,'기록').props.disabled,true);button(h,'취소').props.onClick();
  await button(h,'정산 완료').props.onClick();await button(h,'정산 종료').props.onClick();
  assert.equal(button(h,'지급하기').props.disabled,false);
  button(h,'지급하기').props.onClick();assert.equal(button(h,'기록').props.disabled,true);
  const count=h.calls.length;
  await h.render().find(n=>n.type==='form'&&n.props.onSubmit&&nodes(n).some(child=>child.props.id==='event-payment-title')).props.onSubmit({preventDefault(){}});
  assert.equal(h.calls.length,count);
 }
});
