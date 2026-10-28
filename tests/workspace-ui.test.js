import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {dashboardEvents,dashboardFocus,dashboardAlerts,dashboardPastEvents,dashboardRole,settlementDisplay} from '../src/utils/personalDashboard.js';
import {eventSchedule,sortEventsBySchedule} from '../src/utils/eventSchedule.js';
import {eventDestination,eventActionLabel} from '../src/utils/eventNavigation.js';
import {storageQuery} from '../api/lib/storageContract.js';
import {createApiContractContext} from '../src/utils/apiContractContext.js';
import {allocationPlan} from '../src/utils/inventoryAllocationPlan.js';
import {eventCreatorNameOf,productNameWithoutCreator} from '../src/utils/productDisplay.js';
import {filterInventory} from '../src/utils/inventorySearch.js';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(file,mocks={}) {
 let cursor=0,effectIndex=0;const states=[],effects=[],deps=[];
 const react={useId:()=> 'inventory-plan-form',useRef:value=>{const i=cursor++;return states[i]||=( {current:value});},useState:value=>{const i=cursor++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(effect,dependencies)=>{const i=effectIndex++;if(!deps[i]||dependencies.some((v,j)=>!Object.is(v,deps[i][j]))){deps[i]=dependencies;effects.push(effect);}}};
 const base={'../utils/eventNavigation':{eventDestination,eventActionLabel},'../hooks/useEventReadRefresh':{useEventReadRefresh:()=>0},react,'./EventStockAllocationPanel':{default:'EventStockAllocationPanel'},'../components/InventoryAllocationManager':{default:'InventoryAllocationManager'},'../components/CreatorField':{default:'CreatorField'},'./CreatorField':{default:'CreatorField'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'./Icon':{default:'Icon'},'../components/Icon':{default:'Icon'},'../utils/eventSchedule':{eventSchedule,sortEventsBySchedule},'./SyncStatus':{SyncStatus:'SyncStatus'},'../hooks/usePageRoute':{pagePaths:{dashboard:'/dashboard',projects:'/projects',inventory:'/inventory',revenue:'/account/revenue',account:'/account',pos:'/sales',settings:'/products',log:'/settlement',project:'/project/manage'}},'../utils/productDisplay':{won:String,uid:()=>'old-id',eventCreatorNameOf},'../utils/revenueSummary':{koreanDay:value=>String(value).slice(0,10)},'../components/LoadingState':{default:'LoadingState'},'../components/PersonalDashboard':{default:'PersonalDashboard'},'../utils/personalDashboard':{dashboardEvents,dashboardFocus,dashboardAlerts,dashboardPastEvents,dashboardRole,settlementDisplay},'./ArtistStockPage':{StockItem:'StockItem'},'../components/PersonalInventoryCatalog':{default:'PersonalInventoryCatalog'},'../components/PersonalSalesHistory':{default:'PersonalSalesHistory'},'../components/PageLayout':{PageIntro:'PageIntro'},'../components/EventSalesCatalog':{default:'EventSalesCatalog'},'../components/PosUI':{ProductImage:'ProductImage',Input:'Input'},'../components/ExistingEventStockDialog':{default:'ExistingEventStockDialog'},'../components/EventProductDetail':{default:'EventProductDetail'},'../utils/confirmAction':{confirmAction:async()=>true},'./ProductCreatePage':{default:'ProductCreatePage'},'./InventoryImport':{default:'InventoryImport'},'../components/InventoryProductFields':{default:'InventoryProductFields'},'../utils/uploadProductImage':{uploadInventoryImage:async()=>({}),uploadProductImage:async()=>({})},'../utils/productImage':{prepareProductImage:async f=>f},'../hooks/useUnsavedChanges':{useUnsavedChanges:()=>()=>{},allowNavigation:async()=>true},...mocks};
 const listeners=new Map();
 const context=vm.createContext({document:{addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)},crypto:globalThis.crypto,URLSearchParams,URL,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},alert:message=>{throw new Error(message);}});
 const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>{assert.ok(base[name],name);return new vm.SyntheticModule(Object.keys(base[name]),function(){for(const[k,v]of Object.entries(base[name]))this.setExport(k,v);},{context});});await module.evaluate();
 return {listeners,render:(props,exportName='default')=>{cursor=effectIndex=0;return nodes(module.namespace[exportName](props));},flush:async()=>{while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));}};
}
test('personal revenue reads only the artist history contract and event view excludes other events without exposing payout editing',async()=>{
 const h=await harness('pages/PersonalOverview.jsx');const calls=[];
 const request=async url=>{calls.push(url);return {events:[{projectId:'mine',eventName:'내 행사',boothName:'부스',closedAt:'2026',rows:[{recipientId:'r',artistName:'제작자',gross:100,fees:10,net:90,paid:20,pending:70}],sales:[{time:'2026-10-22',items:[{amount:100}]}]},{projectId:'other',rows:[{artistName:'다른 행사 이름',gross:999}],sales:[]}]};};
 const props={request,projectId:'mine'};h.render(props);await h.flush();const tree=h.render(props);
 assert.deepEqual(calls,['/api/booths?artists=history']);assert.equal(JSON.stringify(tree).includes('다른 행사 이름'),false);
 assert.equal(tree.some(n=>n.type==='SettlementEditor'||n.type==='button'&&n.props.children==='지급 완료'),false);
});
test('personal inventory defaults to owned profile and uses artist APIs rather than the old account inventory',async()=>{
 const h=await harness('pages/PersonalInventory.jsx');const calls=[];
 const request=async url=>{calls.push(url);if(url.includes('workspace=home'))return {profiles:[{owner_id:'mine',display_name:'내 제작자'},{owner_id:'linked',display_name:'연결된 내 제작자'}],booths:[{id:'b',name:'부스',role:'owner'}]};if(url.includes('artists=participants'))return {profiles:[{owner_id:'proxy',display_name:'대리 제작자',participation:'proxy'}]};return {inventory:[],events:[]};};
 const props={request,routeHash:'#/inventory',navigate(){}};h.render(props);await h.flush();h.render(props);await h.flush();const tree=h.render(props);
 assert.ok(calls.some(url=>url.includes('ownerId=mine')));assert.ok(calls.some(url=>url.includes('ownerId=linked')));assert.ok(!calls.some(url=>url.includes('artists=participants')));assert.equal(tree.some(node=>node.type==='select'),false);assert.ok(!calls.some(url=>url.includes('ownerId=proxy')));
 assert.ok(!calls.some(url=>url.includes('/api/pos')));
});
test('personal inventory without a profile keeps the catalog and registration form visible without sending stock commands',async()=>{
 const calls=[],opened=[];
 const request=async(url,options)=>{calls.push({url,options});return {profiles:[],booths:[]};};
 const h=await harness('pages/PersonalInventory.jsx');const props={request,routeHash:'#/inventory',navigate:path=>opened.push(path)};
 let tree=h.render(props);assert.ok(tree.some(n=>n.type==='PersonalInventoryCatalog'));
 await h.flush();tree=h.render(props);await h.flush();tree=h.render(props);
 const catalog=tree.find(n=>n.type==='PersonalInventoryCatalog');assert.equal(catalog.props.items.length,0);assert.equal(catalog.props.events.length,0);
 tree.find(n=>n.type==='button'&&n.props.children==='+ 새 상품 등록').props.onClick();assert.deepEqual(opened,['/inventory/new']);
 tree=h.render({...props,routeHash:'#/inventory/new'});
 assert.ok(tree.some(n=>n.type==='InventoryProductFields'&&n.props.disabled));
 assert.equal(tree.some(n=>n.props.role==='alert'),false);
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(calls.some(call=>call.options?.method==='POST'||call.url.includes('artists=stock')),false);
 const list=await harness('components/PersonalInventoryCatalog.jsx',{'../utils/inventorySearch':{filterInventory}});
 const empty=list.render(catalog.props);assert.ok(empty.some(n=>n.props.role==='search'));assert.ok(empty.some(n=>n.type==='table'));assert.ok(empty.some(n=>n.type==='thead'));
});

