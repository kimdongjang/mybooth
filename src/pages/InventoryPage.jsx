import { useEffect, useRef, useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import { won } from '../utils/productDisplay';

const empty = () => ({ id: crypto.randomUUID(), version: -1, name: '', goodsType: '', vtuberName: '', creatorName: '', price: 0, stock: 0 });

export default function InventoryPage({ adminId, projects, api, embedded = false }) {
  const [items, setItems] = useState([]);
  const [draft, setDraft] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [inventoryId, setInventoryId] = useState('');
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [qty, setQty] = useState('1');
  const pendingKey = `pos_inventory_transfer:${adminId}`;
  const pending = useRef(null);
  const [uncertain, setUncertain] = useState(false);
  useEffect(() => {
    let active = true;
    try { pending.current = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); setUncertain(Boolean(pending.current)); } catch { /* Ignore damaged browser metadata. */ }
    api('listInventory').then(data => { if (active) { setItems(data.inventory); setReady(true); } }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [adminId]);
  const run = async task => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await task(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const transfer = async direction => {
    const payload = pending.current || { projectId, inventoryId, qty: Number(qty), direction, requestId: crypto.randomUUID() };
    pending.current = payload;
    sessionStorage.setItem(pendingKey, JSON.stringify(payload));
    setUncertain(true);
    let data;
    try { data = await api('transferInventory', payload); }
    catch (err) {
      if (err.status >= 400 && err.status < 500) { sessionStorage.removeItem(pendingKey); pending.current = null; setUncertain(false); }
      throw err;
    }
    sessionStorage.removeItem(pendingKey); pending.current = null; setUncertain(false);
    setItems(data.inventory); setMessage('재고 이동을 완료했습니다.');
  };
  const content = <>
    {!embedded && <PageIntro title="재고 관리"><p>내 상품을 등록하고 행사별로 수량을 배정하세요. 창고와 모든 행사에 남은 재고를 함께 확인할 수 있습니다.</p></PageIntro>}
    {error && <p role="alert" className="inventory-error">{error}</p>}
    {message && <p role="status">{message}</p>}
    {!ready && !error && <p role="status">재고를 불러오는 중…</p>}
    {error && <button type="button" className="management-back" disabled={busy} onClick={() => run(async () => { const data = await api('listInventory'); setItems(data.inventory); setReady(true); })}>목록 새로고침</button>}
    <section className="inventory-card"><h2>{embedded ? '내 재고에서 가져오기' : '행사에 배정 · 창고로 회수'}</h2>
      <p className="management-note">배정한 수량 안에서 오프라인 판매가 가능합니다. 회수 전 해당 행사의 모든 기기에서 주문을 동기화해주세요.</p>
      <fieldset disabled={busy || !ready || uncertain} className="inventory-fields">
        <label>상품<select value={inventoryId} onChange={e => setInventoryId(e.target.value)}><option value="">상품 선택</option>{items.map(item => <option key={item.id} value={item.id}>{item.name} · 창고 {item.stock}개</option>)}</select></label>
        <label>행사<select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">행사 선택</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? ' (보관)' : ''}</option>)}</select></label>
        <label>수량<input type="number" min="1" max="2147483647" step="1" value={qty} onChange={e => setQty(e.target.value)} /></label>
      </fieldset>
      <div className="inventory-actions"><button type="button" className="management-add" disabled={busy || !ready || uncertain || !inventoryId || !projectId || !Number.isInteger(Number(qty)) || Number(qty) < 1 || projects.find(p => p.id === projectId)?.archivedAt} onClick={() => run(() => transfer('allocate'))}>행사로 가져오기</button>
        <button type="button" className="management-back" disabled={busy || !ready || uncertain || !inventoryId || !projectId || !Number.isInteger(Number(qty)) || Number(qty) < 1} onClick={() => run(() => transfer('return'))}>창고로 회수</button></div>
      {uncertain && <div role="status"><p>완료 여부를 확인하려면 같은 요청으로 다시 확인해주세요. 수량은 한 번만 이동합니다.</p><button type="button" className="management-back" disabled={busy} onClick={() => run(() => transfer())}>재고 이동 결과 확인</button></div>}
    </section>
    {!embedded && <>
      <section className="inventory-card"><h2>{draft.version === -1 ? '상품 등록' : '상품 · 창고 재고 수정'}</h2><p className="management-note">창고 수량은 행사에 배정되지 않은 재고입니다. 상품 정보 수정은 앞으로 가져올 행사에 적용됩니다.</p>
        <form onSubmit={event => { event.preventDefault(); run(async () => { const data = await api('saveInventory', { product: draft }); setItems(data.inventory); setDraft(empty()); setMessage('상품과 창고 재고를 저장했습니다.'); }); }}>
          <fieldset disabled={busy || uncertain || !ready} className="inventory-fields">
            {[["name","상품 이름"],["goodsType","굿즈 종류"],["vtuberName","캐릭터"],["creatorName","제작자"],["price","판매가 (원)"],["stock","창고 재고 (개)"]].map(([key,label]) => <label key={key}>{label}<input required={['name','price','stock'].includes(key)} maxLength={200} type={['price','stock'].includes(key) ? 'number' : 'text'} min="0" max="2147483647" step="1" value={draft[key]} onChange={e => setDraft({ ...draft, [key]: ['price','stock'].includes(key) ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} /></label>)}
          </fieldset><div className="inventory-actions"><button className="management-add" disabled={busy || uncertain || !ready}>저장</button><button type="button" className="management-back" onClick={() => setDraft(empty())}>새 상품 입력</button></div>
        </form>
      </section>
      <section className="inventory-card"><h2>내 재고 목록</h2>{ready && !items.length && <p>등록된 상품이 없습니다. 상품을 등록하면 모든 행사에서 가져올 수 있습니다.</p>}
        <div className="inventory-list">{items.map(item => {
          const allocated = item.allocations.reduce((sum, row) => sum + Number(row.stock), 0);
          return <article key={item.id} className="inventory-item"><h3>{item.name}</h3><p>{item.creatorName || '제작자 미지정'} · {won(item.price)}원</p><dl><div><dt>창고</dt><dd>{won(item.stock)}개</dd></div><div><dt>행사 배정 잔여</dt><dd>{won(allocated)}개</dd></div><div><dt>전체 남은 재고</dt><dd>{won(item.stock + allocated)}개</dd></div></dl><ul>{item.allocations.map(row => <li key={row.project_id}>{row.event_name}: {won(row.stock)}개</li>)}</ul><button type="button" className="management-back" disabled={busy || uncertain} onClick={() => { setDraft({ ...item }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>상품 · 창고 재고 수정</button></article>;
        })}</div>
      </section>
    </>}
  </>;
  return embedded ? <div className="event-inventory-picker">{content}</div> : <main className="page-content inventory-page">{content}</main>;
}
