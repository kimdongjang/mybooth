import InventoryAllocationManager from '../components/InventoryAllocationManager';
import {useEffect,useRef,useState} from 'react';
import {StockItem} from './ArtistStockPage';
import InventoryImport from './InventoryImport';
import PersonalSalesHistory from '../components/PersonalSalesHistory';
import InventoryProductFields from '../components/InventoryProductFields';
import {uploadInventoryImage} from '../utils/uploadProductImage';
import {prepareProductImage} from '../utils/productImage';
import {useUnsavedChanges} from '../hooks/useUnsavedChanges';
import PersonalInventoryCatalog from '../components/PersonalInventoryCatalog';
import {ProductImage} from '../components/PosUI';
import {PageIntro} from '../components/PageLayout';
import EventSalesCatalog from '../components/EventSalesCatalog';
import ProductCreatePage from './ProductCreatePage';
import EventProductDetail from '../components/EventProductDetail';
import {confirmAction} from '../utils/confirmAction';

function ProductEditor({item,busy,onSave,onImage,onRemove}) {
 const [draft,setDraft]=useState(item);
 const clear=useUnsavedChanges(JSON.stringify(draft)!==JSON.stringify(item));
 return <article className="management-product"><div className="management-product-header inventory-detail-header"><div className="inventory-detail-identity"><h3>{item.name}</h3></div><div className="inventory-detail-actions"><button type="submit" form={`product-${item.id}`} className="management-add" disabled={busy}>수정</button><button type="button" className="inventory-delete-button" disabled={busy} onClick={onRemove}>상품 삭제</button></div></div><div className="management-product-body">
  <div className="management-image"><ProductImage imageUrl={item.imageUrl} name={item.name}/><label className="management-upload product-image-upload"><span>{item.imageUrl?'이미지 수정':'이미지 등록'}</span><input aria-label="상품 이미지 등록 또는 수정" type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)onImage(file);}}/></label></div>
  <form id={`product-${item.id}`} className="management-details" onSubmit={async e=>{e.preventDefault();try{await onSave(draft);clear();}catch{}}}><InventoryProductFields draft={draft} hideCreator products={[]} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))} disabled={busy}/></form>
 </div></article>;
}
export default function PersonalInventory({request,routeHash,navigate,event=null,eventProducts=[],onRemoveEventProduct}) {
 const [options,setOptions]=useState([]),[selection,setSelection]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
 const [draft,setDraft]=useState({name:'',price:0,stock:0,cost:0,goodsType:'',vtuberName:'',genre:''});
 const lock=useRef(false),batch=useRef(null),imports=useRef([]),created=useRef(null);
 const scope=options.find(o=>o.key===selection);
 const path=routeHash.split('?')[0],tool=event?(path==='#/products/new'?'eventNew':'list'):path.includes('/import')?'import':path.endsWith('/new')?'new':(path.endsWith('/sales')||path.endsWith('/movements'))?'sales':'list';
 const clear=useUnsavedChanges(tool==='new'&&Boolean(draft.name));
 useEffect(()=>{let active=true;(async()=>{
  const home=await request('/api/booths?workspace=home');
  let values=home.profiles.map(p=>({key:`own:${p.owner_id}`,ownerId:p.owner_id,owned:true,label:`내 재고 · ${p.display_name}`}));
  if(event?.permissions.canConfigure) {
   // Operators use the management endpoint; assistants receive event-limited profiles.
   const people=await request(`/api/booths?workspace=stockParticipants&projectId=${encodeURIComponent(event.id)}&boothId=${encodeURIComponent(event.boothId)}`);
   values=people.profiles.map(p=>({key:`event:${p.owner_id}`,ownerId:p.owner_id,boothId:event.boothId,projectId:event.id,profileId:p.profile_id,owned:home.profiles.some(own=>own.owner_id===p.owner_id),catalog:p.catalog!==false,stockOnly:Boolean(p.stockOnly),label:p.display_name,linked:Boolean(p.linked_user_id)}));
  } else if(event) values=values.filter(p=>event.permissions.ownerIds.includes(p.ownerId)).map(p=>({...p,boothId:event.boothId,projectId:event.id}));
  if(active){setOptions(values);setSelection(event?values[0]?.key||'':values.find(v=>v.key.startsWith('own:'))?.key||'');}
 })().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,event?.id]);
 const refreshCreators=async()=>{
  const people=await request(`/api/booths?workspace=stockParticipants&projectId=${encodeURIComponent(event.id)}&boothId=${encodeURIComponent(event.boothId)}`);
  const values=people.profiles.map(p=>({key:`event:${p.owner_id}`,ownerId:p.owner_id,profileId:p.profile_id,boothId:event.boothId,projectId:event.id,owned:options.find(option=>option.ownerId===p.owner_id)?.owned||false,catalog:p.catalog!==false,stockOnly:Boolean(p.stockOnly),label:p.display_name,linked:Boolean(p.linked_user_id)}));
  setOptions(values);return values;
 };
 const url=s=>`/api/booths?artists=stock&${new URLSearchParams(Object.fromEntries(Object.entries(s).filter(([k,v])=>['ownerId','boothId','projectId'].includes(k)&&v)))}`;
 const read=async s=>{
  const results=await Promise.all(options.filter(option=>option.catalog!==false).map(option=>request(url(event&&(event.permissions.canManage||option.owned)?{...option,projectId:undefined}:option))));
  return {...results[0],history:results.flatMap(result=>result.history||[]),stockEvents:[...new Map(results.flatMap(result=>result.events).map(row=>[row.id,row])).values()],quantityEditable:results.some(result=>result.quantityEditable!==false),inventory:results.flatMap(result=>result.inventory.map(item=>({...item,eventContexts:result.events}))),events:[...new Map(results.flatMap(result=>result.events).map(row=>[row.id,row])).values()].filter(row=>!event||row.id===event.id)};
 };
 const load=async s=>{const next=await read(s);setData(next);return next;};
 useEffect(()=>{setData(null);if(!scope)return;let active=true;read(scope).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selection,options,request]);
 const execute=async command=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setPending(command);
  try {const result=await request('/api/booths',{method:'POST',body:JSON.stringify(command)});await load(scope);setPending(null);return result;}
  catch(e){setError(e.message);if(e.status>=400&&e.status<500)setPending(null);throw e;}
  finally{lock.current=false;setBusy(false);}
 };
 const send=(action,details)=>execute({action,payload:{ownerId:data?.inventory.find(item=>item.id===details.id)?.ownerId||scope.ownerId,...(scope.boothId?{boothId:scope.boothId}:{}),...details,requestId:crypto.randomUUID()}});
 const image=async(item,file)=>{const prepared=await prepareProductImage(file),uploaded=await uploadInventoryImage(item.custodianId,item.inventoryId,prepared,item.ownerId||scope.ownerId);await send('saveArtistProduct',{ownerId:item.ownerId,id:item.id,version:item.version,product:{...item,imageUrl:uploaded.url}});};
 const disabled=busy||Boolean(pending);
 let detailId='';
 if(!event&&tool==='list'&&path!=='#/inventory'){try{detailId=decodeURIComponent(path.split('/').pop());}catch{}}
 const renderItem=item=><div key={`${selection}:${item.id}:${item.version}`}>
    {!event&&tool==='list'&&<ProductEditor onRemove={async()=>{if(await confirmAction('이 상품을 내 재고 목록에서 삭제할까요? 기존 행사와 판매 이력은 보존됩니다.')){try{await send('removeArtistStock',{id:item.id,version:item.version});navigate('inventory');}catch{}}}} item={item} busy={disabled} onSave={product=>send('saveArtistProduct',{id:item.id,version:item.version,product})} onImage={file=>image(item,file).catch(e=>setError(e.message))}/>}
    {!event&&tool==='list'?<InventoryAllocationManager key={item.version} item={item} events={data.events} history={(data.history||[]).filter(entry=>entry.inventoryId===item.id)} busy={disabled||item.quantityEditable===false} onSave={values=>send('saveArtistStockPlan',{id:item.id,version:item.version,...values})}/>:<StockItem item={item} events={data.events} busy={disabled||item.quantityEditable===false} embedded={Boolean(event)} eventOnly={Boolean(event)} lossOnly={tool==='loss'}
      onAdjust={(row,values)=>send('adjustArtistStock',{id:row.id,version:row.version,...values}).catch(()=>{})}
      onAllocate={(row,values)=>send('setArtistAllocation',{id:row.id,version:row.version,...values}).catch(()=>{})}
      onLoss={(row,values)=>send('recordArtistStockLoss',{id:row.id,version:row.version,...values}).catch(()=>{})}/>}
   </div>;
 let eventProductId='';
 if(event&&path.startsWith('#/products/')&&tool!=='eventNew'){try{eventProductId=decodeURIComponent(path.split('/').pop());}catch{}}
 const renderEventProduct=(item,product)=><EventProductDetail key={`${event.id}:${item.id}`} stockEvents={item.eventContexts||data.stockEvents||data.events} stockHistory={(data.history||[]).filter(entry=>entry.inventoryId===item.id)} stockDisabled={disabled||item.quantityEditable===false} onSaveStockPlan={values=>send('saveArtistStockPlan',{id:item.id,version:item.version,currentProjectId:event.id,...values})} creatorRequest={event.permissions.canManage?request:undefined} onRefreshCreators={refreshCreators} creatorOptions={options} canEditCreator={Boolean(event.permissions.canManage)} onSetCreator={creatorOwnerId=>send('setEventProductCreator',{id:item.id,projectId:event.id,version:item.version,creatorOwnerId})} item={item} product={product} products={eventProducts} event={event} disabled={disabled||Boolean(event.archivedAt||event.settlementClosedAt)||!(item.eventContexts||data.events).some(row=>row.id===event.id&&(row.detailEditable??(row.operator||row.artistEditable)))}
  onSave={async(patch,version)=>{const result=await send('saveEventArtistProduct',{id:item.id,version,projectId:event.id,product:patch});return {inventoryVersion:result.inventory.version};}}
  onImage={file=>file?image(item,file):send('saveArtistProduct',{id:item.id,version:item.version,product:{...item,imageUrl:null}})}
  onRemove={async()=>{if(await confirmAction('이 행사 상품을 목록과 판매에서 제거할까요? 배정 재고와 판매 이력은 보존됩니다.')){if(await onRemoveEventProduct(product.id)){await load(scope);navigate(`/products?projectId=${encodeURIComponent(event.id)}`);}}}}
  movementApi={async(action,payload)=>{
   const query=`/api/booths?artists=movements&${new URLSearchParams({ownerId:item.ownerId,boothId:event.boothId,projectId:event.id})}`;
   if(action==='recordStockMovement')await execute({action:'recordArtistStockLoss',payload:{ownerId:item.ownerId,boothId:event.boothId,id:item.id,projectId:event.id,version:payload.version,quantity:payload.quantity,reason:payload.reason,memo:payload.memo,requestId:payload.requestId}});
   else if(action!=='listStockMovements')throw new Error('지원하지 않는 재고 작업입니다.');
   return request(query);
  }}/>;
 const title=detailId?'상세정보':tool==='new'?'상품 등록':tool==='import'?(path.endsWith('/review')?'업로드 완료 · 편집':'재고 일괄등록'):tool==='sales'?'내 판매내역':'재고 목록';
 const canCreate=event&&!event.archivedAt&&!event.settlementClosedAt&&(event.permissions.canConfigure||data?.events.some(row=>row.id===event.id&&(row.detailEditable??(row.operator||row.artistEditable))));
 if(event&&tool==='eventNew')return <><ProductCreatePage creatorRequest={event.permissions.canManage?request:undefined} creatorProject={event} onRefreshCreators={refreshCreators} projectId={event.id} artists={options} allowDirectArtist={Boolean(event.permissions.canManage)} products={eventProducts} saving={busy} readOnly={!canCreate} onBack={()=>navigate('settings')} registerProduct={async product=>{
  const artist=options.find(option=>option.ownerId===product.ownerId);
  if(!artist&&!(event.permissions.canManage&&!product.ownerId&&product.artistName?.trim()))throw Object.assign(new Error('행사에 등록된 제작자를 선택해주세요.'),{status:400});
  const result=await execute({action:'registerEventArtistProduct',payload:{...(artist?{ownerId:artist.ownerId}:{artistName:product.artistName.trim()}),boothId:event.boothId,projectId:event.id,name:product.name,price:product.price,quantity:product.stockQty,goodsType:product.goodsType,vtuberName:product.vtuberName,genre:product.genre,requestId:product.id}});
  created.current=result.inventory;
  if(event.permissions.canConfigure){
   const people=await request(`/api/booths?workspace=stockParticipants&projectId=${encodeURIComponent(event.id)}&boothId=${encodeURIComponent(event.boothId)}`);
   const values=people.profiles.map(p=>({key:`event:${p.owner_id}`,ownerId:p.owner_id,boothId:event.boothId,projectId:event.id,profileId:p.profile_id,catalog:p.catalog!==false,stockOnly:Boolean(p.stockOnly),label:p.display_name,linked:Boolean(p.linked_user_id)}));
   setOptions(values);setSelection(current=>values.some(value=>value.key===current)?current:values[0]?.key||'');
  }
 }} saveImage={async file=>{if(!created.current)throw new Error('등록한 상품을 확인해주세요.');await image(created.current,file);}}/>{error&&<p role="alert" className="inventory-error">{error}</p>}</>;
 return <>
  {!event&&<nav className="event-subnav inventory-management-nav menu-tabs" aria-label="내 재고관리 하위 메뉴">{[['list','/inventory','내 재고관리'],['import','/inventory/import','재고 일괄등록'],['sales','/inventory/sales','내 판매내역']].map(([key,href,label])=><button key={key} type="button" aria-current={tool===key?'page':undefined} disabled={disabled} onClick={()=>navigate(key==='list'?'inventory':href)}>{label}</button>)}</nav>}
 <main id={event?'event-settings-panel-products':undefined} role={event?.permissions?.canConfigure?'tabpanel':undefined} aria-labelledby={event?.permissions?.canConfigure?'event-settings-tab-products':undefined} className={event?'page-content settings-page event-sales-settings':'page-content inventory-page personal-inventory-page'}>
  {!event&&tool!=='sales'?<>

  <header className="management-heading inventory-management-heading"><h2 tabIndex={-1}>{tool==='list'&&!detailId?'내 재고관리':title}</h2><div className="inventory-management-actions">{tool==='sales'?null:tool==='list'&&!detailId?<><button type="button" className="management-add" disabled={disabled} onClick={()=>navigate('/inventory/new')}>+ 새 상품 등록</button></>:tool==='import'?null:<button type="button" className="management-back" disabled={disabled} onClick={()=>navigate('inventory')}>← 상품 목록으로</button>}</div></header></>:event?<PageIntro title="행사 판매 설정" hideTitle/>:null}
  {error&&<p role="alert" className="inventory-error">{error}</p>}{pending&&!busy&&<button className="management-add" onClick={()=>execute(pending).catch(()=>{})}>같은 요청 다시 확인</button>}
  {scope&&data&&<>
   {tool==='new'&&<form className="account-form" onSubmit={async e=>{e.preventDefault();try{await send('createArtistStock',{...draft,price:Number(draft.price),cost:Number(draft.cost),quantity:Number(draft.stock)});clear();setDraft({...draft,name:'',stock:0});navigate('inventory');}catch{}}}><InventoryProductFields draft={draft} showPricing hideCreator products={[]} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))} disabled={disabled}/><label>입고 수량<input type="number" min="0" step="1" required value={draft.stock} onChange={e=>setDraft({...draft,stock:Number(e.target.value)})}/></label><button className="management-add" disabled={disabled}>상품 등록</button></form>}
  </>}
   {!event&&tool==='import'&&<InventoryImport ready={Boolean(scope&&data)} adminId={scope?.ownerId} navigate={navigate} review={path.endsWith('/review')} api={async(action,payload)=>{
    if(!scope)throw Object.assign(new Error('재고를 연결할 내 제작자 프로필을 먼저 등록해주세요.'),{status:400});
    if(action!=='importInventory')throw new Error('지원하지 않는 제작자 재고 작업입니다.');batch.current||=crypto.randomUUID();
    try{const result=await execute({action:'importArtistStock',payload:{ownerId:scope.ownerId,boothId:scope.boothId,products:payload.products,requestId:batch.current}});imports.current=result.inventory;batch.current=null;return result;}catch(error){if(error.status>=400&&error.status<500)batch.current=null;throw error;}
   }} saveImage={async(id,file)=>{const item=imports.current.find(i=>i.importId===id);if(item)await image(item,file);}} onRegistered={()=>load(scope)}/>}
   {!event&&tool==='sales'&&<PersonalSalesHistory request={request} items={data?.inventory||[]}/> }
   {scope&&data&&(event?<EventSalesCatalog key={event.id} productId={eventProductId} navigate={navigate} renderProduct={renderEventProduct} onAdd={canCreate?()=>navigate('productNew'):undefined} disabled={disabled} items={data.inventory} event={event} products={eventProducts} renderDetail={renderItem}/>:tool==='list'?<PersonalInventoryCatalog items={data.inventory} events={data.events} detailId={detailId} navigate={navigate} renderDetail={renderItem}/>:null)}
 </main></>;
}