test('personal inventory registers the first product through the existing owned stock command',async()=>{
 const calls=[],opened=[];const request=async(url,options)=>{
  if(options?.method==='POST'){calls.push(JSON.parse(options.body));return {};}
  if(url.includes('workspace=home'))return {profiles:[{owner_id:'mine',display_name:'나'}],booths:[]};
  return {inventory:[],events:[]};
 };
 const h=await harness('pages/PersonalInventory.jsx'),props={request,routeHash:'#/inventory/new',navigate:path=>opened.push(path)};
 h.render(props);await h.flush();h.render(props);await h.flush();let tree=h.render(props);
 const fields=tree.find(n=>n.type==='InventoryProductFields');assert.equal(fields.props.disabled,false);
 fields.props.onChange('name','첫 상품');tree=h.render(props);
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(calls.length,1);assert.equal(calls[0].action,'createArtistStock');assert.equal(calls[0].payload.ownerId,'mine');assert.equal(calls[0].payload.name,'첫 상품');assert.equal(calls[0].payload.price,0);assert.equal(calls[0].payload.quantity,0);assert.deepEqual(opened,['inventory']);
});

test('physical SQL translation preserves values and snapshot keys; a delegate with no default booth sends its explicit event scope',()=>{
 const value={name:'pos_inventory',admin_id:'keep-me'};
 const query=storageQuery("SELECT admin_id,snapshot->>'admin_id' FROM pos_inventory WHERE product=$1::jsonb",[JSON.stringify(value)]);
 assert.ok(query.text.includes("custodian_id,snapshot->>'admin_id' FROM pos_artist_inventory"));assert.deepEqual(query.values,[JSON.stringify(value)]);
 const ctx=createApiContractContext();ctx.prepare('t','/api/booths?workspace=home');ctx.observe('t','/api/booths?workspace=home',{events:[{id:'e',boothId:'b'}]});
 assert.equal(JSON.parse(ctx.prepare('t','/api/pos',{method:'POST',body:JSON.stringify({projectId:'e',action:'replaceBundles'})}).body).boothId,'b');
});

test('personal inventory catalog searches own stock and opens the selected product detail',async()=>{
 const h=await harness('components/PersonalInventoryCatalog.jsx',{'../utils/inventorySearch':{filterInventory}});
 const opened=[];const items=[{id:'a',name:'아크릴',goodsType:'스탠드',genre:'시리즈',remaining:8,warehouse:3,totalStock:10,allocations:[{projectId:'event'}]},{id:'b',name:'스티커',remaining:5,warehouse:5,totalStock:5,allocations:[]}];
 const props={items,events:[{id:'event',name:'행사'}],detailId:'',navigate:path=>opened.push(path),renderDetail:item=>({type:'detail',props:{id:item.id}})};
 let tree=h.render(props);assert.equal(tree.filter(n=>n.type==='tbody')[0].props.children[1].length,2);
 tree.find(n=>n.props.type==='search').props.onChange({target:{value:'아크릴'}});
 tree=h.render(props);tree.find(n=>n.props.role==='search').props.onSubmit({preventDefault(){}});
 tree=h.render(props);assert.equal(tree.filter(n=>n.type==='tbody')[0].props.children[1].length,1);
 tree.find(n=>n.type==='a').props.onClick({button:0,preventDefault(){}});assert.deepEqual(opened,['/inventory/a']);
 tree=h.render({...props,detailId:'b'});assert.equal(tree.find(n=>n.type==='detail').props.id,'b');assert.equal(tree.some(n=>n.props.role==='search'),false);
});

test('personal tools reuse the import editor and replace loss entry with sales history',async()=>{
 const calls=[];const request=async(url,options)=>{
  if(options?.method==='POST'){calls.push(JSON.parse(options.body));return {};}
  if(url.includes('workspace=home'))return {profiles:[{owner_id:'mine',display_name:'나'}],booths:[]};
  if(url.includes('artists=movements'))return {movements:[]};
  return {inventory:[{id:'p',ownerId:'mine',version:2,warehouse:5}],events:[]};
 };
 const h=await harness('pages/PersonalInventory.jsx');const props={request,routeHash:'#/inventory/import',navigate(){}};
 assert.equal(h.render(props).find(n=>n.type==='InventoryImport').props.ready,false);
 await h.flush();h.render(props);await h.flush();let tree=h.render({...props,routeHash:'#/inventory/import/review'});
 assert.equal(tree.find(n=>n.type==='InventoryImport').props.review,true);assert.equal(tree.find(n=>n.type==='InventoryImport').props.ready,true);
 tree=h.render({...props,routeHash:'#/inventory/sales'});
 assert.equal(tree.find(n=>n.type==='PersonalSalesHistory').props.items[0].warehouse,5);
 assert.equal(tree.some(n=>n.type==='StockMovementForm'),false);
 const tabs=tree.find(n=>n.props['aria-label']==='내 재고관리 하위 메뉴');
 assert.deepEqual(nodes(tabs).filter(n=>n.type==='button').map(n=>n.props.children),['내 재고관리','재고 일괄등록','내 판매내역']);
 tree=h.render({...props,routeHash:'#/inventory/movements'});
 assert.ok(tree.some(n=>n.type==='PersonalSalesHistory'));assert.equal(calls.length,0);
});


test('event catalog combines registered artists and creation maps the selected artist with a stable request ID',async()=>{
 const calls=[],opened=[];
 const request=async(url,options)=>{
  if(options?.method==='POST'){const command=JSON.parse(options.body);calls.push(command);return {inventory:{id:'new',ownerId:command.payload.ownerId}};}
  if(url.includes('workspace=home'))return {profiles:[]};
  if(url.includes('stockParticipants'))return {profiles:[{owner_id:'a',display_name:'A'},{owner_id:'b',display_name:'B'}]};
  const owner=new URLSearchParams(url.split('?')[1]).get('ownerId');
  return {inventory:[{id:owner,ownerId:owner}],events:[{id:'event',operator:true},{id:'other',operator:true}]};
 };
 const h=await harness('pages/PersonalInventory.jsx');
 const props={request,routeHash:'#/products',navigate:page=>opened.push(page),event:{id:'event',boothId:'booth',permissions:{canConfigure:true,canManage:true}}};
 h.render(props);await h.flush();h.render(props);await h.flush();let tree=h.render(props);
 assert.equal(tree.some(n=>n.type==='select'),false);
 const catalog=tree.find(n=>n.type==='EventSalesCatalog');
 assert.deepEqual(Array.from(catalog.props.items,item=>item.ownerId),['a','b']);
 assert.deepEqual(Array.from(nodes(catalog.props.renderDetail(catalog.props.items[1])).find(n=>n.type==='StockItem').props.events,row=>row.id),['event']);
 catalog.props.onAdd();assert.deepEqual(opened,['productNew']);
 tree=h.render({...props,routeHash:'#/products/new'});
 const form=tree.find(n=>n.type==='ProductCreatePage');assert.equal(form.props.artists.length,2);
 const product={id:'fixed-registration',ownerId:'b',name:'Goods',price:0,stockQty:3,goodsType:'Sticker'};
 await form.props.registerProduct(product);await form.props.registerProduct(product);
 assert.equal(calls.length,2);assert.equal(calls[0].action,'registerEventArtistProduct');
 assert.equal(calls[0].payload.ownerId,'b');assert.equal(calls[0].payload.boothId,'booth');assert.equal(calls[0].payload.projectId,'event');
 assert.equal(calls[0].payload.price,0);assert.equal(calls[0].payload.quantity,3);assert.equal(calls[0].payload.requestId,calls[1].payload.requestId);
 await assert.rejects(()=>form.props.registerProduct({...product,ownerId:'outsider'}));assert.equal(calls.length,2);
 await form.props.registerProduct({...product,ownerId:'',artistName:'Direct Artist'});assert.equal(calls[2].payload.artistName,'Direct Artist');assert.equal(calls[2].payload.ownerId,undefined);
 tree=h.render({...props,event:{...props.event,archivedAt:'2026-10-23'}});assert.equal(tree.find(n=>n.type==='EventSalesCatalog').props.onAdd,undefined);
});


test('event product form offers direct artist input, hides unspecified and preserves UUID registration on uncertain retry',async()=>{
 const h=await harness('pages/ProductCreatePage.jsx');const calls=[];let returned=false;
 const props={projectId:'event',artists:[{ownerId:'none',label:'미지정'},{ownerId:'admin',label:'관리자'}],allowDirectArtist:true,products:[],onBack(){returned=true;},registerProduct:async product=>{calls.push(product);if(calls.length===1)throw Object.assign(new Error('network'),{status:503});}};
 let tree=h.render(props);
 assert.equal(tree.find(n=>n.type==='CreatorField').props.allowDirect,true);
 assert.equal(tree.some(n=>n.type==='option'&&n.props.children==='미지정'),false);
 tree.find(n=>n.type==='CreatorField').props.onChange({ownerId:'',artistName:'직접 제작자'});
 const fields=tree.find(n=>n.type==='InventoryProductFields');fields.props.onChange('name','상품');fields.props.onChange('goodsType','키링');
 tree=h.render(props);await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 tree=h.render(props);assert.equal(tree.find(n=>n.type==='CreatorField').props.disabled,true);
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});
 assert.equal(calls.length,2);assert.equal(calls[0].id,calls[1].id);assert.match(calls[0].id,/^[a-f0-9-]{36}$/i);
 assert.equal(calls[0].creatorName,'직접 제작자');assert.equal(calls[0].artistName,'직접 제작자');assert.equal(returned,true);
});


