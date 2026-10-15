import { useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { prepareProductImage, PRODUCT_IMAGE_HELP } from '../utils/productImage';

export default function BulkProductImages({ projectId, products, persistProducts, onImageChange, disabled, onBusy }) {
  const picker = useRef(null);
  const running = useRef(false);
  const latest = useRef({ products, persistProducts, onImageChange });
  latest.current = { products, persistProducts, onImageChange };
  const [pending, setPending] = useState([]);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState([]);
  const process = async (files) => {
    if (running.current || disabled) return;
    if (!navigator.onLine) return setMessage('이미지 일괄 추가는 인터넷 연결이 필요합니다.');
    running.current = true;
    onBusy(true);
    setErrors([]);
    let entries = pending;
    const failures = [];
    try {
      if (files) {
        entries = [];
        for (const file of files) {
          setMessage(`이미지 확인 중… ${entries.length + failures.length + 1} / ${files.length}`);
          try {
            const image = await prepareProductImage(file);
            const id = crypto.randomUUID();
            const name = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 100) || '새 굿즈';
            entries.push({ image, filename: file.name, product: {
              id, productCode: id, name, goodsType: name, vtuberName: '', creatorName: '',
              price: 0, stock: 0, stockQty: 0, initialStockQty: 0, size: '', isActive: true,
              setCreatorName: null, setGroupName: null, setPrice: null, setDescription: null,
              createdAt: new Date().toISOString(),
            } });
          } catch (error) { failures.push(`${file.name}: ${error.message}`); }
        }
        if (!entries.length) { setMessage('등록할 수 있는 이미지가 없습니다.'); return; }
        setMessage(`상품 ${entries.length}개 등록 중…`);
        const saved = await latest.current.persistProducts([...latest.current.products, ...entries.map(entry => entry.product)]);
        if (!saved) { setMessage('상품 등록을 확인하지 못했습니다. 목록을 확인한 뒤 다시 시도해주세요.'); return; }
      }
      const remaining = [];
      let completed = 0;
      for (const entry of entries) {
        setMessage(`이미지 저장 중… ${++completed} / ${entries.length}`);
        try {
          if (!entry.url) {
            const extension = entry.image.type === 'image/webp' ? 'webp' : 'png';
            const blob = await upload(`products/${encodeURIComponent(projectId)}/${entry.product.id}/${crypto.randomUUID()}.${extension}`, entry.image, {
              access: 'public', handleUploadUrl: '/api/product-images', contentType: entry.image.type,
              clientPayload: JSON.stringify({ projectId, productId: entry.product.id }),
              headers: { Authorization: `Bearer ${sessionStorage.getItem('pos_admin_token')}` },
            });
            entry.url = blob.url;
          }
          if (!await latest.current.onImageChange(entry.product.id, entry.url)) throw new Error('이미지 연결에 실패했습니다.');
        } catch (error) {
          remaining.push(entry);
          failures.push(`${entry.filename}: ${error.message}`);
        }
      }
      setPending(remaining);
      setMessage(`상품 ${entries.length}개 등록됨 · 이미지 ${entries.length - remaining.length}개 저장 완료${remaining.length ? ` · ${remaining.length}개 재시도 필요` : ''}. 상품 이름을 눌러 가격·재고·제작자를 수정하세요.`);
    } catch (error) { setMessage(error.message || '일괄 추가에 실패했습니다.'); }
    finally { setErrors(failures); running.current = false; onBusy(false); }
  };
  return <div className="bulk-product-images">
    <input ref={picker} hidden type="file" multiple accept="image/jpeg,image/png,image/webp" aria-label="상품 이미지 여러 장 선택" onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; if (files.length) process(files); }} />
    <button type="button" className="management-add" disabled={disabled || pending.length > 0} onClick={() => picker.current?.click()}>이미지로 일괄 추가</button>
    <p className="management-note">이미지를 선택하면 파일명으로 상품이 바로 등록됩니다. 판매가·초기 재고는 0이며 나중에 수정할 수 있습니다. {PRODUCT_IMAGE_HELP}</p>
    {message && <p role="status" className="management-note">{message}</p>}
    {errors.length > 0 && <ul className="management-note" role="alert">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
    {pending.length > 0 && <><button type="button" className="management-back" disabled={disabled} onClick={() => process(null)}>실패한 이미지 다시 저장</button><button type="button" className="management-back" disabled={disabled} onClick={() => { setPending([]); setErrors([]); setMessage('등록된 상품은 유지됩니다. 상품 상세에서 이미지를 수정할 수 있습니다.'); }}>나중에 상세에서 수정</button></>}
  </div>;
}
