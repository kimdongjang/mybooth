import {useEffect,useRef,useState} from 'react';
import {StockItem} from './ArtistStockPage';
import InventoryImport from './InventoryImport';
import InventoryProductFields from '../components/InventoryProductFields';
import {uploadInventoryImage} from '../utils/uploadProductImage';
import {prepareProductImage} from '../utils/productImage';
import {useUnsavedChanges} from '../hooks/useUnsavedChanges';

function ProductEditor({item,busy,onSave,onImage}) {
 const [draft,setDraft]=useState(item);
 const clear=useUnsavedChanges(JSON.stringify(draft)!==JSON.stringify(item));
 return <details><summary>상품 정보</summary><form className="account-form" onSubmit={async e=>{e.preventDefault();try{await onSave(draft);clear();}catch{}}}>
  <InventoryProductFields draft={draft} showPricing hideCreator products={[]} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))} disabled={busy}/>
  <label>이미지<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e=>{if(e.target.files?.[0])onImage(e.target.files[0]);}}/></label>
  <button className="management-add" disabled={busy}>상품 정보 저장</button>
 </form></details>;
}
export default function PersonalInventory({request,routeHash,navigate,event=null}) {
 const [options,setOptions]=useState([]),[selection,setSelection]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(null);
 const [draft,setDraft]=useState({name:'',price:0,stock:0,cost:0,goodsType:'',vtuberName:'',genre:''});
 const lock=useRef(false),batch=useRef(null),imports=useRef([]);
 const scope=options.find(o=>o.key===selection);
 const path=routeHash.split('?')[0],tool=event?'list':path.includes('/import')?'import':path.endsWith('/new')?'new':path.endsWith('/movements')?'loss':'list';
 const clear=useUnsavedChanges(tool==='new'&&Boolean(draft.name));
 useEffect(()=>{let active=true;(async()=>{
  const home=await request('/api/booths?workspace=home');
  let values=home.profiles.map(p=>({key:`own:${p.owner_id}`,ownerId:p.owner_id,label:`내 재고 · ${p.display_name}`}));
  if(event?.permissions.canConfigure) {
   // Operators use the management endpoint; assistants receive event-limited profiles.
   const people=await request(`/api/booths?workspace=stockParticipants&projectId=${encodeURIComponent(event.id)}&boothId=${encodeURIComponent(event.boothId)}`);
   values=people.profiles.map(p=>({key:`event:${p.owner_id}`,ownerId:p.owner_id,boothId:event.boothId,projectId:event.id,label:p.display_name}));
  } else if(!event) {
   const lists=await Promise.all(home.booths.filter(b=>['owner','manager'].includes(b.role)).map(async b=>{
    const people=await request(`/api/booths?artists=participants&boothId=${encodeURIComponent(b.id)}`);
    return people.profiles.filter(p=>['active','proxy'].includes(p.participation)).map(p=>({key:`${b.id}:${p.owner_id}`,ownerId:p.owner_id,boothId:b.id,label:`${b.name} · ${p.display_name}`}));
   }));values.push(...lists.flat());
  } else values=values.filter(p=>event.permissions.ownerIds.includes(p.ownerId)).map(p=>({...p,boothId:event.boothId,projectId:event.id}));
  if(active){setOptions(values);setSelection(event?values[0]?.key||'':values.find(v=>v.key.startsWith('own:'))?.key||'');}
 })().catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,event?.id]);
 const url=s=>`/api/booths?artists=stock&${new URLSearchParams(Object.fromEntries(Object.entries(s).filter(([k,v])=>['ownerId','boothId','projectId'].includes(k)&&v)))}`;
 const load=async s=>{const next=await request(url(s));setData(next);return next;};
 useEffect(()=>{setData(null);if(!scope)return;let active=true;request(url(scope)).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[selection,options,request]);
 const execute=async command=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setPending(command);
  try {const result=await request('/api/booths',{method:'POST',body:JSON.stringify(command)});setPending(null);await load(scope);return result;}
  catch(e){setError(e.message);if(e.status>=400&&e.status<500)setPending(null);throw e;}
  finally{lock.current=false;setBusy(false);}
 };
 const send=(action,details)=>execute({action,payload:{ownerId:scope.ownerId,...(scope.boothId?{boothId:scope.boothId}:{}),...details,requestId:crypto.randomUUID()}});
 const image=async(item,file)=>{const prepared=await prepareProductImage(file),uploaded=await uploadInventoryImage(item.custodianId,item.inventoryId,prepared,scope.ownerId);await send('saveArtistProduct',{id:item.id,version:item.version,product:{...item,imageUrl:uploaded.url}});};
 const disabled=busy||Boolean(pending);
 return <main className="page-content inventory-page"><div className="page-body"><h1>{event?'행사 판매 설정':'재고관리'}</h1>
  {!event&&<nav className="page-tabs" aria-label="재고관리 메뉴">{[['inventory','재고목록'],['/inventory/new','상품추가'],['/inventory/import','엑셀 일괄등록'],['/inventory/movements','외부판매·로스']].map(([key,label])=><button key={key} onClick={()=>navigate(key)} disabled={disabled}>{label}</button>)}</nav>}
  {error&&<p role="alert" className="inventory-error">{error}</p>}{pending&&!busy&&<button className="management-add" onClick={()=>execute(pending).catch(()=>{})}>같은 요청 다시 확인</button>}
  <label>관리 작가<select disabled={disabled} value={selection} onChange={e=>setSelection(e.target.value)}><option value="">작가 선택</option>{options.map(o=><option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
  {scope&&data&&<>
   {event&&data.events.some(e=>e.operator||e.artistEditable)&&<details><summary>새 상품 등록·행사 배정</summary><form className="account-form" onSubmit={async e=>{e.preventDefault();try{await send('createArtistStock',{...draft,price:Number(draft.price),cost:Number(draft.cost),quantity:Number(draft.stock),projectId:event.id});setDraft({...draft,name:'',stock:0});}catch{}}}><InventoryProductFields draft={draft} showPricing hideCreator products={[]} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))} disabled={disabled}/><label>입고·행사 배정 수량<input type="number" min="0" step="1" required value={draft.stock} disabled={disabled} onChange={e=>setDraft({...draft,stock:Number(e.target.value)})}/></label><button className="management-add" disabled={disabled}>등록·배정</button></form></details>}
   {tool==='new'&&<form className="account-form" onSubmit={async e=>{e.preventDefault();try{await send('createArtistStock',{...draft,price:Number(draft.price),cost:Number(draft.cost),quantity:Number(draft.stock)});clear();setDraft({...draft,name:'',stock:0});navigate('inventory');}catch{}}}><InventoryProductFields draft={draft} showPricing hideCreator products={[]} onChange={(key,value)=>setDraft(current=>({...current,[key]:value}))} disabled={disabled}/><label>입고 수량<input type="number" min="0" step="1" required value={draft.stock} onChange={e=>setDraft({...draft,stock:Number(e.target.value)})}/></label><button className="management-add" disabled={disabled}>상품 등록</button></form>}
   {tool==='import'&&<InventoryImport key={selection} adminId={scope.ownerId} navigate={navigate} review={path.endsWith('/review')} api={async(action,payload)=>{
    if(action!=='importInventory')throw new Error('지원하지 않는 작가 재고 작업입니다.');batch.current||=crypto.randomUUID();
    const result=await execute({action:'importArtistStock',payload:{ownerId:scope.ownerId,boothId:scope.boothId,products:payload.products,requestId:batch.current}});imports.current=result.inventory;batch.current=null;return result;
   }} saveImage={async(id,file)=>{const item=imports.current.find(i=>i.importId===id);if(item)await image(item,file);}} onRegistered={()=>load(scope)}/>}
   {['list','loss'].includes(tool)&&data.inventory.map(item=><div key={`${selection}:${item.id}:${item.version}`}>
    {!event&&tool==='list'&&<ProductEditor item={item} busy={disabled} onSave={product=>send('saveArtistProduct',{id:item.id,version:item.version,product})} onImage={file=>image(item,file).catch(e=>setError(e.message))}/>}
    <StockItem item={item} events={data.events} busy={disabled} eventOnly={Boolean(event)} lossOnly={tool==='loss'}
      onAdjust={(row,values)=>send('adjustArtistStock',{id:row.id,version:row.version,...values}).catch(()=>{})}
      onAllocate={(row,values)=>send('setArtistAllocation',{id:row.id,version:row.version,...values}).catch(()=>{})}
      onLoss={(row,values)=>send('recordArtistStockLoss',{id:row.id,version:row.version,...values}).catch(()=>{})}/>
   </div>)}
  </>}
 </div></main>;
}