test('event product list uses event detail URLs and direct entry renders the requested event product',async()=>{
 const h=await harness('components/EventSalesCatalog.jsx');const opened=[];
 const item={id:'stock',name:'상품',allocations:[{projectId:'event',productId:'uaerhod',initial:10,sold:1,remaining:9}]};
 const props={items:[item],event:{id:'event'},products:[{id:'uaerhod',saleNumber:1}],navigate:path=>opened.push(path),renderProduct:(row,product)=>({type:'EventProductDetail',props:{item:row,product}})};
 let tree=h.render(props);const link=tree.find(n=>n.type==='a');assert.equal(link.props.href,'#/products/uaerhod?projectId=event');
 link.props.onClick({button:0,preventDefault(){}});assert.deepEqual(opened,['/products/uaerhod?projectId=event']);
 tree=h.render({...props,productId:'uaerhod'});assert.equal(tree.find(n=>n.type==='EventProductDetail').props.product.id,'uaerhod');
 tree.find(n=>n.type==='button'&&n.props.children==='← 목록으로').props.onClick();assert.equal(opened[1],'/products?projectId=event');
});


test('event artist addition searches registered profiles in a popup instead of creating an unlinked name',async()=>{
 const calls=[];const request=async(url,options)=>{
  if(options){const command=JSON.parse(options.body);calls.push(command);return {added:true};}
  if(url.includes('searchArtists'))return {artists:[{id:'artist-profile',display_name:'검색 제작자',nickname:'닉네임',registered:false}]};
  return {profiles:[],staff:[]};
 };
 const h=await harness('components/EventAccessPanel.jsx');const props={request,project:{id:'event',boothId:'booth'}};
 h.render(props);await h.flush();let tree=h.render(props);assert.equal(tree.some(n=>n.type==='button'&&n.props.children==='미연동 제작자 추가'),false);
 tree.find(n=>n.type==='button'&&n.props.children==='제작자 추가').props.onClick();h.render(props);await h.flush();tree=h.render(props);
 tree.find(n=>n.type==='input'&&n.props.maxLength===100).props.onChange({target:{value:'검색'}});tree=h.render(props);
 await tree.find(n=>n.type==='form'&&n.props.className==='event-account-search').props.onSubmit({preventDefault(){}});tree=h.render(props);
 assert.equal(nodes(tree.find(n=>n.type==='dialog')).some(n=>n.type==='select'),false);
 await tree.find(n=>n.type==='button'&&n.props.children==='등록').props.onClick();
 assert.equal(calls[0].action,'addEventArtist');assert.equal(calls[0].payload.profileId,'artist-profile');assert.equal(calls[0].payload.role,'none');assert.equal(calls[0].payload.projectId,'event');
});


test('event product detail labels one linked creator and supports search, replacement and unlink without loss controls',async()=>{
 const mapped=[];const h=await harness('components/EventProductDetail.jsx',{'./PosUI':{ProductImage:'ProductImage',Quantity:'Quantity',Input:'Input'},'./ProductEditForm':{default:'ProductEditForm'}});
 const props={item:{id:'s',name:'상품',version:1,totalStock:10,allocations:[{projectId:'e',initial:10,sold:1,remaining:9}]},product:{id:'p',saleNumber:1,eventCreator:{ownerId:'a',name:'기존 제작자',linked:true}},products:[],event:{id:'e'},creatorOptions:[{ownerId:'a',label:'기존 제작자',linked:true},{ownerId:'b',label:'새 제작자',linked:true}],canEditCreator:true,onSetCreator:async id=>mapped.push(id)};
 let tree=h.render(props);assert.equal([tree.find(n=>n.type==='h3').props.children].flat().join(''),'1번 상품 - 상품');assert.equal(tree.some(n=>n.type==='a'),false);assert.equal(tree.some(n=>n.type==='StockMovementForm'),false);
 const slot=nodes(tree.find(n=>n.type==='ProductEditForm').props.creatorSlot);assert.ok(slot.some(n=>n.props.children==='연동완료'));slot.find(n=>n.type==='button').props.onClick();tree=h.render(props);
 tree.find(n=>n.type==='CreatorField').props.onChange({ownerId:'b'});tree=h.render(props);
 await tree.find(n=>n.type==='button'&&n.props.children==='제작자 저장').props.onClick();assert.deepEqual(mapped,['b']);
 tree=h.render(props);await tree.find(n=>n.type==='button'&&n.props.children==='제작자 연결 삭제').props.onClick();assert.deepEqual(mapped,['b',null]);
});

test('stock management setting saves opt-out and confirms a searched participation separately',async()=>{
 const h=await harness('components/StockManagementSettings.jsx'),calls=[];
 let data={allowOperatorStock:true,participations:[{booth_id:'b',owner_id:'o',booth_name:'Booth',display_name:'Artist',stock_management_confirmed:false}]};
 const request=async(url,options)=>{if(!options)return data;const command=JSON.parse(options.body);calls.push(command);if(command.action==='saveStockPreference')data={...data,allowOperatorStock:command.payload.allowOperatorStock};else data={...data,participations:data.participations.map(row=>({...row,stock_management_confirmed:true}))};return data;};
 const props={request};h.render(props);await h.flush();let tree=h.render(props);
 assert.equal(tree.find(n=>n.type==='input').props.checked,true);
 await tree.find(n=>n.type==='input').props.onChange({target:{checked:false}});tree=h.render(props);
 assert.equal(tree.find(n=>n.type==='input').props.checked,false);assert.equal(calls[0].action,'saveStockPreference');assert.equal(calls[0].payload.allowOperatorStock,false);assert.ok(calls[0].payload.requestId);
 await tree.find(n=>n.type==='button'&&n.props.children==='참여 수락').props.onClick();tree=h.render(props);
 assert.equal(calls[1].action,'confirmStockParticipation');assert.equal(calls[1].payload.ownerId,'o');assert.equal(tree.some(n=>n.props.children==='참여 수락'),false);
});

test('existing stock picker reuses original identity and allocation while excluding read-only quantity submission',async()=>{
 const h=await harness('components/ExistingEventStockDialog.jsx'),picked=[];
 const item={id:'original',name:'Product',creatorName:'Artist',price:100,warehouse:10,allocations:[{projectId:'event',initial:5,price:0}]};
 const props={items:[item,{id:'blocked',name:'Readonly',quantityEditable:false}],projectId:'event',onClose(){},onPick:(...args)=>picked.push(args)};
 let tree=h.render(props);tree.find(n=>n.type==='select').props.onChange({target:{value:'original'}});tree=h.render(props);
 assert.equal(tree.find(n=>n.type==='input'&&n.props.type==='number').props.value,'5');
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(picked[0][0].id,'original');assert.equal(picked[0][1].quantity,5);assert.equal(picked[0][1].price,0);
 tree=h.render(props);tree.find(n=>n.type==='select').props.onChange({target:{value:'blocked'}});tree=h.render(props);
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(picked.length,1);
});


