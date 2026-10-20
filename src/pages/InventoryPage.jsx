import InventoryTransferRecovery from '../components/InventoryTransferRecovery';
import { useEffect, useRef, useState } from 'react';
import { prepareProductImage } from '../utils/productImage';
import { uploadInventoryImage } from '../utils/uploadProductImage';
import InventoryProductFields from '../components/InventoryProductFields';
import { Input, ProductImage } from '../components/PosUI';
import { filterInventory } from '../utils/inventorySearch';
import { won } from '../utils/productDisplay';

const emptySearch = () => ({ stock: 'all', product: '', creatorExact: '', goodsType: '', genre: '', event: '' });
const dateLabel = value => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '') : '—';
const empty = () => ({ id: crypto.randomUUID(), version: -1, name: '', goodsType: '', vtuberName: '', creatorName: '', genre: '', stock: 0 });

export default function InventoryPage({ projects = [], adminId, api, routeHash, navigate }) {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const uploadedImage = useRef(null);
  useEffect(() => {
    if (!image) { setPreview(null); return; }
    const url = URL.createObjectURL(image); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const chooseImage = async file => {
    if (!file || busy || preparing) return;
    setPreparing(true); setError('');
    try { setImage(await prepareProductImage(file)); uploadedImage.current = null; }
    catch (err) { setError(err.message); } finally { setPreparing(false); }
  };
  const [allocationEvents, setAllocationEvents] = useState([]);
  const [pendingMoves, setPendingMoves] = useState(false);
  const [items, setItems] = useState([]);
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null);
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
  const [deletionNotice, setDeletionNotice] = useState('');
  const [deleteBlockers, setDeleteBlockers] = useState(null);
  const deleteDialog = useRef(null);
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (!deleteBlockers || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [deleteBlockers]);
  const pendingKey = `pos_inventory_transfer:${adminId}`;
  const pending = useRef(null);
  const [uncertain, setUncertain] = useState(false);
  const backButton = useRef(null);
  const pageCount = Math.max(1, Math.ceil(filteredItems.length / 10));
  const currentPage = Math.min(page, pageCount);
  useEffect(() => {
    let active = true;
    try { pending.current = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); setUncertain(Boolean(pending.current)); } catch { /* Preserve damaged metadata for investigation. */ }
    api('listInventory').then(data => { if (active) { setItems(data.inventory); setAllocationEvents(data.inventoryEvents || []); setReady(true); } }).catch(err => { if (active) setError(err.message); });
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
    setError(''); setMessage(''); setImage(null); uploadedImage.current = null;
    if (!id) { setView('list'); setDraft(null); }
    else if (id === 'new') { setView('new'); setDraft(empty()); }
    else { setView('detail'); const item = items.find(item => item.id === id); setDraft(item ? { ...item } : null); }
  }, [routeHash, ready]);
  const savedItem = draft && items.find(item => item.id === draft.id);
  const allocationKey = row => JSON.stringify([row.project_id,row.product_id]);
  const allocationRows = savedItem ? [
    ...(savedItem.allocations || []),
    ...allocationEvents.filter(event => !savedItem.allocations.some(row => row.project_id === event.id)).map(event => ({ project_id: event.id, product_id: null, event_name: event.name, archived_at: event.archived_at, data_revision: event.data_revision, stock: 0, initial_stock: 0 })),
  ].map(row => ({ ...row, quantity: draft.allocationQuantities?.[allocationKey(row)] ?? Number(row.initial_stock) })) : [];
  const totalStock = draft?.totalStock ?? (Number(draft?.stock || 0) + (savedItem?.allocations || []).reduce((sum,row) => sum + Number(row.initial_stock || 0),0));
  const allocationSum = allocationRows.reduce((sum,row) => sum + Number(row.quantity),0);
  const allocationError = allocationSum > Number(totalStock) ? '행사 배정 수량 합계가 총재고를 초과합니다.' : '';
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
    if (preparing) return;
    await run(async () => {
      const { price, ...product } = draft;
      if (pendingMoves || uncertain) throw new Error('이전 재고 이동 결과를 먼저 확인해주세요.');
      if (allocationError) throw new Error(allocationError);
      const allocationPlan = view === 'detail' ? { totalStock: Number(totalStock), allocations: allocationRows.map(row => ({ projectId: row.project_id, productId: row.product_id, quantity: Number(row.quantity), stock: Number(row.stock), initialStock: Number(row.initial_stock), dataRevision: row.data_revision ?? null })) } : undefined;
      let data = await api('saveInventory', { product, ...(allocationPlan ? { allocationPlan } : {}) });
      let saved = data.inventory.find(item => item.id === draft.id);
      setItems(data.inventory); setAllocationEvents(data.inventoryEvents || []); setDraft({ ...saved });
      if (image) {
        try {
          const blob = uploadedImage.current?.file === image ? uploadedImage.current : await uploadInventoryImage(adminId, saved.id, image);
          uploadedImage.current = { file: image, url: blob.url };
          data = await api('saveInventory', { product: { ...saved, imageUrl: blob.url } });
          saved = data.inventory.find(item => item.id === saved.id);
          setItems(data.inventory); setDraft({ ...saved }); setImage(null); uploadedImage.current = null;
        } catch (err) { throw new Error(`상품은 저장되었지만 이미지 저장에 실패했습니다. 다시 저장해주세요. ${err.message || ''}`); }
      }
      if (view === 'new') navigate(`/inventory/${encodeURIComponent(draft.id)}`, true);
      setView('detail'); alert('상품과 재고를 저장했습니다.');
    });
  };
  const remove = () => {
    if (busy || uncertain || pendingMoves || !ready || !draft) return;
    return run(async () => {
      const fresh = await api('listInventory');
      setItems(fresh.inventory);
      const latest = fresh.inventory.find(item => item.id === draft.id);
      if (!latest) { setDraft(null); throw new Error('이미 삭제되었거나 재고를 찾을 수 없습니다.'); }
      const blockers = (latest.allocations || []).filter(row => row.is_active !== false && !row.archived_at);
      if (blockers.length) { setDeleteBlockers(blockers); return; }
      if (!confirm(`“${latest.name}” 상품을 재고 관리에서 삭제할까요?\n남은 수량과 과거 판매 이력은 보존됩니다. 삭제 후에는 재고 수정과 새 행사 배정을 할 수 없습니다.`)) return;
      let data;
      try { data = await api('removeInventory', { inventoryId: latest.id, version: latest.version }); }
      catch (err) {
        if (err.status === 409) {
          const refreshed = await api('listInventory');
          setItems(refreshed.inventory);
          const changed = refreshed.inventory.find(item => item.id === latest.id);
          const blockers = (changed?.allocations || []).filter(row => row.is_active !== false && !row.archived_at);
          if (blockers.length) { setDeleteBlockers(blockers); return; }
        }
        throw err;
      }
      setItems(data.inventory); setDraft(null); setView('list');
      setDeletionNotice(`“${latest.name}” 상품을 재고 관리에서 삭제했습니다. 남은 수량과 판매 이력은 유지됩니다.`);
      navigate('inventory');
    });
  };
  return <main className="page-content inventory-page">
    <header className="inventory-page-header">
      <nav className="inventory-breadcrumb" aria-label="현재 위치"><ol>
        <li><a href="#/inventory" onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); navigate('inventory'); }}>공통 상품·재고 관리</a></li>
        <li aria-hidden="true">/</li>
        {view !== 'list' && <><li><a href="#/inventory" onClick={event => { if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return; event.preventDefault(); navigate('inventory'); }}>재고 목록</a></li><li aria-hidden="true">/</li></>}
        <li><h1 aria-current="page" tabIndex={-1}>{view === 'list' ? '재고 목록' : view === 'new' ? '상품 등록' : '상품 재고 상세'}</h1></li>
      </ol></nav>
      {view !== 'list' && <button ref={backButton} type="button" className="management-back" disabled={busy} onClick={() => navigate('inventory')}>← 목록으로</button>}
    </header>
    {error && <p role="alert" className="inventory-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {deletionNotice && <div role="status" className="inventory-card"><p>{deletionNotice}</p><button type="button" className="management-back" onClick={() => setDeletionNotice('')}>닫기</button></div>}
    {!ready && !error && <p role="status">재고를 불러오는 중…</p>}
    {uncertain && <div role="status" className="inventory-card"><p>이전에 요청한 재고 이동의 완료 여부를 확인해주세요.</p><button type="button" className="management-back" disabled={busy} onClick={() => run(resolvePending)}>이전 이동 결과 확인</button></div>}
    <InventoryTransferRecovery adminId={adminId} api={api} onBlocked={setPendingMoves} onInventory={inventory => { setItems(inventory); setDraft(current => current ? inventory.find(row => row.id === current.id) || null : null); }} />
    <section className={`product-management ${view !== 'detail' ? 'inventory-list-content' : ''}`}>
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
        <div className="inventory-table-actions"><button type="button" className="management-add" disabled={busy || preparing || uncertain || pendingMoves || !ready} onClick={() => navigate('/inventory/new')}>+ 상품 추가</button></div>
        <div className="management-table-wrap"><table className="management-table inventory-management-table">
          <caption className="sr-only">상품명과 제작자, 캐릭터와 장르, 남은재고와 총재고, 등록일</caption>
          <thead><tr>{['상품명 / 제작자', '캐릭터 / 장르', '재고', '등록일'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{filteredItems.slice((currentPage - 1) * 10, currentPage * 10).map(item => <tr key={item.id}>
            <td><a className="management-name-link inventory-cell-main" href={`#/inventory/${encodeURIComponent(item.id)}`} aria-label={`${item.name} 재고 상세보기`} title={item.name} onClick={event => open(event,item)}>{item.name}</a><small className="inventory-cell-sub" title={item.creatorName || '미지정'}>{item.creatorName || '미지정'}</small></td>
            <td><span className="inventory-cell-main" title={item.vtuberName || ''}>{item.vtuberName || '—'}</span><small className="inventory-cell-sub" title={item.genre || ''}>{item.genre || '—'}</small></td>
            <td className="mono"><span className="inventory-cell-main" aria-label={`남은재고 ${won(item.remainingStock)}개`}>{won(item.remainingStock)}개</span><small className="inventory-cell-sub">총재고 {won(item.totalStock)}개</small></td>
            <td>{dateLabel(item.createdAt)}</td>
          </tr>)}</tbody>
        </table>{ready && !items.length && <div className="management-empty"><h3>등록된 상품이 없습니다</h3><p>상품 추가 버튼으로 첫 상품을 등록하세요.</p></div>}{ready && items.length > 0 && !filteredItems.length && <p className="catalog-empty">검색 조건에 맞는 재고가 없습니다.</p>}</div>
        <p className="settlement-result" role="status">검색 결과 {filteredItems.length}개 / 전체 {items.length}개</p>
        <nav className="management-pagination" aria-label="재고 목록 페이지"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></nav>
      </> : draft && <article className="management-product">
        <div className="management-product-header inventory-detail-header">
          <div className="inventory-detail-identity">{draft.productNumber && <span className="inventory-product-code mono">{draft.productNumber}</span>}<h3>{draft.name || '새 상품'}</h3></div>
          <div className="inventory-detail-actions">
            <button type="submit" form="inventory-product-form" className="management-add" disabled={busy || preparing || uncertain || pendingMoves || !ready}>{busy ? '저장 중…' : view === 'new' ? '상품 등록' : '수정'}</button>
            {view === 'detail' && <button type="button" className="inventory-delete-button" disabled={busy || preparing || uncertain || pendingMoves || !ready} onClick={remove}>상품 삭제</button>}
          </div>
        </div>
        <div className="management-product-body">
          <div className="management-image">
            <ProductImage imageUrl={preview || draft.imageUrl} name={draft.name} />
            <label className="management-upload product-image-upload"><span>{preparing ? '이미지 축소 중…' : image || draft.imageUrl ? '이미지 수정' : '이미지 등록'}</span><input aria-label="상품 이미지 등록 또는 수정" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || preparing || uncertain || pendingMoves || !ready} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; chooseImage(file); }} /></label>
            {(image || draft.imageUrl) && <button type="button" className="product-image-remove" disabled={busy || preparing || uncertain || pendingMoves || !ready} onClick={() => { setImage(null); uploadedImage.current = null; changeDraft('imageUrl', null); }}>이미지 제거</button>}
          </div>
          <form id="inventory-product-form" onSubmit={save} className="management-details">
            <InventoryProductFields draft={draft} products={items} onChange={changeDraft} disabled={busy || preparing || uncertain || pendingMoves || !ready} />
            {view === 'new' && <label className="management-field"><span>최초 입고 수량</span><Input aria-label="최초 입고 수량" required type="number" min="0" max="2147483647" step="1" value={draft.stock} disabled={busy || preparing || uncertain || pendingMoves || !ready} onChange={value => changeDraft('stock', value)} /></label>}
          </form>
        </div>
        {view === 'detail' && <section className="inventory-history">
          <div className="inventory-allocation-heading"><h4>행사별 재고 배정 관리</h4><label className="management-field"><span>총재고</span><div className="inventory-quantity-input"><Input form="inventory-product-form" aria-label="총재고" required type="number" min="0" max="2147483647" step="1" value={totalStock} disabled={busy || uncertain || pendingMoves} onChange={value => changeDraft('totalStock', value === '' ? '' : Number(value))} /><span>개</span></div></label></div>
          <p className="management-note">총재고에는 판매된 수량이 포함됩니다. 행사 배정 합계 {won(allocationSum)}개 · 창고 미배정 {won(Number(totalStock) - allocationSum)}개. 수정 버튼을 누르면 함께 저장됩니다.</p>
          {allocationError && <p role="alert" className="inventory-error">{allocationError}</p>}
          <div className="management-table-wrap"><table className="management-table inventory-allocation-table"><thead><tr><th>행사</th><th>행사 배정 수량</th><th>판매 수량</th><th>남은 수량</th></tr></thead><tbody>{allocationRows.map(row => {
            const sold = savedItem?.history.find(history => history.projectId === row.project_id && history.productId === row.product_id)?.soldQty || 0;
            const consumed = Number(row.initial_stock) - Number(row.stock);
            const remaining = Number(row.stock) + Number(row.quantity) - Number(row.initial_stock);
            return <tr key={allocationKey(row)}><td><a className="event-text-link" href={`#/products?projectId=${encodeURIComponent(row.project_id)}`} onClick={event => {
              if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault(); navigate(`/products?projectId=${encodeURIComponent(row.project_id)}`);
            }}>{row.event_name}</a>{row.archived_at ? ' (보관)' : ''}{row.is_active === false && <small className="inventory-cell-sub">행사에서 제거됨</small>}</td>
              <td><Input form="inventory-product-form" aria-label={`${row.event_name} 배정 수량`} required type="number" min={Math.max(sold,consumed,0)} max={row.archived_at ? Number(row.initial_stock) : 2147483647} step="1" value={row.quantity} disabled={busy || uncertain || pendingMoves || (row.archived_at && !row.product_id)} onChange={value => setDraft(current => ({ ...current, allocationQuantities: { ...current.allocationQuantities, [allocationKey(row)]: value === '' ? '' : Number(value) } }))} /></td>
              <td><output className="inventory-readonly-quantity" aria-label={`${row.event_name} 판매 수량`}>{won(sold)}개</output></td><td><output className="inventory-readonly-quantity" aria-label={`${row.event_name} 남은 수량`}>{won(remaining)}개</output>{consumed !== sold && <small className="inventory-cell-sub">과거 재고 차감 반영</small>}</td></tr>;
          })}</tbody></table></div>
          {!allocationRows.length && <p className="management-note">등록된 행사가 없습니다.</p>}
        </section>}
        {view === 'detail' && <section className="inventory-history"><h4>행사별 판매 이력</h4><p className="management-note">보존된 판매 내역 기준이며 취소된 판매는 제외합니다. 링크를 누르면 해당 행사로 전환해 판매 내역을 엽니다.</p>
          <div className="management-table-wrap"><table className="management-table"><thead><tr><th scope="col">행사</th><th scope="col">판매 수량</th><th scope="col">판매 내역</th></tr></thead><tbody>{(draft.history || []).map(history => <tr key={history.projectId}><td><a className="event-text-link" href={`#/products?projectId=${encodeURIComponent(history.projectId)}`} onClick={event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault(); navigate(`/products?projectId=${encodeURIComponent(history.projectId)}`);
          }}>{history.eventName}</a>{history.estimated && <small className="inventory-creator">과거 세트 구성 일부 추정 또는 누락</small>}</td><td>{won(history.soldQty)}개</td><td><a className="event-text-link" href={`#/settlement?projectId=${encodeURIComponent(history.projectId)}&productId=${encodeURIComponent(history.productId)}&productName=${encodeURIComponent(draft.name)}`} onClick={event => {
            if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault(); navigate(`/settlement?projectId=${encodeURIComponent(history.projectId)}&productId=${encodeURIComponent(history.productId)}&productName=${encodeURIComponent(draft.name)}`);
          }}>행사 판매 내역 →</a></td></tr>)}</tbody></table></div>{!draft.history?.length && <p className="catalog-empty">연결된 행사와 판매 이력이 없습니다.</p>}
        </section>}
      </article>}
      {view === 'detail' && ready && !draft && <div className="management-empty" role="status"><h3>재고를 찾을 수 없습니다</h3><p>주소를 확인하거나 목록에서 상품을 선택해주세요.</p></div>}
    </section>
    {deleteBlockers && <dialog ref={deleteDialog} className="inventory-delete-dialog" aria-labelledby="inventory-delete-title" aria-describedby="inventory-delete-description" onCancel={event => { event.preventDefault(); setDeleteBlockers(null); }} onClick={event => { if (event.target === event.currentTarget) setDeleteBlockers(null); }}>
      <div className="inventory-delete-dialog-heading"><h2 id="inventory-delete-title">행사에서 먼저 제거해주세요</h2><button type="button" className="inventory-dialog-close" aria-label="삭제 안내 닫기" autoFocus onClick={() => setDeleteBlockers(null)}>×</button></div>
      <p id="inventory-delete-description">아래 행사에 상품이 등록되어 있어 삭제할 수 없습니다. 행사에서 제거한 뒤 다시 상품 삭제를 눌러주세요.</p>
      <ul className="inventory-blocker-list">{deleteBlockers.map(row => <li key={`${row.project_id}:${row.product_id}`}>
        <a href={`#/products?projectId=${encodeURIComponent(row.project_id)}&productId=${encodeURIComponent(row.product_id)}`} onClick={event => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault(); setDeleteBlockers(null); navigate(`/products?projectId=${encodeURIComponent(row.project_id)}&productId=${encodeURIComponent(row.product_id)}`);
        }}><span><strong>{row.event_name}</strong><small>남은 수량 {won(row.stock)}개</small></span><span className="inventory-blocker-link">행사 판매 설정 →</span></a>
      </li>)}</ul>
      <button type="button" className="management-back inventory-dialog-dismiss" onClick={() => setDeleteBlockers(null)}>닫기</button>
    </dialog>}
  </main>;
}
