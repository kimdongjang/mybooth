import EventStockAllocationPanel from './EventStockAllocationPanel';
import {confirmAction} from '../utils/confirmAction';
import CreatorField from './CreatorField';
import {useEffect,useRef,useState} from 'react';
import {allowNavigation} from '../hooks/useUnsavedChanges';
import {ProductImage} from './PosUI';
import ProductEditForm from './ProductEditForm';

export default function EventProductDetail({item,product,products,event,disabled,onSave,onImage,onRemove,creatorOptions=[],canEditCreator=false,onSetCreator,stockEvents=[],stockHistory=[],stockDisabled,onSaveStockPlan,creatorRequest,onRefreshCreators}) {
 const [uploading,setUploading]=useState(false),[error,setError]=useState('');
 const [creatorOpen,setCreatorOpen]=useState(false),[creatorBusy,setCreatorBusy]=useState(false);
 const [creatorChoice,setCreatorChoice]=useState({}),[creatorFieldBusy,setCreatorFieldBusy]=useState(false);
 const creatorDialog=useRef(null);
 useEffect(()=>{if(creatorOpen)creatorDialog.current?.showModal();else creatorDialog.current?.close();},[creatorOpen]);
 const updateCreator=async ownerId=>{if(lock.current)return;lock.current=true;setCreatorBusy(true);setError('');try{if(!await allowNavigation())return;await onSetCreator(ownerId);setCreatorOpen(false);}catch(e){setError(e.message);}finally{lock.current=false;setCreatorBusy(false);}};
 const lock=useRef(false);
 const allocation=item.allocations.find(row=>row.projectId===event.id);
 const [stockDirty,setStockDirty]=useState(false);

 const runImage=async file=>{if(lock.current)return;lock.current=true;setUploading(true);setError('');try{if(stockDirty&&!await confirmAction('저장하지 않은 재고 변경이 초기화됩니다. 이미지를 변경할까요?',{title:'미저장 재고 변경',confirmLabel:'변경'}))return;await onImage(file);}catch(e){setError(e.message);}finally{lock.current=false;setUploading(false);}};
 const busy=disabled||uploading||creatorBusy;
 return <article className="management-product event-product-detail">
  <div className="management-product-header inventory-detail-header"><div className="inventory-detail-identity"><h3>{product.saleNumber||1}번 상품 - {item.name}</h3></div><div className="inventory-detail-actions"><button type="submit" form="event-product-edit-form" className="management-add" disabled={busy}>수정</button><button type="button" className="inventory-delete-button" disabled={busy} onClick={onRemove}>상품 삭제</button></div></div>
  {error&&<p role="alert" className="inventory-error">{error}</p>}
  <div className="management-product-body"><div className="management-image"><ProductImage imageUrl={item.imageUrl} name={item.name}/><label className="management-upload product-image-upload"><span>{uploading?'업로드 중…':item.imageUrl?'이미지 수정':'이미지 등록'}</span><input aria-label={`${item.name} 이미지 등록 또는 수정`} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file)runImage(file);}}/></label>{item.imageUrl&&<button type="button" className="product-image-remove" disabled={busy} onClick={()=>runImage(null)}>이미지 제거</button>}</div>
   <div className="management-details"><ProductEditForm onBeforeSave={()=>!stockDirty||confirmAction('저장하지 않은 재고 변경이 초기화됩니다. 상품 정보를 수정할까요?',{title:'미저장 재고 변경',confirmLabel:'수정'})} formId="event-product-edit-form" hideSubmit product={{...item,price:allocation?.price??product.price,inventoryVersion:item.version}} products={products} disabled={busy} creatorReadOnly creatorSlot={<div className="management-field"><span>제작자</span><div className="event-product-creator"><div>{product.eventCreator?<><strong>{product.eventCreator.name}</strong>{product.eventCreator.linked&&<span className="revenue-status">연동완료</span>}</>:<span>미연결</span>}</div><button type="button" className="management-back" disabled={busy||!canEditCreator} onClick={()=>{setError('');setCreatorChoice({ownerId:product.eventCreator?.ownerId||''});setCreatorOpen(true);}}>수정</button></div></div>} onSave={onSave}/>
    <EventStockAllocationPanel key={`${item.id}:${item.version}`} item={item} event={event} events={stockEvents} history={stockHistory} busy={stockDisabled||uploading||creatorBusy} onDirtyChange={setStockDirty} onSave={onSaveStockPlan}/>

   </div>
  </div>
 <dialog ref={creatorDialog} className="app-confirm-dialog event-account-dialog event-creator-dialog" aria-labelledby="event-creator-title" onCancel={e=>{if(creatorBusy||creatorFieldBusy)e.preventDefault();else setCreatorOpen(false);}}><div className="management-heading"><h2 id="event-creator-title">제작자 연결</h2><button type="button" className="management-back" disabled={creatorBusy||creatorFieldBusy} onClick={()=>setCreatorOpen(false)}>닫기</button></div><CreatorField onBusyChange={setCreatorFieldBusy} creators={creatorOptions.filter(row=>row.catalog!==false)} value={creatorChoice} onChange={setCreatorChoice} request={creatorRequest} project={event} allowDirect={canEditCreator} disabled={busy} onRefresh={onRefreshCreators}/>{error&&<p role="alert" className="inventory-error">{error}</p>}<div className="app-confirm-actions event-creator-actions">{product.eventCreator&&<button type="button" className="management-delete" disabled={busy||creatorFieldBusy} onClick={()=>updateCreator(null)}>제작자 연결 삭제</button>}<button type="button" className="management-add" disabled={busy||creatorFieldBusy||!creatorChoice.ownerId} onClick={()=>updateCreator(creatorChoice.ownerId)}>제작자 저장</button></div></dialog>
 </article>;
}