test('creator field searches event/global creators, adds without selling rights, creates direct profiles and links accounts',async()=>{
 const h=await harness('components/CreatorField.jsx'),calls=[];let value={};
 const request=async(url,options)=>{if(!options)return url.includes('searchAccounts')?{accounts:[{id:'account',nickname:'계정'}]}:{artists:[{id:'profile',owner_id:'owner',display_name:'검색 제작자',registered:false,linked_user_id:'account'}]};const cmd=JSON.parse(options.body);calls.push(cmd);return {ownerId:cmd.action==='createEventCreator'?'direct':'owner',profileId:cmd.action==='createEventCreator'?'direct-profile':'profile',linked:cmd.action==='linkEventArtistAccount'};};
 const props=()=>({creators:[{ownerId:'event-owner',profileId:'event-profile',label:'행사 제작자',linked:true}],value,onChange:next=>{value=next;},request,project:{id:'event',boothId:'booth'},allowDirect:true});
 let tree=h.render(props());assert.equal(tree.find(n=>n.type==='select').props.children[1][0].props.value,'event-owner');
 tree.find(n=>n.type==='button'&&n.props.children==='제작자 검색').props.onClick();h.render(props());await h.flush();tree=h.render(props());tree.find(n=>n.props['aria-label']==='제작자 검색어').props.onChange({target:{value:'검색'}});tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='검색').props.onClick();tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='행사에 추가').props.onClick();assert.equal(value.ownerId,'owner');assert.equal(calls[0].payload.role,'none');
 tree=h.render(props());tree.find(n=>n.type==='button'&&n.props.children==='직접 입력').props.onClick();tree=h.render(props());tree.find(n=>n.type==='input'&&n.props.maxLength===80).props.onChange({target:{value:'임의 제작자'}});tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='제작자 추가').props.onClick();assert.equal(value.ownerId,'direct');assert.equal(calls[1].action,'createEventCreator');
 tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='계정 연결').props.onClick();h.render(props());await h.flush();tree=h.render(props());tree.find(n=>n.props['aria-label']==='제작자 검색어').props.onChange({target:{value:'계정'}});tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='검색').props.onClick();tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='연결').props.onClick();assert.equal(calls[2].action,'linkEventArtistAccount');assert.equal(calls[2].payload.profileId,'direct-profile');assert.equal(calls[2].payload.targetUserId,'account');assert.equal(calls[2].payload.role,undefined);
});


test('creator search mutation freezes editing after response loss and retries inside the open dialog with the same ID',async()=>{
 const h=await harness('components/CreatorField.jsx'),calls=[];let value={};
 const request=async(url,options)=>{if(!options)return {artists:[{id:'profile',owner_id:'owner',display_name:'대상',registered:false}]};const cmd=JSON.parse(options.body);calls.push(cmd);if(calls.length===1)throw Object.assign(new Error('network'),{status:503});return {ownerId:'owner',profileId:'profile'};};
 const props=()=>({creators:[],value,onChange:next=>{value=next;},request,project:{id:'e',boothId:'b'},allowDirect:true});
 let tree=h.render(props());tree.find(n=>n.type==='button'&&n.props.children==='제작자 검색').props.onClick();h.render(props());await h.flush();tree=h.render(props());tree.find(n=>n.props['aria-label']==='제작자 검색어').props.onChange({target:{value:'대상'}});tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='검색').props.onClick();tree=h.render(props());await tree.find(n=>n.type==='button'&&n.props.children==='행사에 추가').props.onClick();tree=h.render(props());
 assert.equal(tree.find(n=>n.type==='select').props.disabled,true);
 const dialog=tree.find(n=>n.type==='dialog');const retry=nodes(dialog).find(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인');assert.ok(retry);await retry.props.onClick();assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(value.ownerId,'owner');
});


test('event creator addition permits a direct name after an empty search and keeps the same registration request on retry',async()=>{
 const calls=[];const request=async(url,options)=>{if(options){const cmd=JSON.parse(options.body);calls.push(cmd);if(calls.length===1)throw Object.assign(new Error('network'),{status:503});return {added:true};}return url.includes('searchArtists')?{artists:[]}:{profiles:[],staff:[]};};
 const h=await harness('components/EventAccessPanel.jsx'),props={request,project:{id:'e',boothId:'b'}};
 h.render(props);await h.flush();let tree=h.render(props);tree.find(n=>n.type==='button'&&n.props.children==='제작자 추가').props.onClick();h.render(props);await h.flush();tree=h.render(props);
 tree.find(n=>n.type==='input'&&n.props.placeholder==='제작자 이름·닉네임·아이디·이메일').props.onChange({target:{value:'신규 제작자'}});tree=h.render(props);await tree.find(n=>n.type==='form'&&n.props.className==='event-account-search').props.onSubmit({preventDefault(){}});tree=h.render(props);
 assert.equal(tree.filter(n=>n.type==='li').length,0);tree.find(n=>n.type==='button'&&n.props.children==='새 제작자 등록').props.onClick();tree=h.render(props);
 const form=tree.find(n=>n.type==='form'&&nodes(n).some(c=>c.type==='button'&&c.props.children==='제작자 등록'));assert.ok(form);assert.ok(nodes(form).some(n=>n.type==='input'&&n.props.value==='신규 제작자'));
 await form.props.onSubmit({preventDefault(){}});tree=h.render(props);assert.equal(calls[0].action,'createEventCreator');assert.equal(calls[0].payload.name,'신규 제작자');assert.equal(calls[0].payload.projectId,'e');
 const retry=nodes(tree.find(n=>n.type==='dialog')).find(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인');assert.ok(retry);await retry.props.onClick();assert.deepEqual(calls[0],calls[1]);
});


test('inventory allocation manager stages recovery and allocation, validates the whole plan and confirms one save',async()=>{
 const saved=[];const h=await harness('components/InventoryAllocationManager.jsx',{'./PosUI':{Input:'Input'},'../utils/inventoryAllocationPlan':{allocationPlan}});
 const props={item:{id:'s',version:1,totalStock:30,warehouse:0,minimumTotalStock:30,allocations:[{projectId:'a',initial:10,sold:7,remaining:3},{projectId:'b',initial:20,sold:0,remaining:20}]},events:[{id:'a',name:'A 행사',archived_at:'2026',canReturn:true},{id:'b',name:'B 행사',operator:true}],onSave:async value=>{saved.push(value);},history:[{id:'history',at:'2026-10-23',actorId:'operator',change:{before:20,after:30},changes:[]}]};
 let tree=h.render(props);assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='변경 요약 · 저장').props.disabled,true);assert.ok(tree.some(n=>n.type==='summary'&&n.props.children==='이력 보기'));
 assert.equal(tree.find(n=>n.type==='Input'&&n.props['aria-label']==='A 행사 행사 배정 수량').props.disabled,true);
 tree.find(n=>n.type==='button'&&n.props.children==='3개 회수').props.onClick();tree=h.render(props);
 tree.find(n=>n.type==='Input'&&!n.props['aria-label']).props.onChange('40');tree=h.render(props);tree.find(n=>n.type==='Input'&&n.props['aria-label']==='B 행사 행사 배정 수량').props.onChange('30');tree=h.render(props);
 assert.ok(tree.some(n=>n.type==='span'&&n.props.children==='변경 3건'));
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=h.render(props);await tree.find(n=>n.type==='button'&&n.props.children==='저장').props.onClick();assert.equal(saved.length,1);assert.equal(saved[0].totalStock,40);assert.equal(saved[0].allocations.find(a=>a.projectId==='a').quantity,7);assert.equal(saved[0].allocations.find(a=>a.projectId==='b').quantity,30);
 tree.find(n=>n.type==='Input'&&n.props['aria-label']==='B 행사 행사 배정 수량').props.onChange('50');tree=h.render(props);assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='변경 요약 · 저장').props.disabled,true);assert.ok(tree.some(n=>n.props['aria-invalid']===true));
});


test('event stock panel has no reason field, edits only current event, recalculates free stock and submits one plan',async()=>{
 const calls=[];const h=await harness('components/EventStockAllocationPanel.jsx',{'./PosUI':{Input:'Input'},'../utils/inventoryAllocationPlan':{allocationPlan}});
 const props={item:{id:'s',totalStock:30,warehouse:0,minimumTotalStock:30,allocations:[{projectId:'a',initial:10,sold:0,remaining:10},{projectId:'b',initial:20,sold:7,remaining:13}]},event:{id:'a',name:'현재 행사'},events:[{id:'a',name:'현재 행사',operator:true},{id:'b',name:'다른 행사',operator:true}],onSave:async value=>{calls.push(value);}};
 let tree=h.render(props);assert.equal(tree.some(n=>n.type==='select'),false);assert.equal(tree.some(n=>n.type==='Input'&&n.props['aria-label']==='다른 행사 행사 배정 수량'),false);assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='저장').props.disabled,true);
 tree.find(n=>n.type==='Input'&&n.props['aria-label']==='총재고').props.onChange('40');tree=h.render(props);tree.find(n=>n.type==='Input'&&n.props['aria-label']==='이 행사 배정 수량').props.onChange('15');tree=h.render(props);assert.ok(tree.some(n=>n.type==='strong'&&n.props.children[0]==='미배정 '&&n.props.children[1]===5));
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(calls.length,1);assert.equal(calls[0].totalStock,40);assert.equal(calls[0].allocations.length,1);assert.equal(calls[0].allocations[0].projectId,'a');assert.equal(calls[0].allocations[0].quantity,15);
 tree.find(n=>n.type==='Input'&&n.props['aria-label']==='이 행사 배정 수량').props.onChange('25');tree=h.render(props);assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='저장').props.disabled,true);assert.ok(tree.some(n=>n.props['aria-invalid']===true));
});


