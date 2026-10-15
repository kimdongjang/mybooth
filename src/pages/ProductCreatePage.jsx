import { useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import { Input } from '../components/PosUI';
import { uid, productNameFromFields } from '../utils/productDisplay';

export default function ProductCreatePage({ readOnly, saving, products, persistProducts, onBack }) {
  const [draft, setDraft] = useState(() => ({ id: uid(), goodsType: '새 굿즈', vtuberName: '', creatorName: '', price: '', stockQty: '' }));
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (readOnly || saving) return;
    const price = Number(draft.price);
    const stockQty = Number(draft.stockQty);
    if (!draft.goodsType.trim() || draft.price === '' || draft.stockQty === '' || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stockQty) || stockQty < 0) return alert('굿즈 종류와 0 이상의 정수 판매가·재고를 입력해주세요.');
    const product = {
      ...draft, productCode: draft.id, goodsType: draft.goodsType.trim(), vtuberName: draft.vtuberName.trim(), creatorName: draft.creatorName.trim(),
      price, stockQty, stock: stockQty, initialStockQty: stockQty, size: '', isActive: true,
      setCreatorName: null, setGroupName: null, setPrice: null, setDescription: null, createdAt: new Date().toISOString(),
    };
    product.name = productNameFromFields(product);
    const saved = await persistProducts([...products, product]);
    if (saved) onBack();
  };
  return <main className="page-content settings-page">
    <PageIntro title="새 상품 등록" description="상품 정보와 판매가, 처음 등록할 재고를 입력하세요." actions={<button type="button" disabled={saving} className="management-back" onClick={onBack}>← 상품 목록으로</button>} />
    <form className="settings-content" onSubmit={submit}>
      <fieldset disabled={readOnly || saving} className="min-w-0">
        <article className="management-product">
          <div className="management-product-header"><h3>새 굿즈 ({draft.id})</h3></div>
          <div className="bundle-management-body management-details">
            <fieldset><legend>기본 정보</legend><div className="management-fields">
              <label className="management-field"><span>캐릭터</span><Input value={draft.vtuberName} onChange={value => change('vtuberName', value)} /></label>
              <label className="management-field"><span>굿즈 종류</span><Input required value={draft.goodsType} onChange={value => change('goodsType', value)} /></label>
              <label className="management-field"><span>제작자</span><Input value={draft.creatorName} onChange={value => change('creatorName', value)} /></label>
            </div></fieldset>
            <fieldset><legend>가격 · 초기 재고</legend><div className="management-fields">
              <label className="management-field"><span>판매가 (원)</span><Input required type="number" min="0" step="1" value={draft.price} onChange={value => change('price', value)} /></label>
              <label className="management-field"><span>초기 재고 (개)</span><Input required type="number" min="0" step="1" value={draft.stockQty} onChange={value => change('stockQty', value)} /></label>
            </div></fieldset>
            <button type="submit" className="management-add">{saving ? '저장 중…' : '상품 저장'}</button>
          </div>
        </article>
      </fieldset>
    </form>
  </main>;
}
