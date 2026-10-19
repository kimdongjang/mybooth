import { useEffect, useState } from 'react';

// Only finishes persisted requests from the former transfer UI; never starts a move.
export default function InventoryTransferRecovery({ adminId, api, onInventory, onBlocked }) {
  const [requests, setRequests] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const pending = [];
    try {
      const prefix = `pos_inventory_move:${adminId}:`;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key?.startsWith(prefix)) continue;
        const request = JSON.parse(sessionStorage.getItem(key));
        if (!request || key !== `${prefix}${request.inventoryId}:${request.projectId}` || !['allocate','return'].includes(request.direction) || !Number.isInteger(request.qty) || request.qty < 1 || typeof request.requestId !== 'string' || !request.requestId) throw new Error('이전 이동 요청을 읽을 수 없습니다. 저장 데이터를 보존하고 확인해주세요.');
        pending.push({ key, request });
      }
      setRequests(pending); onBlocked(pending.length > 0);
    } catch (err) { setError(err.message); onBlocked(true); }
  }, [adminId]);
  const resolve = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      for (const entry of requests) {
        try { const data = await api('transferInventory', entry.request); onInventory(data.inventory); }
        catch (err) { if (!(err.status >= 400 && err.status < 500)) throw err; setError(err.message); }
        sessionStorage.removeItem(entry.key);
        setRequests(current => current.filter(row => row.key !== entry.key));
      }
      onBlocked(false);
    } catch (err) { setError(err.message || '이전 이동 결과를 확인하지 못했습니다. 다시 확인해주세요.'); }
    finally { setBusy(false); }
  };
  if (!requests.length && !error) return null;
  return <div className="inventory-card" role="status"><p>이전에 요청한 재고 이동의 완료 여부를 먼저 확인해주세요.</p>{requests.length > 0 && <button type="button" className="management-back" disabled={busy} onClick={resolve}>{busy ? '확인 중…' : '이전 이동 결과 확인'}</button>}{error && <p role="alert">{error}</p>}</div>;
}
