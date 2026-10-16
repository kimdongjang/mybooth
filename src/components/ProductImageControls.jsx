import { useRef } from 'react';
import ActionIcon from './ActionIcon';

export default function ProductImageControls({ hasImage, busy, disabled, onSelect, onRemove, label = '상품 이미지' }) {
  const picker = useRef(null);
  return <div className="product-image-controls">
    <input ref={picker} hidden type="file" accept="image/jpeg,image/png,image/webp" aria-label={`${label} 파일 선택`} disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onSelect(file); }} />
    <button type="button" className="product-image-select" aria-label={`${label} ${hasImage ? '수정' : '등록'}`} disabled={disabled} onClick={() => picker.current?.click()}><ActionIcon image />{busy ? '이미지 처리 중…' : hasImage ? '이미지 수정' : '이미지 선택'}</button>
    {hasImage && <button type="button" className="product-image-remove" aria-label={`${label} 제거`} disabled={disabled} onClick={onRemove}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>이미지 제거</button>}
  </div>;
}
