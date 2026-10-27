import {useEffect,useRef,useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import {useUnsavedChanges} from '../hooks/useUnsavedChanges';
import LoadingState from './LoadingState';

export default function PersonalSalesHistory({request,items=[]}) {
 const [data,setData]=useState(null),[error,setError]=useState('');
 const [channel,setChannel]=useState('all'),[eventId,setEventId]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[query,setQuery]=useState('');
 const [search,setSearch]=useState(''),[sort,setSort]=useState({key:'time',direction:-1});
 const [adding,setAdding]=useState(false),[product,setProduct]=useState(''),[quantity,setQuantity]=useState(''),[amount,setAmount]=useState(''),[date,setDate]=useState(()=>koreanDay(new Date())),[memo,setMemo]=useState('');
 const dialog=useRef(null);
 useEffect(()=>{if(adding)dialog.current?.showModal();else dialog.current?.close();},[adding]);
 useUnsavedChanges(adding&&Boolean(product||quantity||amount||memo));
 useEffect(()=>{let active=true;request('/api/booths?artists=history').then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request]);
 const rows=(data?.events||[]).flatMap(event=>event.sales.flatMap((sale,saleIndex)=>sale.items.map((item,itemIndex)=>({...item,time:sale.time,voided:sale.voided,event,eventKey:`${event.projectId}:${saleIndex}:${itemIndex}`}))))
  .filter(row=>channel!=='online'&&(!eventId||row.event.projectId===eventId)&&(!start||koreanDay(row.time)>=start)&&(!end||koreanDay(row.time)<=end)&&row.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  .sort((a,b)=>{const value=row=>sort.key==='event'?row.event.eventName:sort.key==='channel'?'행사 판매':sort.key==='status'?(row.voided?'취소':'판매'):row[sort.key];const left=value(a),right=value(b);return sort.direction*(['quantity','amount','time'].includes(sort.key)?(sort.key==='time'?new Date(left).getTime()-new Date(right).getTime():Number(left)-Number(right)):String(left||'').localeCompare(String(right||''),'ko'));});
 const sortBy=key=>setSort({key,direction:sort.key===key?-sort.direction:1});
 const filterCount=[channel!=='all',Boolean(eventId),Boolean(start),Boolean(end)].filter(Boolean).length;
 const selected=items.find(item=>`${item.ownerId}:${item.id}`===product);
 const close=()=>{setAdding(false);setProduct('');setQuantity('');setAmount('');setMemo('');setDate(koreanDay(new Date()));};
 return <div className="personal-sales-history inventory-list-content">
  <header className="management-heading inventory-management-heading"><h2 tabIndex={-1}>내 판매내역</h2><div className="inventory-management-actions"><button type="button" className="management-add" onClick={()=>setAdding(true)}>+ 온라인 판매 기록</button></div></header>
  <dialog ref={dialog} className="app-confirm-dialog personal-online-sale" aria-labelledby="online-sale-title" onCancel={e=>{e.preventDefault();close();}}><div className="management-product-header"><h2 id="online-sale-title">온라인 판매 기록</h2><button type="button" className="management-back" onClick={close}>닫기</button></div>
   <form className="account-card-body account-form" onSubmit={e=>e.preventDefault()}>
    <label>상품<select required value={product} onChange={e=>setProduct(e.target.value)}><option value="">상품 선택</option>{items.map(item=><option key={`${item.ownerId}:${item.id}`} value={`${item.ownerId}:${item.id}`}>{item.name} · 미배정 {won(item.warehouse)}개</option>)}</select></label>
    <label>판매일<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label>판매 수량<input type="number" required min="1" max={selected?.warehouse??undefined} step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>총 판매금액 (원)<input type="number" required min="0" max="2147483647" step="1" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label className="personal-sales-wide">판매처·메모 (선택)<input maxLength={500} value={memo} onChange={e=>setMemo(e.target.value)}/></label>
    <div className="personal-sales-wide personal-sales-actions"><button type="button" className="management-back" onClick={close}>취소</button><button type="submit" className="management-add" disabled>기록 저장</button></div>
   </form>
  </dialog>
  <form className="inventory-search" role="search" aria-label="내 판매내역 검색" onSubmit={e=>{e.preventDefault();setSearch(query);}}>
   <div className="inventory-search-bar"><label className="inventory-query"><span className="sr-only">상품명 검색</span><input type="search" placeholder="상품명" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="inventory-search-button" type="submit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>검색</button></div>
   <div className="inventory-filter-section"><details className="inventory-filters"><summary>상세 조건 추가{filterCount>0&&<span className="inventory-filter-count">{filterCount}</span>}</summary><div className="inventory-filter-grid">
    <label><span>판매 구분</span><select value={channel} onChange={e=>{setChannel(e.target.value);if(e.target.value==='online')setEventId('');}}><option value="all">전체</option><option value="event">행사 판매</option><option value="online">온라인 판매</option></select></label>
    <label><span>행사</span><select value={eventId} disabled={channel==='online'} onChange={e=>setEventId(e.target.value)}><option value="">전체</option>{(data?.events||[]).map(event=><option key={event.projectId} value={event.projectId}>{event.eventName}</option>)}</select></label>
    <label><span>판매 시작일</span><input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
    <label><span>판매 종료일</span><input type="date" min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label>
   </div></details>{(query||search||filterCount>0)&&<button type="button" className="inventory-search-reset" onClick={()=>{setQuery('');setSearch('');setChannel('all');setEventId('');setStart('');setEnd('');}}>검색 조건 초기화</button>}</div>
  </form>
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  <div className="management-table-wrap"><table className="management-table personal-sales-table"><caption className="sr-only">내 상품의 행사·온라인 판매내역</caption><thead><tr>{[['time','판매일'],['channel','구분'],['event','행사·판매처'],['name','상품명'],['quantity','판매 수량'],['amount','판매금액'],['status','상태']].map(([key,label])=><th scope="col" key={key} aria-sort={sort.key===key?(sort.direction===1?'ascending':'descending'):undefined}><button type="button" onClick={()=>sortBy(key)}>{label}{sort.key===key?(sort.direction===1?' ↑':' ↓'):''}</button></th>)}</tr></thead><tbody>{rows.map(row=><tr key={row.eventKey}><td>{koreanDay(row.time)}</td><td>행사 판매</td><td><a className="management-name-link" href={`#/settlement?projectId=${encodeURIComponent(row.event.projectId)}`}>{row.event.eventName}</a></td><td>{row.name}</td><td>{won(row.quantity)}개</td><td>{won(row.amount)}원</td><td>{row.voided?'취소':'판매'}</td></tr>)}</tbody></table></div>
 </div>;
}