test('ended event stock only recovers remaining quantity and opted-out stock remains read-only',async()=>{
 const h=await harness('components/EventStockAllocationPanel.jsx',{'./PosUI':{Input:'Input'},'../utils/inventoryAllocationPlan':{allocationPlan}}),calls=[];
 const props={item:{totalStock:10,warehouse:0,minimumTotalStock:10,allocations:[{projectId:'e',initial:10,sold:7,remaining:3}]},event:{id:'e',name:'종료 행사'},events:[{id:'e',name:'종료 행사',archived_at:'2026',canReturn:true}],onSave:async value=>{calls.push(value);}};
 let tree=h.render(props);assert.equal(tree.some(n=>n.type==='Input'&&n.props['aria-label']==='이 행사 배정 수량'),false);tree.find(n=>n.type==='button'&&n.props.children==='3개 회수').props.onClick();tree=h.render(props);await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(calls[0].allocations[0].quantity,7);assert.equal(calls[0].totalStock,10);
 tree=h.render({...props,busy:true,item:{...props.item,quantityEditable:false,quantityReadOnlyReason:'제작자가 재고 수정을 허용하지 않았어요 (조회만 가능)'}});assert.ok(tree.filter(n=>n.type==='Input').every(n=>n.props.disabled));assert.ok(tree.some(n=>n.type==='p'&&n.props.children==='제작자가 재고 수정을 허용하지 않았어요 (조회만 가능)'));
});


test('event inventory expands only operator/owned context and binds its save to the current event',async()=>{
 for(const manager of [false,true]){
  const calls=[],reads=[];const request=async(url,options)=>{if(options){const command=JSON.parse(options.body);calls.push(command);return {inventory:{id:'s',ownerId:'maker'}};}reads.push(url);if(url.includes('workspace=home'))return {profiles:[]};if(url.includes('stockParticipants'))return {profiles:[{owner_id:'maker',display_name:'제작자'}]};return {inventory:[{id:'s',ownerId:'maker',version:2,allocations:[{projectId:'e',productId:'p',initial:10}]}],events:[{id:'e',operator:true},{id:'other',operator:true}]};};
  const h=await harness('pages/PersonalInventory.jsx'),props={request,routeHash:'#/products/p?projectId=e',navigate(){},event:{id:'e',boothId:'b',permissions:{canConfigure:true,canManage:manager}},eventProducts:[]};h.render(props);await h.flush();h.render(props);await h.flush();const tree=h.render(props),catalog=tree.find(n=>n.type==='EventSalesCatalog'),detail=catalog.props.renderProduct(catalog.props.items[0],{id:'p'});
  const stockRead=reads.find(url=>url.includes('artists=stock'));assert.equal(new URLSearchParams(stockRead.split('?')[1]).has('projectId'),!manager);
  await detail.props.onSaveStockPlan({totalStock:20,allocations:[{projectId:'e',quantity:15}]});assert.equal(calls[0].action,'saveArtistStockPlan');assert.equal(calls[0].payload.currentProjectId,'e');assert.equal(calls[0].payload.ownerId,'maker');assert.equal(calls[0].payload.version,2);
 }
});


test('event product list hides products removed from the event while keeping active ones',async()=>{
 const h=await harness('components/EventSalesCatalog.jsx');
 const items=[{id:'kept',name:'남은 상품',allocations:[{projectId:'e',productId:'a'}]},{id:'gone',name:'제거한 상품',allocations:[{projectId:'e',productId:'r'}]},{id:'missing',name:'응답에 없는 상품',allocations:[{projectId:'e',productId:'x'}]}];
 const names=tree=>tree.filter(n=>n.props?.className==='management-name-link').map(n=>n.props['aria-label']);
 assert.deepEqual(names(h.render({items,event:{id:'e'},products:[{id:'a',isActive:true},{id:'r',isActive:false}]})),['남은 상품 상세보기']);
 assert.deepEqual(names(h.render({items,event:{id:'e'},products:[{id:'a',isActive:true}]})),['남은 상품 상세보기']);
});
test('event product list displays event creator on desktop and mobile without changing inventory ownership',async()=>{
 const h=await harness('components/EventSalesCatalog.jsx');
 const item={id:'stock',name:'상품',creatorName:'원본 제작자',allocations:[{projectId:'e',productId:'p'}]};
 const props={items:[item],event:{id:'e'},products:[{id:'p',creatorName:'원본 제작자',eventCreator:{name:'연결 제작자'}}]};
 const labels=tree=>tree.filter(n=>n.props?.['data-label']==='제작자'||n.props?.className==='management-mobile-meta').map(n=>n.props.children);
 assert.deepEqual(labels(h.render(props)),['연결 제작자','연결 제작자']);
 assert.deepEqual(labels(h.render({...props,products:[{id:'p',creatorName:'원본 제작자',eventCreator:null}]})),['미연결','미연결']);
 assert.equal(item.creatorName,'원본 제작자');
});

test('event creator display keeps original and historical creator values separate',()=>{
 const product={creatorName:'원본 제작자',eventCreator:{name:' 연결 제작자 '}};
 assert.equal(eventCreatorNameOf(product),'연결 제작자');
 assert.equal(eventCreatorNameOf({creatorName:'과거 제작자'}),'과거 제작자');
 assert.equal(eventCreatorNameOf({...product,eventCreator:null}),'미연결');
 assert.equal(product.creatorName,'원본 제작자');
});


test('sales cards show the mapped event creator instead of the original inventory owner',async()=>{
 const h=await harness('pages/SalesPage.jsx',{
  '../components/PageLayout':{PageIntro:'PageIntro',PageTabs:'PageTabs'},
  '../components/PosUI':{ItemButton:'ItemButton'},
  '../utils/productDisplay':{won:String,eventCreatorNameOf,productNameWithoutCreator}
 });
 const tree=h.render({project:{id:'e'},purchaseTab:'products',visibleProducts:[{id:'p',name:'상품',creatorName:'원본',eventCreator:{name:'연결 제작자'}}],visibleBundles:[],creators:['연결 제작자'],creatorFilter:'all',availableStock:()=>1,cart:[],total:0});
 assert.equal(tree.find(n=>n.type==='ItemButton').props.creatorName,'연결 제작자');
});


