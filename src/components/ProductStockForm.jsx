import { useRef, useState } from 'react';
import { Input, Quantity } from './PosUI';
import { productStockDraft, productStockPatch } from '../utils/productEditing';

export default function ProductStockForm({ product, soldQty, onSave, disabled }) {
  const [baseline, setBaseline] = useState(() => productStockDraft(product));
  const [draft, setDraft] = useState(() => productStockDraft(product));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const submitting = useRef(false);
  const initial = Number(draft.initialStockQty);
  const changed = initial !== Number(baseline.initialStockQty);
  const valid = String(draft.initialStockQty).trim() && Number.isSafeInteger(initial) && initial >= soldQty;
  const remaining = changed ? (valid ? initial - soldQty : null) : Number(product.stockQty ?? product.stock ?? 0);
  const submit = async event => {
    event.preventDefault();
    if (disabled || submitting.current) return;
    let patch;
    try { patch = productStockPatch(draft, baseline, product, soldQty); } catch (error) { setStatus(error.message); return; }
    if (!Object.keys(patch).length) return;
    submitting.current = true;
    setBusy(true);
    try {
      if (await onSave(patch)) {
        const saved = productStockDraft({ ...product, ...patch });
        setDraft(saved); setBaseline(saved); setStatus('재고를 수정했습니다.');
      } else setStatus('저장하지 못했습니다. 다시 시도해주세요.');
    } catch (error) { setStatus(error.message || '재고 수정에 실패했습니다.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form className="product-stock-form" onSubmit={submit}>
    <fieldset disabled={disabled || busy}><legend>재고</legend><div className="product-stock-grid">
      <label className="management-field"><span>초기재고</span><Input aria-label="초기재고" required type="number" min={soldQty} step="1" value={draft.initialStockQty} onChange={value => { setDraft(current => ({ ...current, initialStockQty: value })); setStatus(''); }} /></label>
      <Quantity label="판매수량" value={soldQty} />
      {remaining === null ? <div className="management-field"><span>남은 재고</span><output className="management-quantity mono">—</output></div> : <Quantity label="남은 재고" value={remaining} />}
    </div></fieldset>
    <div className="product-edit-actions"><button type="submit" className="management-add" disabled={disabled || busy}>{busy ? '저장 중…' : '재고 수정'}</button><span role="status">{status}</span></div>
  </form>;
}
