import { useRef, useState } from 'react';
import { Input, Quantity } from './PosUI';
import { productStockDraft, productStockPatch } from '../utils/productEditing';

export default function ProductStockForm({ product, soldQty, onSave, disabled }) {
  const [baseline, setBaseline] = useState(() => productStockDraft(product));
  const [draft, setDraft] = useState(() => productStockDraft(product));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const submitting = useRef(false);
  const reset = () => { const next = productStockDraft(product); setBaseline(next); setDraft(next); setStatus(''); };
  const submit = async event => {
    event.preventDefault();
    if (disabled || submitting.current) return;
    let patch;
    try { patch = productStockPatch(draft, baseline, product); } catch (error) { setStatus(error.message); return; }
    if (!Object.keys(patch).length) { reset(); return; }
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
  const field = (key, label) => {
    return <label className="management-field"><span>{label}</span><Input aria-label={label} required type="number" min="0" step="1" value={draft[key]} onChange={value => { setDraft(current => ({ ...current, [key]: value })); setStatus(''); }} /></label>;
  };
  return <form className="product-stock-form" onSubmit={submit}>
    <fieldset disabled={disabled || busy}><legend>재고</legend><div className="product-stock-grid">
      {field('initialStockQty', '초기재고')}
      <Quantity label="판매수량" value={soldQty} />
      {field('stockQty', '남은 재고')}
    </div></fieldset>
    <div className="product-edit-actions"><button type="submit" className="management-add" disabled={disabled || busy}>{busy ? '저장 중…' : '재고 수정'}</button><button type="button" className="management-back" disabled={disabled || busy} onClick={reset}>변경 취소</button><span role="status">{status}</span></div>
  </form>;
}