test('event creation offers empty, template and restore, preserving template request on uncertain retry',async()=>{
 const calls=[],opened=[];let fail=true,name='새 행사';
 const h=await harness('pages/ProjectsPage.jsx');
 const props=()=>({creating:true,projects:[{id:'e',name:'원본',boothId:'b',permissions:{canManage:true}}],booths:[],newProjectName:name,setNewProjectName:value=>{name=value;},navigate:p=>opened.push(p),onManageProject:async(project,action,payload)=>{calls.push({project,action,payload});if(fail){fail=false;throw new Error('응답 유실');}return {project:{id:'copy'}};},onSelectProject:p=>opened.push(p.id)});
 let tree=h.render(props());tree.find(n=>n.type==='button'&&n.props.children==='지난 행사 구성 가져오기').props.onClick();tree=h.render(props());
 tree.find(n=>n.type==='select').props.onChange({target:{value:'e'}});
 tree.find(n=>n.type==='Input'&&n.props.type==='password').props.onChange('password');tree=h.render(props());
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=h.render(props());
 assert.equal(tree.find(n=>n.type==='button'&&n.props.children==='백업 파일에서 복원').props.disabled,true);
 assert.ok(tree.find(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인'));
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(calls.length,2);assert.equal(calls[0].payload.requestId,calls[1].payload.requestId);assert.equal(opened.at(-1),'copy');
});

test('management navigation has exactly three sections and lifecycle operations belong to data management',async()=>{
 const h=await harness('components/ProjectNavigation.jsx');const project={id:'e',name:'행사'};
 const links=h.render({page:'projectDelete',project,navigate(){}}).filter(n=>n.type&&n.props?.page);
 assert.deepEqual(links.filter(n=>n.props.className?.includes('event-side-link')).map(n=>n.props.children),['행사 정보','정산 마감','데이터·관리']);
 assert.equal(links.find(n=>n.props.children==='데이터·관리').props['aria-current'],'page');
 const m=await harness('pages/ProjectManagementPage.jsx',{'../components/EventSettlementPanel':{default:'EventSettlementPanel'},'../components/EventAccessPanel':{default:'EventAccessPanel'},'../components/ProjectNavigation':{default:'ProjectNavigation'}});
 const tree=m.render({page:'projectBackup',project,navigate(){},onManageProject(){}});
 assert.ok(tree.find(n=>n.type==='button'&&n.props.children==='백업 다운로드'));
 assert.ok(tree.find(n=>n.type==='h2'&&n.props.children==='위험 구역'));
 assert.equal(tree.some(n=>n.type==='button'&&n.props.children==='새 행사로 복제'),false);
});


test('restore previews sales and settlement and retries the same request without overwriting an event',async()=>{
 const calls=[];let fail=true;
 const h=await harness('pages/ProjectRestorePage.jsx',{'../components/ProjectNavigation':{default:'ProjectNavigation',EventLink:'EventLink'}});
 const props={booths:[{id:'b',role:'owner'}],navigate(){},onManageProject:async(project,action,payload)=>{calls.push({project,action,payload});if(fail){fail=false;throw new Error('응답 유실');}return{project:{id:'restored',name:'복원'}};}};
 const backup={format:'my-booth-project',version:2,project:{name:'이전 행사'},products:[],bundles:[],sales:[{total:1200}],closure:{closed_at:'2026-10-23'}};
 let tree=h.render(props);await tree.find(n=>n.type==='input'&&n.props.type==='file').props.onChange({target:{files:[{name:'event.json',size:100,text:async()=>JSON.stringify(backup)}]}});tree=h.render(props);
 assert.ok(tree.find(n=>n.type==='dd'&&n.props.children==='마감'));
 tree.find(n=>n.type==='Input'&&n.props.type==='password').props.onChange('password');tree=h.render(props);
 await tree.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=h.render(props);
 await tree.find(n=>n.type==='button'&&n.props.children==='같은 복원 요청 다시 확인').props.onClick({preventDefault(){}});
 assert.equal(calls[0].project,null);assert.equal(calls[0].action,'restoreProject');assert.equal(calls[0].payload.boothId,'b');assert.equal(calls[0].payload.requestId,calls[1].payload.requestId);
});


test('event information edits name and dates in one form and requests password only in the save dialog',async()=>{
 const calls=[];let fail=true;
 const h=await harness('pages/ProjectManagementPage.jsx',{'../components/EventSettlementPanel':{default:'EventSettlementPanel'},'../components/EventAccessPanel':{default:'EventAccessPanel'},'../components/ProjectNavigation':{default:'ProjectNavigation'}});
 const props={page:'project',project:{id:'e',boothId:'b',name:'행사'},request:async()=>({schedule:{starts_on:'2026-11-01',ends_on:'2026-11-02'}}),onManageProject:async(p,action,payload)=>{calls.push({p,action,payload});if(fail){fail=false;throw new Error('응답 유실');}}};
 h.render(props);await h.flush();let tree=h.render(props);let form=tree.find(n=>n.type==='form'&&n.props.className.includes('event-info-form'));
 assert.equal(nodes(form).some(n=>n.props?.type==='password'),false);
 nodes(form).find(n=>n.type==='Input').props.onChange('행사 새 이름');nodes(form).find(n=>n.props?.type==='date').props.onChange({target:{value:'2026-11-03'}});
 tree=h.render(props);form=tree.find(n=>n.type==='form'&&n.props.className.includes('event-info-form'));await form.props.onSubmit({preventDefault(){}});assert.equal(calls.length,0);
 tree=h.render(props);let dialog=tree.find(n=>n.type==='dialog');nodes(dialog).find(n=>n.type==='Input'&&n.props.type==='password').props.onChange('password');tree=h.render(props);dialog=tree.find(n=>n.type==='dialog');
 await nodes(dialog).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});tree=h.render(props);dialog=tree.find(n=>n.type==='dialog');assert.ok(nodes(dialog).find(n=>n.type==='button'&&n.props.children==='같은 요청 다시 확인'));
 await nodes(dialog).find(n=>n.type==='form').props.onSubmit({preventDefault(){}});assert.equal(calls[0].action,'updateProjectInfo');assert.equal(calls[0].payload.name,'행사 새 이름');assert.equal(calls[0].payload.startsOn,'2026-11-03');assert.equal(calls[0].payload.requestId,calls[1].payload.requestId);
});

test('event creators use role controls and delete instead of participation toggles, and hide removed and unassigned profiles',async()=>{
 const calls=[];let deleted=false,changed=0;
 const request=async(url,options)=>{if(options){calls.push(JSON.parse(options.body));deleted=true;return {removed:true};}return{profiles:[{id:'p',owner_id:'o',display_name:'제작자',status:deleted?'ended':'active',version:1,linked_user_id:'user',product_count:1},{owner_id:'unassigned',display_name:'미지정',status:'active',version:0}],staff:[]};};
 const h=await harness('components/EventAccessPanel.jsx');const props={request,project:{id:'e',boothId:'b'},onChange:()=>{changed++;}};
 h.render(props);await h.flush();let tree=h.render(props);assert.equal(tree.some(n=>n.type==='h2'&&n.props.children==='행사 일정'),false);assert.equal(tree.some(n=>n.type==='button'&&n.props.children==='참여 종료'),false);assert.ok(tree.find(n=>n.type==='select'));
 await tree.find(n=>n.type==='button'&&n.props.children==='삭제').props.onClick();tree=h.render(props);assert.equal(calls[0].action,'removeEventArtist');assert.equal(calls[0].payload.ownerId,'o');assert.equal(changed,1);assert.equal(tree.some(n=>n.type==='button'&&n.props.children==='삭제'),false);
});


test('personal sales search submits and resets; table sorts numeric amounts in both directions',async()=>{
 const h=await harness('components/PersonalSalesHistory.jsx',{'./LoadingState':{default:'LoadingState'}});
 const request=async()=>({events:[{projectId:'event',eventName:'행사',sales:[
  {time:'2026-10-25',items:[{name:'상품 A',quantity:2,amount:900}]},
  {time:'2026-10-26',items:[{name:'상품 B',quantity:10,amount:10000}]}
 ]}]});
 const props={request};h.render(props);await h.flush();let tree=h.render(props);
 const names=()=>tree.filter(n=>n.type==='td'&&['상품 A','상품 B'].includes(n.props.children)).map(n=>n.props.children);
 assert.deepEqual(names(),['상품 B','상품 A']);
 tree.find(n=>n.type==='button'&&n.props.children[0]==='판매금액').props.onClick();tree=h.render(props);
 assert.deepEqual(names(),['상품 A','상품 B']);
 assert.ok(tree.some(n=>n.type==='th'&&n.props['aria-sort']==='ascending'));
 tree.find(n=>n.type==='button'&&n.props.children[0]==='판매금액').props.onClick();tree=h.render(props);
 assert.deepEqual(names(),['상품 B','상품 A']);
 tree.find(n=>n.type==='input'&&n.props.type==='search').props.onChange({target:{value:'상품 A'}});tree=h.render(props);
 assert.equal(names().length,2);
 tree.find(n=>n.type==='form'&&n.props.role==='search').props.onSubmit({preventDefault(){}});tree=h.render(props);
 assert.deepEqual(names(),['상품 A']);
 tree.find(n=>n.type==='button'&&n.props.children==='검색 조건 초기화').props.onClick();tree=h.render(props);
 assert.equal(names().length,2);
});


test('event schedule badges use Korean calendar days and preserve archived and unknown schedules',()=>{
 const event={startsOn:'2026-12-05',endsOn:'2026-12-07'};
 assert.deepEqual(eventSchedule(event,'2026-12-03'),{status:'upcoming',label:'진행 예정',countdown:'D-2',period:'26.12.05~12.07'});
 assert.equal(eventSchedule(event,'2026-12-05').countdown,'D-DAY');
 assert.equal(eventSchedule(event,'2026-12-06').countdown,'종료 D-1');
 assert.equal(eventSchedule(event,'2026-12-07').countdown,'오늘 종료');
 assert.equal(eventSchedule(event,'2026-12-08').status,'ended');
 assert.equal(eventSchedule({...event,archivedAt:'2026'},'2026-12-03').countdown,'');
 assert.equal(eventSchedule({},'2026-12-03').status,'unscheduled');
 assert.equal(eventSchedule({startsOn:'2026-02-30',endsOn:'2026-03-01'},'2026-02-01').period,'');
 assert.equal(eventSchedule({startsOn:'2026-12-31',endsOn:'2027-01-01'},'2026-12-30').period,'26.12.31~27.01.01');
});


