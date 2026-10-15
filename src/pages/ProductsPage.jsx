import { useEffect, useMemo, useRef, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { managementQuantities, managementBundleStock } from '../utils/managementQuantities';
import { uid, won, creatorNameOf, productNameFromFields, productNameWithoutCreator } from '../utils/productDisplay';
import { Input, Panel, Quantity, StockAdjustment, ProductImage } from '../components/PosUI';
import { PageIntro, PageTabs } from '../components/PageLayout';
const AUTH_TOKEN_KEY = 'pos_admin_token';

export default function ProductsPage({ projectId, settingsTab, setSettingsTab, saving, mutate, products, bundles, sales, persistProducts, persistBundles, resetDefaults, updateToLatestDefaults, bundleName, setBundleName, bundleRows, setBundleRows, bundlePrice, setBundlePrice, addBundleToSettings, backupOrdersJson, backupOrdersCsv }) {
  return <main className="page-content settings-page"><PageIntro title="상품 관리" description="상품과 세트의 가격·재고를 관리하고 주문 데이터를 백업하세요."><PageTabs id="settings" label="상품 및 주문 관리" tabs={[["products", "상품 관리"], ["bundles", "세트 관리"], ["backup", "주문 백업"]]} selected={settingsTab} onSelect={setSettingsTab} /></PageIntro><div id={`settings-panel-${settingsTab}`} role="tabpanel" aria-labelledby={`settings-tab-${settingsTab}`} tabIndex={0} className="settings-content">{settingsTab === 'products' && <ProductSettingsPanel key={projectId} projectId={projectId} saving={saving} onImageChange={(productId, imageUrl) => mutate('updateProductImage', { productId, imageUrl })} products={products} bundles={bundles} sales={sales} persistProducts={persistProducts} persistBundles={persistBundles} onResetDefaults={resetDefaults} onUpdateLatest={updateToLatestDefaults} />}{settingsTab === 'bundles' && <section className="product-management"><header className="management-heading"><div><h2>세트 관리</h2><p>구성품과 판매 현황을 확인하고 새 세트를 등록하세요.</p></div></header><div className="management-summary"><span>등록 세트 <b>{bundles.length}개</b></span><span role="status">{saving ? '변경 사항 저장 중…' : '수량은 자동으로 계산됩니다'}</span></div><p className="management-note">판매 가능 수량은 현재 구성품의 남은 재고 기준이며, 다른 세트와 재고를 공유합니다.</p><BundleManagementTable bundles={bundles} products={products} sales={sales} persistBundles={persistBundles} />{!bundles.length && <div className="management-empty"><h3>등록된 세트가 없습니다</h3><p>아래에서 구성품과 판매가를 입력하세요.</p></div>}<section className="management-product bundle-management-body"><h3>새 세트 등록</h3><div className="mt-3 flex flex-col gap-2 border-t border-dashed border-line pt-3"><label className="management-field"><span>세트 이름</span><Input value={bundleName} onChange={setBundleName} placeholder="예: 아크릴+포카 세트" /></label>{bundleRows.map((row, idx) => <div className="flex gap-1.5" key={idx}><select aria-label={`구성품 ${idx + 1}`} className="min-w-0 flex-1 rounded border border-line p-1.5 text-xs" value={row.productId} onChange={(e) => setBundleRows(bundleRows.map((r, i) => i === idx ? { ...r, productId: e.target.value } : r))}><option value="">굿즈 선택</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><Input aria-label={`구성품 ${idx + 1} 수량`} min="1" step="1" type="number" className="w-[70px]" value={row.qty} onChange={(v) => setBundleRows(bundleRows.map((r, i) => i === idx ? { ...r, qty: v } : r))} /><button type="button" className="management-delete" aria-label={`구성품 ${idx + 1} 제거`} disabled={bundleRows.length === 1} onClick={() => setBundleRows(bundleRows.filter((_, i) => i !== idx))}>제거</button></div>)}<button className="self-start rounded bg-transfer px-2.5 py-1.5 text-xs text-white" onClick={() => setBundleRows([...bundleRows, { productId: '', qty: 1 }])}>+ 구성품 추가</button><label className="management-field"><span>판매가 (원)</span><Input min="0" step="1" type="number" value={bundlePrice} onChange={setBundlePrice} placeholder="0" /></label><button className="self-start rounded-md bg-register-2 px-3.5 py-2 text-xs text-white" onClick={addBundleToSettings}>세트 저장</button></div></section></section>}{settingsTab === 'backup' && <Panel title="주문 백업 (IndexedDB)"><p className="mb-3 text-xs text-[#526078]">현재 브라우저 IndexedDB에 저장된 모든 주문과 동기화 상태를 다운로드합니다.</p><div className="flex gap-2"><button className="rounded-md bg-register-2 px-3 py-2 text-xs text-white" onClick={backupOrdersJson}>주문 백업(JSON)</button><button className="rounded-md bg-transfer px-3 py-2 text-xs text-white" onClick={backupOrdersCsv}>주문 백업(CSV)</button></div></Panel>}</div></main>;
}


function BundleManagementTable({ bundles, products, sales, persistBundles }) {
  const quantities = managementQuantities(sales, bundles);
  const productsById = new Map(products.map((product) => [product.id, product]));
  return <div className="management-table-wrap"><table className="management-table bundle-management-table" role="table">
    <caption className="sr-only">세트 이름, 구성품, 판매가, 판매 수량, 판매 가능 수량, 관리 목록</caption>
    <thead role="rowgroup"><tr role="row">{['세트 이름', '구성품', '판매가', '판매 수량', '판매 가능 수량', '관리'].map((label) => <th key={label} scope="col" role="columnheader">{label}</th>)}</tr></thead>
    <tbody role="rowgroup">{bundles.map((bundle) => <tr key={bundle.id} role="row">
      <td role="cell" data-label="세트 이름"><span className="management-row-name">{bundle.name}</span></td>
      <td role="cell" data-label="구성품" className="management-components-cell"><ul className="bundle-table-components">{bundle.items.map((item, index) => {
        const product = productsById.get(item.productId);
        return <li key={index}>{product ? productNameWithoutCreator(product) : '삭제된 상품'} · {item.qty}개<small>{product ? creatorNameOf(product) : '구성 확인 필요'}</small></li>;
      })}</ul></td>
      <td role="cell" data-label="판매가" className="mono management-row-price">{won(bundle.price)}원</td>
      <td role="cell" data-label="판매 수량" className="mono">{won(quantities.bundles.get(bundle.id) || 0)}개</td>
      <td role="cell" data-label="판매 가능 수량" className="mono">{won(managementBundleStock(bundle, products))}개</td>
      <td role="cell" data-label="관리"><button type="button" className="management-delete" aria-label={`${bundle.name} 세트 삭제`} onClick={() => confirm('세트를 삭제할까요?') && persistBundles(bundles.filter((item) => item.id !== bundle.id))}>삭제</button></td>
    </tr>)}</tbody>
  </table></div>;
}

function ProductSettingsPanel({ projectId, saving, onImageChange, products, bundles, sales, persistProducts, persistBundles, onResetDefaults, onUpdateLatest }) {
  const quantities = managementQuantities(sales, bundles);
  const [uploadingId, setUploadingId] = useState(null);
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const backButton = useRef(null);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(products.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const selectedProduct = products.find((product) => product.id === selectedId);
  useEffect(() => { setPage((previous) => Math.min(previous, pageCount)); }, [pageCount]);
  useEffect(() => { if (selectedProduct) backButton.current?.focus(); }, [selectedProduct?.id]);
  const uploadImage = async (product, file) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return alert('JPG, PNG, WebP 이미지를 5MB 이하로 선택해주세요.');
    if (!navigator.onLine) return alert('이미지 등록은 인터넷 연결이 필요합니다.');
    setUploadingId(product.id);
    try {
      const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
      const blob = await upload(`products/${encodeURIComponent(projectId)}/${encodeURIComponent(product.id)}/${crypto.randomUUID()}.${extension}`, file, {
        access: 'public', handleUploadUrl: '/api/product-images', contentType: file.type,
        clientPayload: JSON.stringify({ projectId, productId: product.id }),
        headers: { Authorization: `Bearer ${sessionStorage.getItem(AUTH_TOKEN_KEY)}` },
      });
      await onImageChange(product.id, blob.url);
    } catch (error) { alert(error.message || '이미지 등록에 실패했습니다.'); }
    finally { setUploadingId(null); }
  };
  const sortedProducts = useMemo(() => [...products].sort((a, b) => String(a.productCode || a.id).localeCompare(String(b.productCode || b.id), 'ko-KR', { numeric: true })), [products]);
  const updateProduct = (id, patch) => persistProducts(products.map((product) => {
    if (product.id !== id) return product;
    const next = { ...product, ...patch };
    const stockQty = Number(next.stockQty ?? next.stock ?? 0) || 0;
    return { ...next, stockQty, stock: stockQty, name: productNameFromFields(next) };
  }));
  const addProduct = () => {
    const id = uid();
    persistProducts([...products, {
      id,
      productCode: id,
      goodsType: '새 굿즈',
      vtuberName: '',
      creatorName: '',
      stockQty: 0,
      initialStockQty: 0,
      size: '',
      price: 0,
      setCreatorName: null,
      setGroupName: null,
      setPrice: null,
      setDescription: null,
      isActive: true,
      name: '새 굿즈',
      stock: 0,
      createdAt: new Date().toISOString(),
    }]);
    setSelectedId(id);
  };
  const deleteProduct = (productId) => {
    if (!confirm('이 굿즈를 삭제할까요? 세트 구성에서도 제거됩니다.')) return;
    persistProducts(products.filter((x) => x.id !== productId));
    persistBundles(bundles.map((b) => ({ ...b, items: b.items.filter((it) => it.productId !== productId) })).filter((b) => b.items.length));
  };

  const field = (product, title, value, patch, type = 'text') => <label className="management-field"><span>{title}</span><Input type={type} value={value} onChange={(v) => updateProduct(product.id, patch(v))} /></label>;

  return <section className="product-management">
    <header className="management-heading">
      <div><h2>{selectedProduct ? '상품 상세' : '상품 목록'}</h2>{selectedProduct && <p>이미지와 상품 정보를 수정하세요. 수정한 내용은 자동으로 저장됩니다.</p>}</div>
      {selectedProduct ? <button ref={backButton} type="button" className="management-back" onClick={() => setSelectedId(null)}>← 목록으로</button> : <button type="button" className="management-add" onClick={addProduct}>+ 상품 추가</button>}
    </header>
    <div className="management-summary"><span>등록 상품 <b>{products.length}개</b></span><span role="status">{saving ? '변경 사항 저장 중…' : '상품 정보를 수정할 수 있습니다'}</span></div>
    <p className="management-note">등록 수량은 기존 초기 재고와 추가 입고의 합계입니다. 판매 수량은 현재 판매 내역의 단품·세트 구성품을 합산합니다. 취소된 판매는 제외하며, 구성 정보가 없는 과거 세트 판매는 현재 구성 기준입니다.</p>
    {!selectedProduct && <>
      <div className="management-table-wrap"><table className="management-table product-management-table" role="table">
        <caption className="sr-only">상품 이름, 제작자, 판매가, 등록 수량, 판매 수량, 남은 재고, 등록일 목록</caption>
        <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">상품 이름</th><th scope="col" role="columnheader">제작자</th><th scope="col" role="columnheader">판매가</th><th scope="col" role="columnheader">등록 수량</th><th scope="col" role="columnheader">판매 수량</th><th scope="col" role="columnheader">남은 재고</th><th scope="col" role="columnheader">등록일</th></tr></thead>
        <tbody role="rowgroup">{sortedProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((p) => <tr key={p.id} role="row">
          <td role="cell" data-label="상품 이름"><span className="management-row-name">{productNameWithoutCreator(p)}</span><button type="button" className="management-detail-link" aria-label={`${productNameWithoutCreator(p)} 상세보기`} onClick={() => setSelectedId(p.id)}>상세보기</button></td>
          <td role="cell" data-label="제작자">{creatorNameOf(p)}</td><td role="cell" data-label="판매가" className="mono management-row-price">{won(p.price)}원</td>
          <td role="cell" data-label="등록 수량" className="mono">{won(p.initialStockQty ?? 0)}개</td><td role="cell" data-label="판매 수량" className="mono">{won(quantities.products.get(p.id) || 0)}개</td><td role="cell" data-label="남은 재고" className="mono">{won(p.stockQty ?? p.stock ?? 0)}개</td>
          <td role="cell" data-label="등록일">{p.createdAt && !Number.isNaN(new Date(p.createdAt).getTime()) ? <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '')}</time> : '—'}</td>
        </tr>)}</tbody>
      </table>{!products.length && <div className="management-empty"><h3>등록된 상품이 없습니다</h3><p>상품 추가 버튼으로 첫 상품을 등록하세요.</p></div>}</div>
      <nav className="management-pagination" aria-label="상품 목록 페이지"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></nav>
    </>}
    {selectedProduct && <div className="management-products">
      {[selectedProduct].map((p) => <article className="management-product" key={p.id}>
        <div className="management-product-header"><h3>{productNameWithoutCreator(p)}</h3><button type="button" className="management-delete" aria-label={`${p.name} 상품 삭제`} onClick={() => deleteProduct(p.id)}>삭제</button></div>
        <div className="management-product-body">
          <div className="management-image">
            <ProductImage imageUrl={p.imageUrl} name={p.name} />
            <label className="management-upload"><span>{uploadingId === p.id ? '업로드 중…' : p.imageUrl ? '이미지 수정' : '이미지 등록'}</span><input aria-label={`${p.name} 이미지 등록 또는 수정`} type="file" accept="image/jpeg,image/png,image/webp" disabled={saving || uploadingId !== null} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadImage(p, file); }} /></label>
            {p.imageUrl && <button type="button" disabled={saving || uploadingId !== null} className="management-delete" onClick={() => onImageChange(p.id, null)}>이미지 제거</button>}
            <p>JPG · PNG · WebP / 최대 5MB</p>
          </div>
          <div className="management-details">
            <fieldset><legend>기본 정보</legend><div className="management-fields">
              {field(p, '상품 코드', p.productCode || p.id, (v) => ({ productCode: v }))}
              {field(p, '버튜버', p.vtuberName || '', (v) => ({ vtuberName: v }))}
              {field(p, '굿즈 종류', p.goodsType || '', (v) => ({ goodsType: v }))}
              {field(p, '제작자', p.creatorName || '', (v) => ({ creatorName: v }))}
            </div></fieldset>
            <fieldset><legend>가격 · 재고</legend><div className="management-fields management-fields-three">
              {field(p, '판매가 (원)', p.price, (v) => ({ price: Number(v) || 0 }), 'number')}
              <Quantity label="등록 수량" value={p.initialStockQty ?? 0} />
              <Quantity label="판매 수량" value={quantities.products.get(p.id) || 0} />
              <Quantity label="남은 재고" value={p.stockQty ?? p.stock ?? 0} />
              <StockAdjustment key={p.id} product={p} onSave={(patch) => updateProduct(p.id, patch)} saving={saving} />
            </div></fieldset>
            <fieldset><legend>세트 정보 <span>선택 입력</span></legend><div className="management-fields">
              {field(p, '세트명', p.setGroupName || '', (v) => ({ setGroupName: v || null, setCreatorName: v ? (p.creatorName || p.setCreatorName) : null }))}
              {field(p, '세트가 (원)', p.setPrice ?? '', (v) => ({ setPrice: v === '' ? null : Number(v) || 0 }), 'number')}
            </div></fieldset>
          </div>
        </div>
      </article>)}
    </div>}
    {!selectedProduct && <aside className="management-defaults"><div><h3>기본 상품 목록</h3><p>누락된 기본 상품·세트만 추가하거나, 상품·세트·재고를 기본 44종으로 초기화할 수 있습니다.</p></div><div className="management-default-actions"><button type="button" onClick={onUpdateLatest}>없는 기본 상품/세트 추가</button><button type="button" className="management-delete" onClick={onResetDefaults}>기본 44종 목록으로 초기화</button></div></aside>}
  </section>;
}
