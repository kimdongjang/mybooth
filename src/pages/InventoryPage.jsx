import { useEffect, useRef, useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import ProductValueInput from '../components/ProductValueInput';
import { Input, Quantity, ProductImage } from '../components/PosUI';
import { filterInventory } from '../utils/inventorySearch';
import { won } from '../utils/productDisplay';

const emptySearch = () => ({ stock: 'all', product: '', creatorExact: '', goodsType: '', genre: '', event: '' });
const dateLabel = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '') : '—';
const empty = () => ({ id: crypto.randomUUID(), version: -1, name: '', goodsType: '', vtuberName: '', creatorName: '', genre: '', stock: 0 });
const allocatedStock = item => (item.allocations || []).reduce((sum, row) => sum + Number(row.stock), 0);

export default function InventoryPage({ adminId, api, routeHash, navigate }) {
  const [items, setItems] = useState([]);
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null);
  const [stockChangeType, setStockChangeType] = useState('receipt');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(emptySearch);
  const [query, setQuery] = useState('');
  const optionsFor = key => [...new Set(items.map(item => item[key] || '미지정'))].sort((a, b) => a.localeCompare(b, 'ko'));
  const events = [...new Map(items.flatMap(item => (item.allocations || []).map(row => [String(row.project_id), row.event_name]))).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ko'));
  const filterCount = ['stock', 'event', 'creatorExact', 'goodsType', 'genre'].filter(key => search[key] && search[key] !== 'all').length;
  const filteredItems = filterInventory(items, search);
  const changeSearch = next => { setSearch(next); setPage(1); };
  const changeDraft = (key, value) => setDraft(current => ({ ...current, [key]: key === 'stock' ? (value === '' ? '' : Number(value)) : value }));
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pendingKey = `pos_inventory_transfer:${adminId}`;
  const pending = useRef(null);
  const [uncertain, setUncertain] = useState(false);
  const backButton = useRef(null);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 10));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => {
    let active = true;
    try { pending.current = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); setUncertain(Boolean(pending.current)); } catch { /* Preserve damaged metadata for investigation. */ }
    api('listInventory').then(data => { if (active) { setItems(data.inventory); setReady(true); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [adminId]);
  useEffect(() => { if (view !== 'list') backButton.current?.focus(); }, [view]);
  const run = async task => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    const path = routeHash.split('?')[0];
    let id = null;
    try { id = path.startsWith('#/inventory/') ? decodeURIComponent(path.slice('#/inventory/'.length)) : null; } catch { id = '__invalid__'; }
    setError(''); setMessage(''); setStockChangeType('receipt');
    if (!id) { setView('list'); setDraft(null); }
    else if (id === 'new') { setView('new'); setDraft(empty()); }
    else { setView('detail'); const item = items.find(item => item.id === id); setDraft(item ? { ...item } : null); }
  }, [routeHash, ready]);
  const savedItem = draft && items.find(item => item.id === draft.id);
  const stockDelta = draft ? Number(draft.stock) - Number(savedItem?.stock || 0) : 0;
  const open = (event, item) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(`/inventory/${encodeURIComponent(item.id)}`);
  };
  // Recover only requests started by the previous UI; no new transfers are offered.
  const resolvePending = async () => {
    try {
      const data = await api('transferInventory', pending.current);
      setItems(data.inventory); setMessage('이전 재고 이동 결과를 확인했습니다.');
    } catch (err) {
      if (!(err.status >= 400 && err.status < 500)) throw err;
      setError(err.message);
    }
    sessionStorage.removeItem(pendingKey); pending.current = null; setUncertain(false);
  };
  const save = async event => {
    event.preventDefault();
    await run(async () => {
      const { price, ...product } = draft;
      const data = await api('saveInventory', { product, stockChangeType });
      setItems(data.inventory); setDraft({ ...data.inventory.find(item => item.id === draft.id) });
      if (view === 'new') navigate(`/inventory/${encodeURIComponent(draft.id)}`, true);
      setView('detail'); setMessage('상품과 재고를 저장했습니다.');
    });
  };
  return <main className="page-content inventory-page">
    <PageIntro title="재고 관리" />
    {error && <p role="alert" className="inventory-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!ready && !error && <p role="status">재고를 불러오는 중…</p>}
    {error && <button type="button" className="management-back" disabled={busy} onClick={() => run(async () => {
      const data = await api('listInventory'); setItems(data.inventory); setReady(true);
      if (view === 'detail') { const latest = data.inventory.find(item => item.id === draft.id); if (latest) setDraft({ ...latest }); }
    })}>최신 정보 다시 불러오기</button>}
    {uncertain && <div role="status" className="inventory-card"><p>이전에 요청한 재고 이동의 완료 여부를 확인해주세요.</p><button type="button" className="management-back" disabled={busy} onClick={() => run(resolvePending)}>이전 이동 결과 확인</button></div>}
    <section className="product-management">
      <header className="management-heading"><h2>{view === 'list' ? '재고 목록' : view === 'new' ? '상품 등록' : '상품 재고 상세'}</h2>
        {view === 'list' ? <button type="button" className="management-add" disabled={busy || uncertain || !ready} onClick={() => navigate('/inventory/new')}>+ 상품 추가</button>
          : <button ref={backButton} type="button" className="management-back" disabled={busy} onClick={() => navigate('inventory')}>← 목록으로</button>}
      </header>
      {view === 'list' ? <>
        <form className="inventory-search" role="search" aria-label="재고 검색" onSubmit={event => { event.preventDefault(); changeSearch({ ...search, product: query }); }}>
          <div className="inventory-search-bar">
            <label className="inventory-query"><span className="sr-only">상품명·캐릭터·장르·굿즈 종류 통합 검색</span><input type="search" placeholder="상품명·캐릭터·장르·굿즈 종류" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <button className="inventory-search-button" type="submit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>검색</button>
          </div>
          <details className="inventory-filters"><summary>상세 조건 추가{filterCount > 0 && <span className="inventory-filter-count">{filterCount}</span>}</summary>
            <div className="inventory-filter-grid">
              {[
                ['stock', '재고 상태', [['available', '남은재고 있음'], ['empty', '남은재고 없음']]],
                ['event', '등록된 행사', events],
                ['creatorExact', '제작자', optionsFor('creatorName').map(value => [value, value])],
                ['goodsType', '굿즈 종류', optionsFor('goodsType').map(value => [value, value])],
                ['genre', '장르', optionsFor('genre').map(value => [value, value])],
              ].map(([key, label, options]) => <label key={key}><span>{label}</span><select value={search[key]} onChange={event => changeSearch({ ...search, [key]: event.target.value })}><option value={key === 'stock' ? 'all' : ''}>전체</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
            </div>
          </details>
          {(search.product || filterCount > 0 || query) && <button type="button" className="inventory-search-reset" onClick={() => { setQuery(''); changeSearch(emptySearch()); }}>검색 조건 초기화</button>}
        </form>
        <p className="settlement-result" role="status">검색 결과 {filteredItems.length}개 / 전체 {items.length}개</p>
        <div className="management-table-wrap"><table className="management-table inventory-management-table">
          <caption className="sr-only">상품명과 제작자, 캐릭터와 장르, 남은재고와 총재고, 등록일</caption>
          <thead><tr>{['상품명 / 제작자', '캐릭터 / 장르', '재고', '등록일'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{filteredItems.slice((currentPage - 1) * 10, currentPage * 10).map(item => <tr key={item.id}>
            <td><a className="management-name-link inventory-cell-main" href={`#/inventory/${encodeURIComponent(item.id)}`} aria-label={`${item.name} 재고 상세보기`} title={item.name} onClick={event => open(event,item)}>{item.name}</a><small className="inventory-cell-sub" title={item.creatorName || '미지정'}>{item.creatorName || '미지정'}</small></td>
            <td><span className="inventory-cell-main" title={item.vtuberName || ''}>{item.vtuberName || '—'}</span><small className="inventory-cell-sub" title={item.genre || ''}>{item.genre || '—'}</small></td>
            <td className="mono"><span className="inventory-cell-main" aria-label={`남은재고 ${won(item.remainingStock)}개`}>{won(item.remainingStock)}개</span><small className="inventory-cell-sub" title={item.totalEstimated ? '총재고: 기존 자료 기준' : '총재고'}>총 {won(item.totalReceived)}{item.totalEstimated ? '*' : ''}</small></td>
            <td>{dateLabel(item.createdAt)}</td>
          </tr>)}</tbody>
        </table>{ready && !items.length && <div className="management-empty"><h3>등록된 상품이 없습니다</h3><p>상품 추가 버튼으로 첫 상품을 등록하세요.</p></div>}{ready && items.length > 0 && !filteredItems.length && <p className="catalog-empty">검색 조건에 맞는 재고가 없습니다.</p>}</div>
        {filteredItems.some(item => item.totalEstimated) && <p className="inventory-estimate-note">* 총재고는 기존 자료 기준입니다.</p>}
        <nav className="management-pagination" aria-label="재고 목록 페이지"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></nav>
      </> : draft && <article className="management-product">
        <div className="management-product-header"><h3>{draft.name || '새 상품'}</h3><span className="mono inventory-creator">{draft.productNumber || '저장 시 상품 번호 발급'}</span></div>
        <div className="management-product-body">
          <div className="management-image"><ProductImage imageUrl={draft.imageUrl} name={draft.name} /></div>
          <form onSubmit={save} className="management-details">
            <fieldset disabled={busy || uncertain || !ready}><legend>기본 정보</legend><div className="management-fields">
              <label className="management-field product-name-field"><span>상품 이름</span><Input required maxLength={200} value={draft.name} onChange={value => changeDraft('name', value)} /></label>
              {[['vtuberName','캐릭터'], ['goodsType','굿즈 종류'], ['creatorName','제작자'], ['genre','장르']].map(([key,label]) => <ProductValueInput key={key} field={key} label={label} products={items} value={draft[key]} onChange={value => changeDraft(key, value)} required={key === 'goodsType'} disabled={busy || uncertain || !ready} />)}

            </div></fieldset>
            <fieldset disabled={busy || uncertain || !ready}><legend>재고</legend><div className="product-stock-grid">
              <label className="management-field"><span>{view === 'new' ? '최초 입고 수량' : '창고 남은재고'}</span><Input aria-label="창고 남은재고" required type="number" min="0" max="2147483647" step="1" value={draft.stock} onChange={value => changeDraft('stock', value)} /></label>
              <Quantity label="총재고 (누적 입고)" value={Number(draft.totalReceived ?? savedItem?.totalReceived ?? 0) + (view === 'new' ? Number(draft.stock || 0) : stockDelta > 0 && stockChangeType === 'receipt' ? stockDelta : 0)} />
              <Quantity label="남은재고" value={Number(draft.stock || 0) + allocatedStock(draft)} />
            </div></fieldset>
            {view === 'detail' && stockDelta !== 0 && <label className="management-field"><span>수량 변경 사유</span><select value={stockChangeType} onChange={event => setStockChangeType(event.target.value)} disabled={busy || uncertain}><option value="receipt">추가 입고</option><option value="loss">분실</option><option value="disposal">폐기</option><option value="correction">수량 정정</option></select></label>}
            <p className="management-note">남은재고는 창고와 모든 행사에 남은 수량의 합계입니다. 추가 입고만 총재고에 누적하며 분실·폐기·정정은 별도 기록합니다.</p>
            {draft.totalEstimated && <p className="management-note">기존 상품의 총재고는 보존된 초기 수량과 판매 자료로 정한 기준값입니다. 과거 누락된 입고·조정 이력은 포함하지 못할 수 있습니다.</p>}
            <div className="product-edit-actions"><button type="submit" className="management-add" disabled={busy || uncertain || !ready}>{busy ? '저장 중…' : view === 'new' ? '상품 등록' : '수정'}</button></div>
          </form>
        </div>
        {view === 'detail' && <section className="inventory-history"><h4>행사별 판매 이력</h4><p className="management-note">보존된 판매 내역 기준이며 취소된 판매는 제외합니다. 링크를 누르면 해당 행사로 전환해 판매 내역을 엽니다.</p>
          <div className="management-table-wrap"><table className="management-table"><thead><tr><th scope="col">행사</th><th scope="col">판매 수량</th><th scope="col">판매 내역</th></tr></thead><tbody>{(draft.history || []).map(history => <tr key={history.projectId}><td>{history.eventName}{history.estimated && <small className="inventory-creator">과거 세트 구성 일부 추정 또는 누락</small>}</td><td>{won(history.soldQty)}개</td><td><a className="event-text-link" href={`#/settlement?projectId=${encodeURIComponent(history.projectId)}&productId=${encodeURIComponent(history.productId)}&productName=${encodeURIComponent(draft.name)}`} onClick={event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault(); navigate(`/settlement?projectId=${encodeURIComponent(history.projectId)}&productId=${encodeURIComponent(history.productId)}&productName=${encodeURIComponent(draft.name)}`);
          }}>행사 판매 내역 →</a></td></tr>)}</tbody></table></div>{!draft.history?.length && <p className="catalog-empty">연결된 행사와 판매 이력이 없습니다.</p>}
        </section>}
      </article>}
      {view === 'detail' && ready && !draft && <div className="management-empty" role="status"><h3>재고를 찾을 수 없습니다</h3><p>주소를 확인하거나 목록에서 상품을 선택해주세요.</p></div>}
    </section>
  </main>;
}