test('event list puts the nearest upcoming event first without changing the source order',()=>{
 const rows=[
  {id:'past',name:'지난 행사',startsOn:'2026-10-01',endsOn:'2026-10-02'},
  {id:'later',name:'나중 행사',startsOn:'2027-02-01',endsOn:'2027-02-02'},
  {id:'now',name:'진행 행사',startsOn:'2026-10-25',endsOn:'2026-10-27'},
  {id:'next',name:'가까운 행사',startsOn:'2026-12-05',endsOn:'2026-12-06'},
  {id:'unknown',name:'일정 없음'}
 ];
 assert.deepEqual(sortEventsBySchedule(rows,'2026-10-26').map(row=>row.id),['next','later','now','unknown','past']);
 assert.equal(rows[0].id,'past');
});


test('unlinked role changes save immediately and account linking searches accounts without role controls',async()=>{
 const calls=[];let linked=false,role=null,version=0;
 const view=()=>({profiles:[{id:'profile',owner_id:'owner',display_name:'제작자명',linked_user_id:linked?'account-b':null,requested_role:role,version,status:'active',booth_status:'proxy'}],staff:linked?[{user_id:'account-b',role,status:'active',version:1}]:[]});
 const request=async(url,options)=>{
  if(options){const command=JSON.parse(options.body);calls.push(command);if(command.action==='saveEventAccess'){role=command.payload.role;version++;return view();}linked=true;return {linked:true};}
  if(url.includes('searchAccounts'))return {accounts:[{id:'account-b',nickname:'계정닉네임'}]};return view();
 };
 const h=await harness('components/EventAccessPanel.jsx'),props={request,project:{id:'event',boothId:'booth'}};
 h.render(props);await h.flush();let tree=h.render(props);
 await tree.find(n=>n.type==='select').props.onChange({target:{value:'assistant'}});tree=h.render(props);
 assert.equal(calls[0].action,'saveEventAccess');assert.equal(calls[0].payload.ownerId,'owner');assert.equal(calls[0].payload.role,'assistant');assert.equal(tree.find(n=>n.type==='select').props.value,'assistant');
 assert.equal(tree.some(n=>n.type==='input'&&n.props.maxLength===100),true);
 tree.find(n=>n.type==='button'&&n.props.children==='+연결').props.onClick();h.render(props);await h.flush();tree=h.render(props);
 const popup=tree.find(n=>n.type==='dialog');assert.equal(nodes(popup).some(n=>n.type==='select'),false);
 tree.find(n=>n.type==='input'&&n.props.maxLength===100).props.onChange({target:{value:'계정'}});tree=h.render(props);
 await tree.find(n=>n.type==='form'&&n.props.className==='event-account-search').props.onSubmit({preventDefault(){}});tree=h.render(props);
 await tree.find(n=>n.type==='button'&&n.props.children==='연결').props.onClick();
 assert.equal(calls[1].action,'linkEventArtistAccount');assert.equal(calls[1].payload.role,undefined);assert.equal(calls[1].payload.targetUserId,'account-b');
});

test('event roles save both directions with current versions and show a role dropdown in every row',async()=>{
 const profiles=[{id:'operator',owner_id:'operator-owner',display_name:'운영자 제작자',linked_user_id:'admin',booth_role:'owner',status:'active'},
 {id:'maker',owner_id:'maker-owner',display_name:'참여 제작자',linked_user_id:'maker-account',status:'active'}];
 let staff=[{user_id:'maker-account',role:'seller',status:'active',version:2}],reads=0;
 const calls=[];const request=async(url,options)=>{
  if(!options){reads++;return {profiles,staff};}
  const command=JSON.parse(options.body);calls.push(command);
  assert.equal(command.action,'saveEventAccess');assert.equal(command.payload.projectId,'event');assert.equal(command.payload.boothId,'booth');assert.equal(command.payload.targetUserId,'maker-account');
  assert.equal(command.payload.version,staff[0].version);
  staff=[{...staff[0],role:command.payload.role,version:staff[0].version+1}];return {profiles,staff};
 };
 const changed=[];
 const h=await harness('components/EventAccessPanel.jsx',{'../utils/confirmAction':{confirmAction:()=>{throw new Error('role change must not confirm');}}}),props={request,project:{id:'event',boothId:'booth'},onChange:action=>changed.push(action)};
 h.render(props);await h.flush();let tree=h.render(props);
 const roleSelect=()=>tree.find(n=>n.type==='select'&&n.props['aria-label']==='참여 제작자 행사 권한');
 const operatorSelect=tree.find(n=>n.type==='select'&&n.props['aria-label']==='운영자 제작자 행사 권한');
 assert.equal(operatorSelect.props.value,'operator');assert.equal(operatorSelect.props.disabled,true);
 await operatorSelect.props.onChange({target:{value:'assistant'}});assert.equal(calls.length,0);
 assert.equal(roleSelect().props.value,'seller');assert.equal(roleSelect().props.disabled,false);
 for(const role of ['assistant','seller']){
  const saved=roleSelect().props.onChange({target:{value:role}});tree=h.render(props);assert.equal(roleSelect().props.disabled,true);
  await saved;tree=h.render(props);assert.equal(roleSelect().props.value,role);assert.equal(roleSelect().props.disabled,false);
 }
 assert.deepEqual(changed,['saveEventAccess','saveEventAccess']);assert.equal(reads,1);assert.equal(calls.length,2);assert.notEqual(calls[0].payload.requestId,calls[1].payload.requestId);
});

test('event role conflicts refresh the version and allow another selection',async()=>{
 const profiles=[{id:'maker',owner_id:'owner',display_name:'제작자',linked_user_id:'account',status:'active'}];
 let version=1,conflict=true;const calls=[];
 const request=async(url,options)=>{
  if(options?.method!=='POST')return {profiles,staff:[{user_id:'account',role:'seller',status:'active',version}]};
  const command=JSON.parse(options.body);calls.push(command);
  if(conflict){conflict=false;version=2;throw Object.assign(new Error('권한이 변경되었습니다.'),{status:409});}
  return {profiles,staff:[{user_id:'account',role:command.payload.role,status:'active',version:3}]};
 };
 const h=await harness('components/EventAccessPanel.jsx'),props={request,project:{id:'event',boothId:'booth'}};
 h.render(props);await h.flush();let tree=h.render(props);
 await tree.find(n=>n.type==='select').props.onChange({target:{value:'assistant'}});tree=h.render(props);
 assert.equal(tree.find(n=>n.type==='select').props.disabled,false);assert.ok(tree.some(n=>n.props.role==='alert'));
 await tree.find(n=>n.type==='select').props.onChange({target:{value:'assistant'}});tree=h.render(props);
 assert.equal(calls[1].payload.version,2);assert.equal(tree.find(n=>n.type==='select').props.value,'assistant');
});

test('event settings catalog shows local sales and stock while its cached inventory is older',async()=>{
 const h=await harness('components/EventSalesCatalog.jsx');
 const tree=h.render({event:{id:'event'},items:[{id:'inventory',name:'무료 상품',allocations:[{projectId:'event',productId:'p',initial:10,remaining:10,sold:0,price:1000}]}],products:[{id:'p',price:0,initialStockQty:10,stockQty:5,saleNumber:1}],sales:[{lines:[{type:'product',id:'p',qty:1},{type:'bundle',qty:1,subItems:[{productId:'p',qty:1}]}]},{voided:true,lines:[{type:'product',id:'p',qty:10}]}]});
 const cell=label=>tree.find(node=>node.type==='td'&&node.props['data-label']===label).props.children;
 assert.equal(cell('판매수량')[0],'2');assert.equal(cell('남은 재고')[0],'5');assert.equal(cell('배정 수량')[0],'10');assert.equal(cell('판매가')[0],'0');
});

test('sales navigation stays visible and event tools follow server capabilities',async()=>{
 for(const [permissions,expected] of [
  [{canViewPos:true},['판매']],
  [{ownerIds:['own']},['상품 관리','판매 현황']],
  [{canSell:true,canConfigure:true,ownerIds:['own']},['판매','상품 관리','판매 현황']],
  [{canSell:true,canConfigure:true,canManage:true,canSettle:true},['판매','상품 관리','판매 현황','행사 관리']]
 ]) {
  const h=await harness('components/PageLayout.jsx');
  const tree=h.render({page:'settings',navigate(){},project:{id:'e',name:'행사',permissions}},'AppHeader');
  const event=nodes(tree.find(n=>n.props['aria-label']==='행사 메뉴'));
  assert.equal(tree.some(n=>n.props['aria-label']==='주 메뉴'),false);
  assert.equal(tree.some(n=>n.props.className==='header-secondary'),false);
  assert.deepEqual(event.filter(n=>n.type==='a').map(n=>n.props.children.filter(c=>typeof c==='string')[0]),expected);
  assert.ok(event.some(n=>n.type==='button'&&n.props.children.includes('내 계정 ')));
 }
});

