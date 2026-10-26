import {useState} from 'react';
import {won,eventCreatorNameOf} from '../utils/productDisplay';

export default function EventSalesCatalog({items,event,products=[],renderDetail,renderProduct,onAdd,disabled,productId='',navigate}) {
 const [selectedId,setSelectedId]=useState('');
 const eventItems=items.filter(item=>item.allocations.some(row=>row.projectId===event.id));
 const selected=eventItems.find(item=>productId?item.allocations.some(row=>row.projectId===event.id&&row.productId===productId):item.id===selectedId);
 const allocation=item=>item.allocations.find(row=>row.projectId===event.id);
 const product=item=>products.find(row=>row.id===allocation(item)?.productId);
 return <section className="product-management event-sales-catalog">
  <header className="management-heading"><h2>{selected?'행사 상품 상세':'상품 목록'}</h2>{!selected&&onAdd&&<button type="button" className="management-add" disabled={disabled} onClick={onAdd}>+ 새 상품 등록</button>}{selected&&<button type="button" className="management-back" onClick={()=>navigate?navigate(`/products?projectId=${encodeURIComponent(event.id)}`):setSelectedId('')}>← 목록으로</button>}</header>
  {selected?renderProduct(selected,product(selected)||{id:productId} ):<>
   <div className="management-summary"><span>상품 <b>{eventItems.length}개</b></span></div>
   <div className="management-table-wrap event-product-table-wrap"><table className="management-table event-product-number-table"><caption className="sr-only">판매 번호, 상품 이름, 제작자, 판매가, 배정 수량, 판매 수량, 남은 재고, 등록일</caption>
    <thead><tr>{['판매 번호','상품 이름','제작자','판매가','배정 수량','판매수량','남은 재고','등록일'].map((label,index)=><th scope="col" key={label} className={[2,4,7].includes(index)?'event-product-extra-column':undefined}>{label}</th>)}</tr></thead>
    <tbody>{eventItems.map(item=>{const row=allocation(item),master=product(item);return <tr key={item.id}>
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
