import { useEffect, useRef, useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import { won } from '../utils/productDisplay';

const empty = () => ({ id: crypto.randomUUID(), version: -1, name: '', goodsType: '', vtuberName: '', creatorName: '', price: 0, stock: 0 });
const allocatedStock = item => (item.allocations || []).reduce((sum, row) => sum + Number(row.stock), 0);

export default function InventoryPage({ adminId, api }) {
  const [items, setItems] = useState([]);
  const [view, setView] = useState('list');
  const [draft, setDraft] = useState(null);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const pendingKey = `pos_inventory_transfer:${adminId}`;
  const pending = useRef(null);
  const [uncertain, setUncertain] = useState(false);
  const backButton = useRef(null);
  const pageCount = Math.max(1, Math.ceil(items.length / 10));
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
  const open = item => { setDraft({ ...item }); setView('detail'); setError(''); setMessage(''); };
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
      const data = await api('saveInventory', { product: draft });
      setItems(data.inventory); setDraft({ ...data.inventory.find(item => item.id === draft.id) });
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
        {view === 'list' ? <button type="button" className="management-add" disabled={busy || uncertain || !ready} onClick={() => { setDraft(empty()); setView('new'); setError(''); setMessage(''); }}>+ 상품 추가</button>
          : <button ref={backButton} type="button" className="management-back" disabled={busy} onClick={() => { setView('list'); setDraft(null); setError(''); setMessage(''); }}>← 목록으로</button>}
      </header>
      {view === 'list' ? <>
        <div className="management-summary"><span>등록 상품 <b>{items.length}개</b></span></div>
        <div className="management-table-wrap"><table className="management-table inventory-management-table">
          <caption className="sr-only">상품 이름, 판매가, 창고 재고, 전체 남은 재고</caption>
          <thead><tr>{['상품 이름', '판매가', '창고 재고', '전체 재고'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{items.slice((currentPage - 1) * 10, currentPage * 10).map(item => <tr key={item.id}>
            <td><button type="button" className="management-name-link" aria-label={`${item.name} 재고 상세보기`} onClick={() => open(item)}>{item.name}</button><small className="inventory-creator">{item.creatorName || '제작자 미지정'}</small></td>
            <td className="mono management-row-price">{won(item.price)}원</td><td className="mono">{won(item.stock)}개</td><td className="mono">{won(Number(item.stock) + allocatedStock(item))}개</td>
          </tr>)}</tbody>
        </table>{ready && !items.length && <div className="management-empty"><h3>등록된 상품이 없습니다</h3><p>상품 추가 버튼으로 첫 상품을 등록하세요.</p></div>}</div>
        <nav className="management-pagination" aria-label="재고 목록 페이지"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></nav>
      </> : draft && <article className="inventory-card">
        <form onSubmit={save}>
          <fieldset disabled={busy || uncertain || !ready} className="inventory-fields">
            {[["name","상품 이름"],["goodsType","굿즈 종류"],["vtuberName","캐릭터"],["creatorName","제작자"],["price","판매가 (원)"],["stock","창고 재고 (개)"]].map(([key,label]) => <label key={key}>{label}<input required={['name','price','stock'].includes(key)} maxLength={200} type={['price','stock'].includes(key) ? 'number' : 'text'} min="0" max="2147483647" step="1" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: ['price','stock'].includes(key) ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} /></label>)}
          </fieldset><div className="inventory-actions"><button className="management-add" disabled={busy || uncertain || !ready}>{busy ? '저장 중…' : view === 'new' ? '상품 등록' : '수정'}</button></div>
        </form>
        {view === 'detail' && <div className="inventory-stock-summary"><p>행사 잔여 재고: <strong>{won(allocatedStock(draft))}개</strong></p><p>전체 남은 재고: <strong>{won(Number(draft.stock || 0) + allocatedStock(draft))}개</strong></p><p className="management-note">창고 재고는 행사에 배정되지 않은 수량입니다. 행사 잔여 재고는 읽기 전용입니다.</p></div>}
      </article>}
    </section>
  </main>;
}