test('revenue and dashboard remain reachable through more while sales without an event opens the list',async()=>{
 const header=await harness('components/PageLayout.jsx'),routes=[];
 const props={page:'revenue',navigate:key=>routes.push(key)};
 let tree=header.render(props,'AppHeader');await header.flush();
 assert.equal(tree.find(n=>n.props.className==='header-select-event').props.href,'#/projects');
 assert.equal(tree.find(n=>n.props.className==='header-select-event').props.children,'행사 선택하기 →');
 assert.equal(tree.some(n=>n.props['aria-label']==='행사 메뉴'),false);
 tree.find(n=>n.type==='button'&&n.props['aria-controls']==='header-more-menu').props.onClick();
 tree=header.render(props,'AppHeader');await header.flush();
 const menu=nodes(tree.find(n=>n.props['aria-label']==='내 계정 메뉴'));
 assert.deepEqual(menu.filter(n=>n.type==='a').map(n=>n.props.href),['#/projects','#/inventory','#/dashboard','#/account']);
 assert.equal(menu.find(n=>n.props['aria-current']==='page').props.href,'#/account');
 header.listeners.get('keydown')({key:'Escape'});
 assert.equal(header.render(props,'AppHeader').some(n=>n.props.id==='header-more-menu'),false);
 const overview=await harness('pages/PersonalOverview.jsx');
 assert.equal(overview.render({request:async()=>({events:[]})}).find(n=>n.type==='h1').props.children,'수익현황');
});

test('event switcher shows current scope, dates and status and reuses guarded selection',async()=>{
 const h=await harness('components/PageLayout.jsx'),chosen=[];
 const projects=[{id:'a',boothId:'b',name:'현재 행사',startsOn:'2099-01-01',endsOn:'2099-01-02',permissions:{canSell:true}},{id:'v',name:'조회 행사',permissions:{canViewPos:true}}];
 let accepted=false;
 const props={page:'pos',navigate(){},project:projects[0],projects,onSelectProject:async p=>{chosen.push(p.id);return accepted;}};
 let tree=h.render(props,'AppHeader');await h.flush();
 tree.find(n=>n.props['aria-controls']==='header-event-list').props.onClick();
 tree=h.render(props,'AppHeader');await h.flush();
 const options=()=>tree.filter(n=>n.props.className==='event-switcher-option');
 assert.equal(options().length,2);assert.equal(options().find(n=>n.props['aria-current']==='true').props['aria-label'],'현재 행사 · 판매 화면 열기');
 assert.ok(JSON.stringify(tree).includes('99.01.01~01.02'));
 const viewer=()=>options().find(n=>n.props['aria-label']==='조회 행사 · 상품 목록 열기');
 await viewer().props.onClick();tree=h.render(props,'AppHeader');assert.ok(tree.some(n=>n.props.id==='header-event-list'));
 accepted=true;await viewer().props.onClick();tree=h.render(props,'AppHeader');assert.equal(tree.some(n=>n.props.id==='header-event-list'),false);
 assert.deepEqual(chosen,['v','v']);
});

test('event list retains calendar sections and selection without focus or aggregate cards',async()=>{
 const h=await harness('pages/ProjectsPage.jsx');
 const projects=[{id:'future',name:'예정',venue:'킨텍스',startsOn:'2099-01-01',endsOn:'2099-01-02',permissions:{canSell:true},summary:{total:999999}},{id:'live',name:'진행',startsOn:'2020-01-01',endsOn:'2090-01-01',permissions:{canSell:true}},{id:'unknown',name:'미설정',permissions:{canViewPos:true}},{id:'past',name:'종료',startsOn:'2020-01-01',endsOn:'2020-01-02',permissions:{canReadOwnHistory:true}}];
 const chosen=[];const tree=h.render({projects,selectedProject:projects[0],onSelectProject:p=>chosen.push(p.id)});
 const sections=tree.filter(n=>n.type==='section'&&n.props.className?.startsWith('event-picker-group '));
 assert.deepEqual(sections.map(n=>n.props['aria-labelledby']),['event-group-active','event-group-upcoming','event-group-unscheduled','event-group-past']);
 assert.equal(tree.filter(n=>n.type==='article').length,4);
 assert.ok(tree.some(n=>n.type==='PageIntro'&&n.props.title==='행사 목록'));
 assert.equal(tree.filter(n=>n.props.className==='event-current-label').length,1);
 assert.equal(JSON.stringify(tree).includes('집중'),false);assert.equal(JSON.stringify(tree).includes('999999'),false);
 assert.ok(JSON.stringify(tree).includes('킨텍스'));
 nodes(sections[1]).find(n=>n.props.className==='event-list-open').props.onClick();assert.deepEqual(chosen,['future']);
 assert.equal(tree.some(n=>n.type==='details'),false);
 const managed=h.render({projects:[{...projects[0],permissions:{canManage:true,canSell:true}}]});
 assert.ok(managed.some(n=>n.type==='a'&&n.props.href==='#/project/manage?projectId=future'));
 assert.ok(managed.some(n=>n.type==='button'&&n.props.children==='이 행사 구성으로 새 행사 만들기'));
});

test('dashboard summarizes own revenue, filters only sales and keeps operator totals out',async()=>{
 const h=await harness('components/PersonalDashboard.jsx',{'./LoadingState':{default:'LoadingState'},'../utils/revenueSummary':{koreanDay:value=>new Date(value).toISOString().slice(0,10)}});
 const data={events:[{projectId:'e',closedAt:'2026-01-01',rows:[{net:900,paid:400,pending:500}],sales:[{time:'2020-01-01',items:[{amount:1000}]},{time:'2026-10-27',items:[{amount:2000}]},{time:'2026-10-27',voided:true,items:[{amount:99999}]}]}],inventory:[{remaining:7,warehouse:3,stockSummary:{sold:2,eventRemaining:4}}]};
 const props={data,events:[{id:'e',name:'행사',permissions:{canManage:true},summary:{total:888888}}]};
 let tree=h.render(props);
 assert.equal(tree.find(n=>n.type==='h1').props.children,'대시보드');assert.equal(tree.find(n=>n.type==='h1').props.className,undefined);
 const finance=()=>nodes(tree.find(n=>n.props.className==='dashboard-card home-finance'));
 assert.ok(finance().some(n=>n.type==='h2'&&n.props.children==='내 수익현황'));
 assert.ok(finance().some(n=>n.type==='a'&&n.props.href==='#/account/revenue'&&n.props.children==='수익현황 →'));
 assert.ok(finance().some(n=>n.type==='dd'&&n.props.children==='3000원'));
 assert.ok(finance().some(n=>n.type==='dd'&&n.props.children==='500원'));
 tree.find(n=>n.type==='button'&&n.props.children==='올해').props.onClick();tree=h.render(props);
 assert.ok(finance().some(n=>n.type==='dd'&&n.props.children==='2000원'));
 assert.ok(finance().some(n=>n.type==='dd'&&n.props.children==='500원'));
 assert.ok(tree.some(n=>n.type==='a'&&n.props.href==='#/projects'));
});

test('dashboard preserves warnings for every event and overview passes no focus state',async()=>{
 const h=await harness('components/PersonalDashboard.jsx',{'./LoadingState':{default:'LoadingState'},'../utils/revenueSummary':{koreanDay:()=> '2026-10-27'}});
 const tree=h.render({data:{events:[],inventory:[],waitingOrders:{e:2}},events:[{id:'e',name:'행사',startsOn:'2026-10-26',endsOn:'2026-10-28',permissions:{canManage:true,canSell:true,canConfigure:true},summary:{lowStockProducts:1}}]});
 assert.ok(tree.some(n=>n.type==='a'&&n.props.href==='#/sales?projectId=e'));
 assert.ok(tree.some(n=>n.type==='a'&&n.props.href==='#/products?projectId=e'));
 const overview=await harness('pages/PersonalOverview.jsx');
 const dashboard=overview.render({dashboard:true,request:async()=>({events:[]})}).find(n=>n.type==='PersonalDashboard');
 assert.equal(dashboard.props.pinnedProjectId,undefined);assert.equal(dashboard.props.onPinProject,undefined);
});
