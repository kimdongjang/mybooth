import CreatorField from '../components/CreatorField';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useEffect, useRef, useState } from 'react';
import { uploadProductImage } from '../utils/uploadProductImage';
import { PageIntro } from '../components/PageLayout';
import { Input, ProductImage } from '../components/PosUI';
import InventoryProductFields from '../components/InventoryProductFields';
import { prepareProductImage } from '../utils/productImage';
import { uid } from '../utils/productDisplay';

export default function ProductCreatePage({ projectId, onImageChange, readOnly, saving, products, registerProduct, onBack, artists, saveImage, allowDirectArtist = false,creatorRequest,creatorProject,onRefreshCreators }) {
  const pendingKey = `pos_event_product_registration:${artists ? 'artist:' : ''}${projectId}`;
  const pending = useRef(null);
  const [draft, setDraft] = useState(() => {
    try { pending.current = JSON.parse(sessionStorage.getItem(pendingKey) || 'null'); } catch { /* Keep unreadable storage untouched. */ }
    return pending.current || { id: artists ? crypto.randomUUID() : uid(), name: '', goodsType: '', vtuberName: '', creatorName: '', genre: '', price: 1000, stockQty: 0 };
  });
  const original = useRef(JSON.stringify(draft));
  const [uncertain, setUncertain] = useState(Boolean(pending.current));
  const [image, setImage] = useState(null);
  const clearUnsaved = useUnsavedChanges(JSON.stringify(draft) !== original.current || Boolean(image));
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [creatorBusy,setCreatorBusy]=useState(false);
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
    if (readOnly || saving || preparing || creatorBusy || submitting.current) return;
    const price = Number(draft.price);
    const stockQty = Number(draft.stockQty);
    if (artists && !allowDirectArtist && !artists.some(artist => artist.ownerId === draft.ownerId)) return alert('행사에 등록된 제작자를 선택해주세요.');
    if (!draft.name.trim() || !draft.goodsType.trim() || draft.price === '' || draft.stockQty === '' || !Number.isSafeInteger(price) || price < 0 || price > 2147483647 || !Number.isSafeInteger(stockQty) || stockQty < 0 || stockQty > 2147483647) return alert('상품 이름, 굿즈 종류와 0 이상의 정수 판매가·재고를 입력해주세요.');
    const product = {
      ...draft, name: draft.name.trim(), productCode: draft.id, goodsType: draft.goodsType.trim(), vtuberName: draft.vtuberName.trim(), creatorName: artists ? (artists.find(artist => artist.ownerId === draft.ownerId)?.label || draft.creatorName || draft.artistName?.trim() || '') : draft.creatorName.trim(), genre: draft.genre.trim(),
      price, stockQty, stock: stockQty, initialStockQty: stockQty, size: '', isActive: true,
      setCreatorName: null, setGroupName: null, setPrice: null, setDescription: null, createdAt: new Date().toISOString(),
    };
    submitting.current = true;
    setBusy(true);
    setImageError('');
    try {
      if (!registered) {
        const request = pending.current || product;
        sessionStorage.setItem(pendingKey, JSON.stringify(request));
        pending.current = request;
        setUncertain(true);
        await registerProduct(request);
        sessionStorage.removeItem(pendingKey);
        pending.current = null;
        setUncertain(false);
        savedProduct.current = true;
        setRegistered(true);
      }
      if (image && saveImage) await saveImage(image);
      else if (image) {
        const blob = uploadedImage.current?.file === image ? uploadedImage.current : await uploadProductImage(projectId, draft.id, image);
        uploadedImage.current = { file: image, url: blob.url };
        const attached = await imageChange.current(draft.id, blob.url);
        if (!attached) throw new Error('이미지 연결에 실패했습니다.');
      }
      clearUnsaved();
      onBack();
    } catch (error) {
      if (!savedProduct.current && error.status >= 400 && error.status < 500) { sessionStorage.removeItem(pendingKey); pending.current = null; setUncertain(false); }
      setImageError(savedProduct.current
        ? `상품은 등록되었지만 이미지 저장에 실패했습니다. 다시 저장하거나 상품 목록에서 이미지를 수정해주세요. ${error.message || ''}`
        : `상품 저장에 실패했습니다. ${error.message || ''}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return <main className="page-content inventory-page">
    <PageIntro title="새 상품 등록" actions={<button type="button" disabled={saving || busy || preparing} className="management-back" onClick={onBack}>← 상품 목록으로</button>} />
    <form className="settings-content product-management" onSubmit={submit}>
      <fieldset disabled={readOnly || saving || busy || preparing} className="min-w-0"><div className="management-products">
        <article className="management-product">
          <div className="management-product-header"><h3>{draft.name || '새 상품'}</h3></div>
          <div className="management-product-body">
            <div className="management-image">
              <ProductImage imageUrl={preview} name={draft.name} />
              <label className="management-upload"><span>{preparing ? '이미지 축소 중…' : image ? '이미지 수정' : '이미지 등록'}</span><input aria-label="새 상품 이미지 등록 또는 수정" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; chooseImage(file); }} /></label>
              {image && <button type="button" className="management-delete" onClick={() => { setImage(null); setImageError(''); }}>이미지 제거</button>}
              <p>선택한 이미지는 상품 저장 시 등록됩니다.</p>
            </div>
            <div className="management-details">
            {artists&&<CreatorField onBusyChange={setCreatorBusy} creators={artists} value={draft} onChange={value=>setDraft(current=>({...current,...value,creatorName:value.label||value.artistName||''}))} request={creatorRequest} project={creatorProject} allowDirect={allowDirectArtist} disabled={registered||uncertain} onRefresh={onRefreshCreators}/>}
            <InventoryProductFields hideCreator={Boolean(artists)} draft={draft} products={products} onChange={change} disabled={registered || uncertain || readOnly || saving || busy || preparing} />
            <fieldset disabled={registered || uncertain}><legend>가격 · 재고</legend><div className="management-fields">
              <label className="management-field"><span>판매가 (원)</span><Input required type="number" min="0" max="2147483647" step="1" value={draft.price} onChange={value => change('price', value)} /></label>
              <label className="management-field"><span>최초 입고 수량</span><Input required type="number" min="0" max="2147483647" step="1" value={draft.stockQty} onChange={value => change('stockQty', value)} /></label>
            </div></fieldset>
            <p className="management-note">최초 입고 수량을 상품·재고에 기록하고 전량을 현재 행사에 배정합니다. 판매가는 이 행사에만 적용됩니다.</p>
            {uncertain && <p role="status" className="management-note">이전 등록의 완료 여부를 확인해야 합니다. 같은 내용으로 다시 시도하면 중복 없이 결과를 확인합니다.</p>}
            {imageError && <p role="alert" className="management-note">{imageError}</p>}
            <button data-guide="save" type="submit" className="management-add" disabled={creatorBusy}>{saving || busy ? '저장 중…' : registered ? (image ? '이미지 다시 저장' : '등록 완료') : '상품 등록'}</button>
            </div>
          </div>
        </article>
      </div></fieldset>
    </form>
  </main>;
}
