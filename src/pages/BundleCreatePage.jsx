import { useRef, useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import { Input, ProductImage } from '../components/PosUI';
import { won, creatorNameOf, productNameWithoutCreator } from '../utils/productDisplay';
import { managementBundleStock } from '../utils/managementQuantities';

export default function BundleCreatePage({ readOnly, saving, products, bundleName, setBundleName, bundleRows, setBundleRows, bundlePrice, setBundlePrice, onSave, onBack }) {
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const selected = bundleRows.filter(row => row.productId);
  const query = search.trim().toLocaleLowerCase();
  const matches = products.filter(product => [product.name, product.goodsType, product.vtuberName, creatorNameOf(product), product.productCode || product.id].some(value => String(value || '').toLocaleLowerCase().includes(query)));
  const toggle = (productId) => setBundleRows(selected.some(row => row.productId === productId) ? selected.filter(row => row.productId !== productId) : [...selected, { productId, qty: 1 }]);
  const validQuantities = selected.every(row => Number.isSafeInteger(Number(row.qty)) && Number(row.qty) > 0);
  const subtotal = selected.reduce((sum, row) => sum + (products.find(product => product.id === row.productId)?.price || 0) * (Number(row.qty) || 0), 0);
  const submit = async (event) => {
    event.preventDefault();
    if (readOnly || saving || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    try { await onSave(); } finally { submitting.current = false; setBusy(false); }
  };
  return <main className="page-content settings-page">
    <PageIntro title="새 세트 등록" actions={<button type="button" disabled={saving || busy} className="management-back" onClick={onBack}>← 세트 목록으로</button>} />
    <form className="settings-content product-management" onSubmit={submit}>
      <fieldset disabled={readOnly || saving || busy} className="min-w-0">
        <article className="management-product">
          <div className="management-product-header"><h3>{bundleName.trim() || '새 세트'}</h3><span className="bundle-count">{selected.length}종 구성</span></div>
          <div className="bundle-create-body">
            <div className="management-details">
              <fieldset><legend>기본 정보</legend><div className="management-fields">
                <label className="management-field"><span>세트 이름</span><Input required value={bundleName} onChange={setBundleName} placeholder="예: 아크릴 + 포토카드 세트" /></label>
                <label className="management-field"><span>판매가 (원)</span><Input required min="0" step="1" type="number" value={bundlePrice} onChange={setBundlePrice} placeholder="0" /></label>
              </div></fieldset>
              <fieldset><legend>구성할 상품 선택</legend>
                <label className="management-field"><span>상품 검색</span><Input type="search" value={search} onChange={setSearch} placeholder="상품명, 캐릭터, 제작자" /></label>
                <div className="bundle-picker" aria-label="구성 가능한 상품">
                  {matches.map(product => <label key={product.id} className={`bundle-choice ${selected.some(row => row.productId === product.id) ? 'is-selected' : ''}`}>
                    <input type="checkbox" checked={selected.some(row => row.productId === product.id)} onChange={() => toggle(product.id)} />
                    <ProductImage imageUrl={product.imageUrl} name={product.name} />
                    <span className="bundle-product-copy"><strong>{productNameWithoutCreator(product)}</strong><small>{creatorNameOf(product)}</small><small>{won(product.price)}원 · 재고 {won(product.stockQty ?? product.stock ?? 0)}개</small></span>
                  </label>)}
                  {!matches.length && <p className="bundle-empty">{products.length ? '검색 결과가 없습니다.' : '상품을 먼저 등록해주세요.'}</p>}
                </div>
              </fieldset>
            </div>
            <aside className="bundle-selection" aria-label="선택한 구성품">
              <h4>선택한 구성품 <span>{selected.length}종</span></h4>
              {!selected.length && <p className="bundle-empty">상품을 선택하면 여기에 추가됩니다.</p>}
              <ul className="bundle-selected-list">{selected.map(row => {
                const product = products.find(item => item.id === row.productId);
                return <li key={row.productId}><strong>{product ? productNameWithoutCreator(product) : '삭제된 상품'}</strong><div className="bundle-row-actions"><label className="management-field"><span>세트당 수량</span><Input required aria-label={`${product?.name || '구성품'} 세트당 수량`} type="number" min="1" step="1" value={row.qty} onChange={qty => setBundleRows(selected.map(item => item.productId === row.productId ? { ...item, qty } : item))} /></label><button type="button" className="management-delete" aria-label={`${product?.name || '구성품'} 구성에서 제거`} onClick={() => toggle(row.productId)}>제거</button></div></li>;
              })}</ul>
              <dl className="bundle-totals"><div><dt>단품 합계</dt><dd>{validQuantities ? `${won(subtotal)}원` : '—'}</dd></div><div><dt>세트 판매가</dt><dd>{bundlePrice === '' ? '—' : `${won(bundlePrice)}원`}</dd></div><div><dt>판매 가능 수량</dt><dd>{validQuantities && selected.length ? `${won(managementBundleStock({ items: selected }, products))}세트` : '—'}</dd></div></dl>
              <p className="management-note">구성품의 재고를 공유하며, 세트 판매 시 지정한 수량만큼 차감됩니다.</p>
              <button type="submit" className="management-add" disabled={!selected.length || !validQuantities}>{saving || busy ? '저장 중…' : '세트 저장'}</button>
            </aside>
          </div>
        </article>
      </fieldset>
    </form>
  </main>;
}
