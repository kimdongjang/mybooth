import {useState} from 'react';
import {won,eventCreatorNameOf} from '../utils/productDisplay';

export default function EventSalesCatalog({items,event,products=[],sales,renderDetail,renderProduct,onAdd,disabled,productId='',navigate}) {
 const [selectedId,setSelectedId]=useState('');
 const allocation=item=>item.allocations.find(row=>row.projectId===event.id);
 const product=item=>products.find(row=>row.id===allocation(item)?.productId);
 // 행사 상태 API는 활성 상품만 내려준다. 상품 관리에서 제거한 상품은 배정·판매 이력이 남아도 목록에서 뺀다.
 const eventItems=items.filter(item=>allocation(item)&&product(item)&&product(item).isActive!==false);
 const selected=eventItems.find(item=>productId?item.allocations.some(row=>row.projectId===event.id&&row.productId===productId):item.id===selectedId);
 return <section className="product-management event-sales-catalog">
  <header className="management-heading"><h2>{selected?'행사 상품 상세':'상품 목록'}</h2>{!selected&&onAdd&&<button type="button" className="management-add" disabled={disabled} onClick={onAdd}>+ 새 상품 등록</button>}{selected&&<button type="button" className="management-back" onClick={()=>navigate?navigate(`/products?projectId=${encodeURIComponent(event.id)}`):setSelectedId('')}>← 목록으로</button>}</header>
  {selected?renderProduct(selected,product(selected)||{id:productId} ):<>
   <div className="management-summary"><span>상품 <b>{eventItems.length}개</b></span></div>
   <div className="management-table-wrap event-product-table-wrap"><table className="management-table event-product-number-table"><caption className="sr-only">판매 번호, 상품 이름, 제작자, 판매가, 배정 수량, 판매 수량, 남은 재고, 등록일</caption>
    <thead><tr>{['판매 번호','상품 이름','제작자','판매가','배정 수량','판매수량','남은 재고','등록일'].map((label,index)=><th scope="col" key={label} className={[2,4,7].includes(index)?'event-product-extra-column':undefined}>{label}</th>)}</tr></thead>
    <tbody>{!eventItems.length&&<tr className="table-empty-row"><td colSpan={8}><p>등록된 상품이 없어요. 첫 상품을 등록하고 판매를 시작해 보세요.</p>{onAdd&&<button type="button" className="management-add" disabled={disabled} onClick={onAdd}>+ 새 상품 등록</button>}</td></tr>}{eventItems.map(item=>{const master=product(item),row={...allocation(item)};
     if(master){row.initial=master.initialStockQty??row.initial;row.remaining=master.stockQty??master.stock??row.remaining;row.price=master.price??row.price;
      if(sales)row.sold=sales.filter(sale=>!sale.voided).reduce((sum,sale)=>sum+(sale.lines||[]).reduce((qty,line)=>qty+(line.type==='product'&&line.id===master.id?Number(line.qty):line.type==='bundle'?(line.subItems||[]).filter(part=>part.productId===master.id).reduce((count,part)=>count+Number(part.qty)*Number(line.qty),0):0),0),0);
     }return <tr key={item.id}>
     <td data-label="판매 번호"><output className="product-sale-number">{master?.saleNumber||'—'}</output></td>
     <td data-label="상품 이름"><a className="management-name-link" aria-label={`${item.name} 상세보기`} href={`#/products/${encodeURIComponent(master?.id||item.id)}?projectId=${encodeURIComponent(event.id)}`} onClick={e=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button!==0)return;e.preventDefault();if(navigate)navigate(`/products/${encodeURIComponent(master?.id||item.id)}?projectId=${encodeURIComponent(event.id)}`);else setSelectedId(item.id);}}>{item.name}</a><small className="management-mobile-meta">{eventCreatorNameOf(master||item)}</small></td>
     <td data-label="제작자" className="event-product-extra-column">{eventCreatorNameOf(master||item)}</td><td data-label="판매가" className="mono management-row-price">{won(row?.price??item.price)}원</td>
     <td data-label="배정 수량" className="mono event-product-extra-column">{won(row?.initial||0)}개</td><td data-label="판매수량" className="mono">{won(row?.sold||0)}개</td><td data-label="남은 재고" className="mono">{won(row?.remaining||0)}개</td>
     <td data-label="등록일" className="event-product-extra-column">{item.createdAt&&!Number.isNaN(Date.parse(item.createdAt))?new Date(item.createdAt).toLocaleDateString('ko-KR'):'—'}</td>
    </tr>;})}</tbody>
   </table></div>
  </>}
 </section>;
}
