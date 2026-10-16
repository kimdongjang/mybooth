import { useEffect, useRef, useState } from 'react';
import { uploadProductImage } from '../utils/uploadProductImage';
import { PageIntro } from '../components/PageLayout';
import { Input, ProductImage } from '../components/PosUI';
import ProductValueInput from '../components/ProductValueInput';
import ProductImageControls from '../components/ProductImageControls';
import { prepareProductImage } from '../utils/productImage';
import { uid, productNameFromFields } from '../utils/productDisplay';

export default function ProductCreatePage({ projectId, onImageChange, readOnly, saving, products, persistProducts, onBack }) {
  const [draft, setDraft] = useState(() => ({ id: uid(), goodsType: '새 굿즈', vtuberName: '', creatorName: '', price: '', stockQty: '' }));
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [imageError, setImageError] = useState('');
  const submitting = useRef(false);
  const imageChange = useRef(onImageChange);
  imageChange.current = onImageChange;
  const uploadedImage = useRef(null);
  const savedProduct = useRef(false);
  useEffect(() => {
    if (!image) { setPreview(null); return; }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const chooseImage = async (file) => {
    if (!file) return;
    setPreparing(true);
    try {
      setImage(await prepareProductImage(file));
      setImageError('');
    } catch (error) { alert(error.message); }
    finally { setPreparing(false); }
  };
  const change = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (readOnly || saving || preparing || submitting.current) return;
    const price = Number(draft.price);
    const stockQty = Number(draft.stockQty);
    if (!draft.goodsType.trim() || draft.price === '' || draft.stockQty === '' || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stockQty) || stockQty < 0) return alert('굿즈 종류와 0 이상의 정수 판매가·재고를 입력해주세요.');
    const product = {
      ...draft, productCode: draft.id, goodsType: draft.goodsType.trim(), vtuberName: draft.vtuberName.trim(), creatorName: draft.creatorName.trim(),
      price, stockQty, stock: stockQty, initialStockQty: stockQty, size: '', isActive: true,
      setCreatorName: null, setGroupName: null, setPrice: null, setDescription: null, createdAt: new Date().toISOString(),
    };
    product.name = productNameFromFields(product);
    submitting.current = true;
    setBusy(true);
    setImageError('');
    try {
      if (!registered) {
        const saved = await persistProducts([...products, product]);
        if (!saved) return;
        savedProduct.current = true;
        setRegistered(true);
      }
      if (image) {
        const blob = uploadedImage.current?.file === image ? uploadedImage.current : await uploadProductImage(projectId, draft.id, image);
        uploadedImage.current = { file: image, url: blob.url };
        const attached = await imageChange.current(draft.id, blob.url);
        if (!attached) throw new Error('이미지 연결에 실패했습니다.');
      }
      onBack();
    } catch (error) {
      setImageError(savedProduct.current
        ? `상품은 등록되었지만 이미지 저장에 실패했습니다. 다시 저장하거나 상품 목록에서 이미지를 수정해주세요. ${error.message || ''}`
        : `상품 저장에 실패했습니다. ${error.message || ''}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return <main className="page-content settings-page">
    <PageIntro title="새 상품 등록" actions={<button type="button" disabled={saving || busy || preparing} className="management-back" onClick={onBack}>← 상품 목록으로</button>} />
    <form className="settings-content product-management" onSubmit={submit}>
      <fieldset disabled={readOnly || saving || busy || preparing} className="min-w-0"><div className="management-products">
        <article className="management-product">
          <div className="management-product-header"><h3>새 굿즈</h3></div>
          <div className="management-product-body">
            <div className="management-image">
              <ProductImage imageUrl={preview} name={draft.goodsType} />
              <ProductImageControls hasImage={Boolean(image)} busy={preparing} disabled={readOnly || saving || busy || preparing} onSelect={chooseImage} onRemove={() => { setImage(null); setImageError(''); }} label="새 상품 이미지" />
              <p>선택한 이미지는 상품 저장 시 등록됩니다.</p>
            </div>
            <div className="management-details">
            <fieldset disabled={registered}><legend>기본 정보</legend><div className="management-fields">
              <ProductValueInput label="캐릭터" field="vtuberName" products={products} value={draft.vtuberName} onChange={value => change('vtuberName', value)} disabled={registered || readOnly || saving || busy || preparing} />
              <ProductValueInput label="굿즈 종류" field="goodsType" products={products} value={draft.goodsType} onChange={value => change('goodsType', value)} required disabled={registered || readOnly || saving || busy || preparing} />
              <ProductValueInput label="제작자" field="creatorName" products={products} value={draft.creatorName} onChange={value => change('creatorName', value)} disabled={registered || readOnly || saving || busy || preparing} />
            </div></fieldset>
            <fieldset disabled={registered}><legend>가격 · 재고</legend><div className="management-fields management-fields-three">
              <label className="management-field"><span>판매가 (원)</span><Input required type="number" min="0" step="1" value={draft.price} onChange={value => change('price', value)} /></label>
              <label className="management-field"><span>초기 재고 (개)</span><Input required type="number" min="0" step="1" value={draft.stockQty} onChange={value => change('stockQty', value)} /></label>
            </div></fieldset>
            {imageError && <p role="alert" className="management-note">{imageError}</p>}
            <button type="submit" className="management-add">{saving || busy ? '저장 중…' : registered ? (image ? '이미지 다시 저장' : '등록 완료') : '상품 저장'}</button>
            </div>
          </div>
        </article>
      </div></fieldset>
    </form>
  </main>;
}
