import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import ts from 'typescript';
import {readFile} from 'node:fs/promises';
import {eventSchedule,sortEventsBySchedule} from '../src/utils/eventSchedule.js';
import {storageQuery} from '../api/lib/storageContract.js';
import {createApiContractContext} from '../src/utils/apiContractContext.js';
import {allocationPlan} from '../src/utils/inventoryAllocationPlan.js';
import {eventCreatorNameOf,productNameWithoutCreator} from '../src/utils/productDisplay.js';
import {filterInventory} from '../src/utils/inventorySearch.js';
const nodes=node=>!node||typeof node!=='object'?[]:[node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
async function harness(file,mocks={}) {
 let cursor=0,effectIndex=0;const states=[],effects=[],deps=[];
 const react={useId:()=> 'inventory-plan-form',useRef:value=>{const i=cursor++;return states[i]||=( {current:value});},useState:value=>{const i=cursor++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:(effect,dependencies)=>{const i=effectIndex++;if(!deps[i]||dependencies.some((v,j)=>!Object.is(v,deps[i][j]))){deps[i]=dependencies;effects.push(effect);}}};
 const base={react,'./EventStockAllocationPanel':{default:'EventStockAllocationPanel'},'../components/InventoryAllocationManager':{default:'InventoryAllocationManager'},'../components/CreatorField':{default:'CreatorField'},'./CreatorField':{default:'CreatorField'},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props}),Fragment:'fragment'},'./Icon':{default:'Icon'},'../components/Icon':{default:'Icon'},'../utils/eventSchedule':{eventSchedule,sortEventsBySchedule},'./SyncStatus':{SyncStatus:'SyncStatus'},'../hooks/usePageRoute':{pagePaths:{dashboard:'/dashboard',projects:'/projects',inventory:'/inventory',revenue:'/account/revenue',account:'/account',pos:'/sales',settings:'/products',log:'/settlement',project:'/project'}},'../utils/productDisplay':{won:String,uid:()=>'old-id',eventCreatorNameOf},'../utils/revenueSummary':{koreanDay:value=>String(value).slice(0,10)},'../components/LoadingState':{default:'LoadingState'},'../components/PersonalDashboard':{default:'PersonalDashboard'},'./ArtistStockPage':{StockItem:'StockItem'},'../components/PersonalInventoryCatalog':{default:'PersonalInventoryCatalog'},'../components/PersonalSalesHistory':{default:'PersonalSalesHistory'},'../components/PageLayout':{PageIntro:'PageIntro'},'../components/EventSalesCatalog':{default:'EventSalesCatalog'},'../components/PosUI':{ProductImage:'ProductImage',Input:'Input'},'../components/ExistingEventStockDialog':{default:'ExistingEventStockDialog'},'../components/EventProductDetail':{default:'EventProductDetail'},'../utils/confirmAction':{confirmAction:async()=>true},'./ProductCreatePage':{default:'ProductCreatePage'},'./InventoryImport':{default:'InventoryImport'},'../components/InventoryProductFields':{default:'InventoryProductFields'},'../utils/uploadProductImage':{uploadInventoryImage:async()=>({}),uploadProductImage:async()=>({})},'../utils/productImage':{prepareProductImage:async f=>f},'../hooks/useUnsavedChanges':{useUnsavedChanges:()=>()=>{},allowNavigation:async()=>true},...mocks};
 const context=vm.createContext({crypto:globalThis.crypto,URLSearchParams,URL,sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},alert:message=>{throw new Error(message);}});
 const source=await readFile(new URL('../src/'+file,import.meta.url),'utf8');
 const module=new vm.SourceTextModule(ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext}}).outputText,{context});
 await module.link(name=>{assert.ok(base[name],name);return new vm.SyntheticModule(Object.keys(base[name]),function(){for(const[k,v]of Object.entries(base[name]))this.setExport(k,v);},{context});});await module.evaluate();
 return {render:(props,exportName='default')=>{cursor=effectIndex=0;return nodes(module.namespace[exportName](props));},flush:async()=>{while(effects.length)effects.shift()();await new Promise(resolve=>setImmediate(resolve));}};
}
test('four primary menus and artist/assistant/operator event navigation follow server capabilities',async()=>{
 for(const [role,permissions,expected] of [
  ['viewer',{ownerIds:[],canSell:false,canViewPos:true,canConfigure:false,canManage:false},['판매 목록']],
  ['artist',{ownerIds:['own'],canSell:false,canConfigure:false,canManage:false},['행사 판매 설정','판매현황']],
  ['assistant',{ownerIds:['own'],canSell:true,canConfigure:true,canManage:false},['판매 목록','행사 판매 설정','판매현황']],
  ['operator',{ownerIds:[],canSell:true,canConfigure:true,canManage:true,canSettle:true},['판매 목록','행사 판매 설정','판매현황','행사 관리']]
 ]) {
  const h=await harness('components/PageLayout.jsx');const tree=h.render({page:'settings',navigate(){},project:{id:'e',name:'행사',permissions}},'AppHeader');
  const nav=tree.find(n=>n.props.className?.split(' ').includes('nav-screens'));assert.deepEqual(nodes(nav).filter(n=>n.type==='a').map(n=>n.props.children[1]),['대시보드','행사 선택','내 재고관리','마이페이지']);
  const event=tree.find(n=>n.props['aria-label']==='행사 메뉴');assert.deepEqual(nodes(event).filter(n=>n.type==='button').map(n=>n.props.children),expected,role);
 }
});
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
 let tree=h.render(props);assert.equal(tree.filter(n=>n.type==='tbody')[0].props.children.length,2);
 tree.find(n=>n.props.type==='search').props.onChange({target:{value:'아크릴'}});
 tree=h.render(props);tree.find(n=>n.props.role==='search').props.onSubmit({preventDefault(){}});
 tree=h.render(props);assert.equal(tree.filter(n=>n.type==='tbody')[0].props.children.length,1);
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


