import {useState} from 'react';
import {filterInventory} from '../utils/inventorySearch';
import {won} from '../utils/productDisplay';

const emptySearch = {product:'',registeredDate:'',goodsType:'',genre:'',event:''};
const dateLabel = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('ko-KR') : '—';

export default function PersonalInventoryCatalog({items,events,detailId,navigate,renderDetail}) {
 const [query,setQuery]=useState(''),[search,setSearch]=useState(emptySearch),[page,setPage]=useState(1),[sort,setSort]=useState({key:'name',direction:1});
 const changeSearch=next=>{setSearch(next);setPage(1);};
 const rows=items.map(item=>({...item,remainingStock:item.remaining,allocations:item.allocations.map(row=>({...row,project_id:row.projectId}))}));
 const filtered=filterInventory(rows,search).sort((a,b)=>sort.direction*(sort.key==='remainingStock'?a.remainingStock-b.remainingStock:String(a[sort.key]||'').localeCompare(String(b[sort.key]||''),'ko')));
 const pageCount=Math.max(1,Math.ceil(filtered.length/10)),currentPage=Math.min(page,pageCount);
 const filterCount=Object.entries(search).filter(([key,value])=>key!=='product'&&value).length;
 const choices=key=>[...new Set(items.map(item=>item[key]||'미지정'))].sort((a,b)=>a.localeCompare(b,'ko'));
 const open=(e,item)=>{if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button!==0)return;e.preventDefault();navigate(`/inventory/${encodeURIComponent(item.id)}`);};
 const sortBy=key=>{setSort({key,direction:sort.key===key?-sort.direction:1});setPage(1);};
 if(detailId){const item=items.find(row=>row.id===detailId);return item?<section className="product-management personal-inventory-detail">{renderDetail(item)}</section>:null;}
 return <section className="product-management inventory-list-content">
  <div className="management-summary"><span>등록 상품 <b>{items.length}개</b></span></div>
  <form className="inventory-search" role="search" aria-label="재고 검색" onSubmit={e=>{e.preventDefault();changeSearch({...search,product:query});}}>
   <div className="inventory-search-bar"><label className="inventory-query"><span className="sr-only">상품명·캐릭터·작품/시리즈·굿즈 종류 통합 검색</span><input type="search" placeholder="상품명·캐릭터·작품/시리즈·굿즈 종류" value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="inventory-search-button" type="submit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>검색</button></div>
   <div className="inventory-filter-section"><details className="inventory-filters"><summary>상세 조건 추가{filterCount>0&&<span className="inventory-filter-count">{filterCount}</span>}</summary><div className="inventory-filter-grid">
    <label><span>등록 날짜</span><input type="date" value={search.registeredDate} onChange={e=>changeSearch({...search,registeredDate:e.target.value})}/></label>
    <label><span>등록된 행사</span><select value={search.event} onChange={e=>changeSearch({...search,event:e.target.value})}><option value="">전체</option>{events.map(event=><option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
    {[['goodsType','굿즈 종류'],['genre','작품/시리즈']].map(([key,label])=><label key={key}><span>{label}</span><select value={search[key]} onChange={e=>changeSearch({...search,[key]:e.target.value})}><option value="">전체</option>{choices(key).map(value=><option key={value} value={value}>{value}</option>)}</select></label>)}
   </div></details>{(query||search.product||filterCount>0)&&<button type="button" className="inventory-search-reset" onClick={()=>{setQuery('');changeSearch(emptySearch);}}>검색 조건 초기화</button>}</div>
  </form>
  <div className="management-table-wrap"><table className="management-table inventory-management-table personal-inventory-table"><caption className="sr-only">내 상품, 캐릭터와 작품/시리즈, 재고와 등록일</caption><thead><tr>{[['name','상품명 / 굿즈 종류'],[null,'캐릭터 / 작품·시리즈'],['remainingStock','재고'],['createdAt','등록일']].map(([key,label])=><th scope="col" key={label} aria-sort={key&&sort.key===key?(sort.direction===1?'ascending':'descending'):undefined}>{key?<button type="button" onClick={()=>sortBy(key)}>{key==='name'?<><span className="inventory-desktop-label">{label}</span><span className="inventory-mobile-info">상품정보</span></>:label}{sort.key===key?(sort.direction===1?' ↑':' ↓'):''}</button>:label}</th>)}</tr></thead>
   <tbody>{filtered.length===0&&(items.length===0?<tr className="table-empty-row"><td colSpan={4}><p>등록된 재고가 없어요. 첫 상품을 등록해 재고를 관리해 보세요.</p><button type="button" className="management-add" onClick={()=>navigate('/inventory/new')}>+ 새 상품 등록</button></td></tr>:<tr className="table-empty-row"><td colSpan={4}><p>조회된 값이 없습니다.</p></td></tr>)}{filtered.slice((currentPage-1)*10,currentPage*10).map(item=><tr key={item.id}><td><a className="management-name-link inventory-cell-main" href={`#/inventory/${encodeURIComponent(item.id)}`} onClick={e=>open(e,item)} title={item.name}>{item.name}</a><small className="inventory-cell-sub">{item.goodsType||'—'}</small><span className="inventory-mobile-info"><span className="inventory-cell-sub">{item.vtuberName||'—'}</span><span className="inventory-cell-sub">{item.genre||'—'}</span></span></td><td><span className="inventory-cell-main" title={item.vtuberName}>{item.vtuberName||'—'}</span><small className="inventory-cell-sub" title={item.genre}>{item.genre||'—'}</small></td><td className="mono"><span className="inventory-cell-main">잔여 {won(item.remaining)}개 / 미배정 {won(item.warehouse)}개</span><small className="inventory-cell-sub">총 {won(item.totalStock)}개</small></td><td>{dateLabel(item.createdAt)}</td></tr>)}</tbody>
  </table></div>
  <p className="settlement-result" role="status">검색 결과 {filtered.length}개 / 전체 {items.length}개</p>
  <nav className="management-pagination" aria-label="재고 목록 페이지"><button type="button" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>다음</button></nav>
 </section>;
}
