import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {storageQuery} from '../api/lib/storageContract.js';
import {createApiContractContext} from '../src/utils/apiContractContext.js';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(file,mocks={}) {
 let cursor=0,effectIndex=0;const states=[],effects=[],deps=[];
 const react={useRef:value=>{const i=cursor++;return states[i]||=( {current:value});},useState:value=>{const i=cursor++;if(!(i in states))states[i]=value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(effect,dependencies)=>{const i=effectIndex++;if(!deps[i]||dependencies.some((v,j)=>!Object.is(v,deps[i][j]))){deps[i]=dependencies;effects.push(effect);}}};
 const base={react,'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'./Icon':{default:'Icon'},'./SyncStatus':{SyncStatus:'SyncStatus'},'../hooks/usePageRoute':{pagePaths:{dashboard:'/dashboard',projects:'/projects',inventory:'/inventory',revenue:'/revenue',account:'/account',pos:'/sales',settings:'/products',log:'/settlement',project:'/project'}},'../utils/productDisplay':{won:String},'../utils/revenueSummary':{koreanDay:value=>String(value).slice(0,10)},'../components/LoadingState':{default:'LoadingState'},'./ArtistStockPage':{StockItem:'StockItem'},'./InventoryImport':{default:'InventoryImport'},'../components/InventoryProductFields':{default:'InventoryProductFields'},'../utils/uploadProductImage':{uploadInventoryImage:async()=>({})},'../utils/productImage':{prepareProductImage:async f=>f},'../hooks/useUnsavedChanges':{useUnsavedChanges:()=>()=>{}},...mocks};
 const context=vm.createContext({crypto:globalThis.crypto,URLSearchParams});
 const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>{assert.ok(base[name],name);return new vm.SyntheticModule(Object.keys(base[name]),function(){for(const[k,v]of Object.entries(base[name]))this.setExport(k,v);},{context});});await module.evaluate();
 return {render:(props,exportName='default')=>{cursor=effectIndex=0;return nodes(module.namespace[exportName](props));},flush:async()=>{while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));}};
}
test('five primary menus and artist/assistant/operator event navigation follow server capabilities',async()=>{
 for(const [role,permissions,expected] of [
  ['artist',{ownerIds:['own'],canSell:false,canConfigure:false,canManage:false},['행사 판매 설정','정산현황']],
  ['assistant',{ownerIds:['own'],canSell:true,canConfigure:true,canManage:false},['판매 목록','행사 판매 설정','정산현황']],
  ['operator',{ownerIds:[],canSell:true,canConfigure:true,canManage:true,canSettle:true},['판매 목록','행사 판매 설정','정산현황','행사 관리']]
 ]) {
  const h=await harness('components/PageLayout.jsx');const tree=h.render({page:'settings',navigate(){},project:{id:'e',name:'행사',permissions}},'AppHeader');
  const nav=tree.find(n=>n.props.className==='nav-screens');assert.deepEqual(nodes(nav).filter(n=>n.type==='a').map(n=>n.props.children[1]),['대시보드','행사 선택','재고관리','수익현황','마이페이지']);
  const event=tree.find(n=>n.props['aria-label']==='행사 메뉴');assert.deepEqual(nodes(event).filter(n=>n.type==='button').map(n=>n.props.children),expected,role);
 }
});
test('personal revenue reads only the artist history contract and event view excludes other events without exposing payout editing',async()=>{
 const h=await harness('pages/PersonalOverview.jsx');const calls=[];
 const request=async url=>{calls.push(url);return {events:[{projectId:'mine',eventName:'내 행사',boothName:'부스',closedAt:'2026',rows:[{recipientId:'r',artistName:'작가',gross:100,fees:10,net:90,paid:20,pending:70}],sales:[{time:'2026-10-22',items:[{amount:100}]}]},{projectId:'other',rows:[{artistName:'다른 행사 이름',gross:999}],sales:[]}]};};
 const props={request,projectId:'mine'};h.render(props);await h.flush();const tree=h.render(props);
 assert.deepEqual(calls,['/api/booths?artists=history']);assert.equal(JSON.stringify(tree).includes('다른 행사 이름'),false);
 assert.equal(tree.some(n=>n.type==='SettlementEditor'||n.type==='button'&&n.props.children==='지급 완료'),false);
});
test('personal inventory defaults to owned profile and uses artist APIs rather than the old account inventory',async()=>{
 const h=await harness('pages/PersonalInventory.jsx');const calls=[];
 const request=async url=>{calls.push(url);if(url.includes('workspace=home'))return {profiles:[{owner_id:'mine',display_name:'내 작가'}],booths:[{id:'b',name:'부스',role:'owner'}]};if(url.includes('artists=participants'))return {profiles:[{owner_id:'proxy',display_name:'대리 작가',participation:'proxy'}]};return {inventory:[],events:[]};};
 const props={request,routeHash:'#/inventory',navigate(){}};h.render(props);await h.flush();h.render(props);await h.flush();h.render(props);
 assert.ok(calls.some(url=>url.includes('ownerId=mine')));assert.ok(!calls.some(url=>url.includes('ownerId=proxy')));
 assert.ok(!calls.some(url=>url.includes('/api/pos')));
});
test('physical SQL translation preserves values and snapshot keys; a delegate with no default booth sends its explicit event scope',()=>{
 const value={name:'pos_inventory',admin_id:'keep-me'};
 const query=storageQuery("SELECT admin_id,snapshot->>'admin_id' FROM pos_inventory WHERE product=$1::jsonb",[JSON.stringify(value)]);
 assert.ok(query.text.includes("custodian_id,snapshot->>'admin_id' FROM pos_artist_inventory"));assert.deepEqual(query.values,[JSON.stringify(value)]);
 const ctx=createApiContractContext();ctx.prepare('t','/api/booths?workspace=home');ctx.observe('t','/api/booths?workspace=home',{events:[{id:'e',boothId:'b'}]});
 assert.equal(JSON.parse(ctx.prepare('t','/api/pos',{method:'POST',body:JSON.stringify({projectId:'e',action:'replaceBundles'})}).body).boothId,'b');
});