test('event access table shows nickname/product count, searches accounts in a dialog and links the chosen account',async()=>{
 const calls=[];let linked=false;
 const request=async(url,options)=>{
  if(options){const command=JSON.parse(options.body);calls.push(command);linked=true;return {linked:true};}
  if(url.includes('searchAccounts')){assert.ok(url.includes('projectId=event'));return {accounts:[{id:'account-b',nickname:'계정닉네임'}]};}
  return {profiles:[{id:'profile',owner_id:'owner',display_name:'제작자명',nickname:linked?'계정닉네임':null,linked_user_id:linked?'account-b':null,product_count:3,status:'active',booth_status:'proxy'}],staff:[]};
 };
 const h=await harness('components/EventAccessPanel.jsx');const props={request,project:{id:'event',boothId:'booth'}};
 h.render(props);await h.flush();let tree=h.render(props);
 assert.ok(tree.some(n=>n.type==='table'));assert.ok(tree.some(n=>n.type==='td'&&n.props.children?.[0]===3));
 const select=tree.find(n=>n.type==='select');assert.equal(select.props.disabled,false);assert.deepEqual(nodes(select).filter(n=>n.type==='option'&&n.props.value!=='none').map(n=>n.props.children),['부스참여자','부관리자']);
 select.props.onChange({target:{value:'assistant'}});h.render(props);await h.flush();tree=h.render(props);
 assert.ok(tree.some(n=>n.type==='dialog'));
 tree.find(n=>n.type==='input'&&n.props.maxLength===100).props.onChange({target:{value:'계정'}});tree=h.render(props);
 await tree.find(n=>n.type==='form'&&n.props.className==='event-account-search').props.onSubmit({preventDefault(){}});tree=h.render(props);
 await tree.find(n=>n.type==='button'&&n.props.children==='연결').props.onClick();tree=h.render(props);
 assert.equal(calls[0].action,'linkEventArtistAccount');assert.equal(calls[0].payload.targetUserId,'account-b');assert.equal(calls[0].payload.profileId,'profile');assert.equal(calls[0].payload.projectId,'event');assert.equal(calls[0].payload.role,'assistant');
 assert.equal(tree.find(n=>n.type==='select').props.disabled,false);
 await tree.find(n=>n.type==='select').props.onChange({target:{value:'assistant'}});
 assert.equal(calls[1].action,'saveEventAccess');assert.equal(calls[1].payload.role,'assistant');assert.equal(calls[1].payload.targetUserId,'account-b');
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
 tree.find(n=>n.type==='select').props.onChange({target:{value:'assistant'}});tree=h.render(props);
 await tree.find(n=>n.type==='button'&&n.props.children==='등록').props.onClick();
 assert.equal(calls[0].action,'addEventArtist');assert.equal(calls[0].payload.profileId,'artist-profile');assert.equal(calls[0].payload.role,'assistant');assert.equal(calls[0].payload.projectId,'event');
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
 tree.find(n=>n.type==='input'&&n.props.placeholder==='닉네임·아이디·이메일').props.onChange({target:{value:'신규 제작자'}});tree=h.render(props);await tree.find(n=>n.type==='form'&&n.props.className==='event-account-search').props.onSubmit({preventDefault(){}});tree=h.render(props);
 assert.equal(tree.filter(n=>n.type==='li').length,0);tree.find(n=>n.type==='button'&&n.props.children==='직접 입력').props.onClick();tree=h.render(props);
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
test('revenue belongs to the account menu and keeps its own page title',async()=>{
 const header=await harness('components/PageLayout.jsx');
 const tree=header.render({page:'revenue',navigate(){},project:{id:'e'}},'AppHeader');
 const nav=tree.find(n=>n.props.className?.split(' ').includes('nav-screens'));
 const active=nodes(nav).filter(n=>n.type==='a'&&n.props['aria-current']==='page');
 assert.equal(active.length,1);assert.equal(active[0].props.href,'#/account');
 assert.equal(tree.some(n=>n.props['aria-label']==='행사 메뉴'),false);
 const overview=await harness('pages/PersonalOverview.jsx');
 const revenue=overview.render({request:async()=>({events:[]})});
 assert.equal(revenue.find(n=>n.type==='h1').props.children,'수익현황');
 assert.equal(revenue.find(n=>n.type==='h1').props.className,'sr-only');
 const dashboard=overview.render({request:async()=>({events:[]}),dashboard:true});
 assert.ok(dashboard.some(n=>n.type==='PersonalDashboard'));
 assert.equal(dashboard.some(n=>n.type==='a'&&n.props.href==='#/account'),false);
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


test('dashboard combines current and future events in one panel in schedule order',async()=>{
 const h=await harness('components/PersonalDashboard.jsx',{'./LoadingState':{default:'LoadingState'},'../utils/revenueSummary':{koreanDay:value=>new Date(value).toISOString().slice(0,10)}});
 const props={data:{events:[],inventory:[],stockEvents:[]},events:[
  {id:'later',name:'나중 행사',venue:'벡스코',startsOn:'2099-12-05',endsOn:'2099-12-06',permissions:{canViewPos:true}},
  {id:'now',name:'현재 행사',venue:'킨텍스',startsOn:'2020-01-01',endsOn:'2090-12-31',permissions:{canSell:true}},
  {id:'earlier',name:'먼저 행사',venue:'세텍',startsOn:'2099-01-05',endsOn:'2099-01-06',permissions:{canViewPos:true}}
 ]};
 const tree=h.render(props);
 const panel=tree.find(n=>n.props.className==='dashboard-card home-events');
 assert.deepEqual(nodes(panel).filter(n=>n.type==='h3').map(n=>n.props.children),['현재 행사','먼저 행사','나중 행사']);
 assert.equal(tree.some(n=>n.props.className==='home-upcoming-list'),false);
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
