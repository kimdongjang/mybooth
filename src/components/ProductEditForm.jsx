import { useRef, useState } from 'react';
import { Input } from './PosUI';
import ProductValueInput from './ProductValueInput';
import { applyProductEdit, productEditDraft, productEditPatch } from '../utils/productEditing';

export default function ProductEditForm({ product, products, persistProducts, disabled }) {
  const [draft, setDraft] = useState(() => productEditDraft(product));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const submitting = useRef(false);
  const change = (field, value) => { setDraft(current => ({ ...current, [field]: value })); setStatus(''); };
  const submit = async event => {
    event.preventDefault();
    if (disabled || submitting.current) return;
    setStatus('');
    let patch;
    try { patch = productEditPatch(draft); } catch (error) { setStatus(error.message); return; }
    submitting.current = true;
    setBusy(true);
    try {
      const saved = await persistProducts(applyProductEdit(products, product.id, patch));
      if (saved) { setDraft(productEditDraft(patch)); setStatus('수정했습니다.'); }
      else setStatus('수정하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.');
    } catch (error) { setStatus(error.message || '수정에 실패했습니다.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form onSubmit={submit} className="management-details">
    <fieldset disabled={disabled || busy}><legend>기본 정보</legend><div className="management-fields">
      <label className="management-field product-name-field"><span>상품 이름</span><Input required value={draft.name} disabled={disabled || busy} onChange={value => change('name', value)} /></label>
      {[['vtuberName', '캐릭터'], ['goodsType', '굿즈 종류'], ['creatorName', '제작자']].map(([field, label]) => <ProductValueInput key={field} label={label} field={field} products={products} value={draft[field]} onChange={value => change(field, value)} required={field === 'goodsType'} disabled={disabled || busy} />)}
      <label className="management-field"><span>판매가 (원)</span><Input required min="0" step="1" type="number" value={draft.price} disabled={disabled || busy} onChange={value => change('price', value)} /></label>
    </div></fieldset>
    <div className="product-edit-actions"><button type="submit" className="management-add" disabled={disabled || busy}>{busy ? '수정 중…' : '수정'}</button><span role="status">{status}</span></div>
  </form>;
}
