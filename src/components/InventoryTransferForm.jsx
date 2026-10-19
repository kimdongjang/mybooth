import { useEffect, useRef, useState } from 'react';
import { Input } from './PosUI';

export default function InventoryTransferForm({ adminId, inventoryId, projectId, api, disabled = false, onInventory, onBusy }) {
  const key = `pos_inventory_move:${adminId}:${inventoryId}:${projectId}`;
  const [pending, setPending] = useState(null);
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [direction, setDirection] = useState('allocate');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = useRef(false), submitting = useRef(false);
  useEffect(() => {
    active.current = true;
    try { const saved = JSON.parse(sessionStorage.getItem(key) || 'null'); if (saved) { if (saved.projectId !== projectId || saved.inventoryId !== inventoryId || !['allocate','return'].includes(saved.direction) || !Number.isInteger(saved.qty) || saved.qty < 1 || typeof saved.requestId !== 'string') throw new Error('invalid pending transfer'); setPending(saved); setQty(String(saved.qty)); setDirection(saved.direction); } }
    catch { setStorageBlocked(true); setError('이전 이동 요청을 읽을 수 없습니다. 브라우저 저장 데이터를 보존하고 확인해주세요.'); }
    return () => { active.current = false; };
  }, [key]);
  const submit = async event => {
    event.preventDefault();
    if (disabled || storageBlocked || submitting.current) return;
    if (!Number.isInteger(Number(qty)) || Number(qty) < 1 || Number(qty) > 2147483647) { setError('이동 수량은1 이상의 정수로 입력해주세요.'); return; }
    submitting.current = true; setBusy(true); onBusy?.(true); setError(''); setMessage('');
    let request = pending;
    try {
      if (!request) {
        const state = await api('getEventState', { projectId });
        if (!active.current) return;
        request = { projectId, inventoryId, direction, qty: Number(qty), requestId: crypto.randomUUID(), ...(state.dataRevision ? { dataRevision: state.dataRevision } : {}) };
        sessionStorage.setItem(key, JSON.stringify(request)); setPending(request);
      }
      const data = await api('transferInventory', request);
      sessionStorage.removeItem(key);
      if (!active.current) return;
      setPending(null); onInventory?.(data.inventory); setMessage('배정·회수를 반영했습니다.');
    } catch (err) {
      if (err.status >= 400 && err.status < 500) { sessionStorage.removeItem(key); if (active.current) setPending(null); }
      if (active.current) setError(err.message || '이동 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.');
    } finally { submitting.current = false; if (active.current) { setBusy(false); onBusy?.(false); } }
  };
  return <form className="inventory-transfer-form" onSubmit={submit}>
    <fieldset disabled={disabled || busy || storageBlocked}><legend>행사 판매용 재고 배정·회수</legend><div className="inventory-transfer-controls">
      <label><span>작업</span><select value={direction} disabled={Boolean(pending)} onChange={event => setDirection(event.target.value)}><option value="allocate">창고에서 행사로 배정</option><option value="return">행사에서 창고로 회수</option></select></label>
      <label><span>이동 수량</span><Input aria-label="이동 수량" type="number" min="1" max="2147483647" step="1" required value={qty} disabled={Boolean(pending)} onChange={setQty} /></label>
      <button type="submit" className="management-add">{busy ? '처리 중…' : pending ? '이동 결과 확인' : '적용'}</button>
    </div></fieldset>
    {pending && <p role="status">이전 요청의 결과를 확인합니다. 확인 전에는 새 이동을 요청할 수 없습니다.</p>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
  </form>;
}
