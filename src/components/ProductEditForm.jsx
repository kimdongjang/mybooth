import { useRef, useState } from 'react';
import { Input } from './PosUI';
import ProductValueInput from './ProductValueInput';
import { applyProductEdit, productEditDraft, productEditPatch } from '../utils/productEditing';

export default function ProductEditForm({ product, products, persistProducts, disabled, formId, hideSubmit = false, onSave }) {
  const [draft, setDraft] = useState(() => productEditDraft(product));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const submitting = useRef(false);
  const baseline = useRef({ fields: productEditDraft(product), version: product.inventoryVersion });
  if (JSON.stringify(baseline.current.fields) === JSON.stringify(productEditDraft(product))) baseline.current.version = product.inventoryVersion;
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
      const saved = onSave ? await onSave(patch, baseline.current.version) : await persistProducts(applyProductEdit(products, product.id, patch));
      if (saved) { baseline.current = { fields: productEditDraft(patch), version: saved.inventoryVersion ?? product.inventoryVersion }; setDraft(productEditDraft(patch)); setStatus('수정했습니다.'); }
      else setStatus('수정하지 못했습니다. 입력 내용을 확인한 뒤 다시 시도해주세요.');
    } catch (error) { setStatus(error.message || '수정에 실패했습니다.'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <form id={formId} onSubmit={submit} className="management-details">
    <fieldset disabled={disabled || busy}><legend>{onSave ? '공통 상품 정보' : '기본 정보'}</legend><div className="management-fields">
      <label className="management-field product-name-field"><span>상품 이름</span><Input required value={draft.name} disabled={disabled || busy} onChange={value => change('name', value)} /></label>
      {[['vtuberName', '캐릭터'], ['goodsType', '굿즈 종류'], ['creatorName', '제작자'], ['genre', '장르']].map(([field, label]) => <ProductValueInput key={field} label={label} field={field} products={products} value={draft[field]} onChange={value => change(field, value)} required={field === 'goodsType'} disabled={disabled || busy} />)}
    </div></fieldset>
    <fieldset disabled={disabled || busy}><legend>이 행사 판매가</legend>
      <label className="management-field"><span>판매가 (원)</span><Input required min="0" step="1" type="number" value={draft.price} disabled={disabled || busy} onChange={value => change('price', value)} /></label>
    </fieldset>
    <div className="product-edit-actions">{!hideSubmit && <button data-guide="edit" type="submit" className="management-add" disabled={disabled || busy}>{busy ? '수정 중…' : '수정'}</button>}<span role="status">{status}</span></div>
  </form>;
}
