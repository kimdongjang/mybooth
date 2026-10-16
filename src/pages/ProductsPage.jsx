import InventoryPage from './InventoryPage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { uploadProductImage } from '../utils/uploadProductImage';
import { managementQuantities, managementBundleStock } from '../utils/managementQuantities';
import { won, creatorNameOf, productNameWithoutCreator } from '../utils/productDisplay';
import { Panel, Quantity, ProductImage } from '../components/PosUI';
import { prepareProductImage } from '../utils/productImage';
import ProductCreatePage from './ProductCreatePage';
import BulkProductImages from './BulkProductImages';
import BundleCreatePage from './BundleCreatePage';
import ActionIcon from '../components/ActionIcon';
import ProductEditForm from '../components/ProductEditForm';
import ProductStockForm from '../components/ProductStockForm';
import { PageIntro, PageTabs } from '../components/PageLayout';

export default function ProductsPage({ inventoryApi, adminId, readOnly, projectId, settingsTab, setSettingsTab, saving, mutate, products, bundles, sales, persistProducts, persistBundles, creatingBundle, creatingProduct, navigate, bundleName, setBundleName, bundleRows, setBundleRows, bundlePrice, setBundlePrice, addBundleToSettings, backupOrdersJson, backupOrdersCsv }) {
  const [selectedBundleId, setSelectedBundleId] = useState(null);
  const selectedBundle = bundles.find((bundle) => bundle.id === selectedBundleId);
  useEffect(() => { setSelectedBundleId(null); }, [settingsTab, projectId]);
  if (creatingProduct) return <ProductCreatePage projectId={projectId} onImageChange={(productId, imageUrl) => mutate('updateProductImage', { productId, imageUrl })} key={projectId} readOnly={readOnly} saving={saving} products={products} persistProducts={persistProducts} onBack={() => navigate('settings', 'products')} />;
  if (creatingBundle) return <BundleCreatePage readOnly={readOnly} saving={saving} products={products} bundleName={bundleName} setBundleName={setBundleName} bundleRows={bundleRows} setBundleRows={setBundleRows} bundlePrice={bundlePrice} setBundlePrice={setBundlePrice} onSave={addBundleToSettings} onBack={() => navigate('settings')} />;
  return <main className="page-content settings-page"><PageIntro title="상품 관리"><PageTabs id="settings" label="상품 및 주문 관리" tabs={[["products", "상품 관리"], ["bundles", "세트 관리"], ["backup", "주문 백업"]]} selected={settingsTab} onSelect={setSettingsTab} /></PageIntro><div id={`settings-panel-${settingsTab}`} role="tabpanel" aria-labelledby={`settings-tab-${settingsTab}`} tabIndex={0} className="settings-content">{settingsTab === 'products' && <InventoryPage embedded adminId={adminId} projects={[{ id: projectId, name: '현재 행사', archivedAt: readOnly ? true : null }]} api={inventoryApi} />} {settingsTab === 'products' && <ProductSettingsPanel onAdd={() => navigate('inventory')} readOnly={readOnly} key={projectId} projectId={projectId} saving={saving} onImageChange={(productId, imageUrl) => mutate('updateProductImage', { productId, imageUrl })} products={products} bundles={bundles} sales={sales} persistProducts={persistProducts} persistBundles={persistBundles} />}{settingsTab === 'bundles' && (selectedBundle ? <BundleDetail readOnly={readOnly} bundle={selectedBundle} products={products} sales={sales} bundles={bundles} persistBundles={persistBundles} onBack={() => setSelectedBundleId(null)} /> : <section className="product-management"><header className="management-heading"><div><h2>세트 목록</h2></div><button type="button" disabled={readOnly || saving} className="management-add" onClick={() => navigate('bundleNew')}>+ 세트 추가</button></header><div className="management-summary"><span>등록 세트 <b>{bundles.length}개</b></span><span role="status">{saving ? '변경 사항 저장 중…' : '수량은 자동으로 계산됩니다'}</span></div><p className="management-note">판매 가능 수량은 현재 구성품의 남은 재고 기준이며, 다른 세트와 재고를 공유합니다.</p><BundleManagementTable readOnly={readOnly} bundles={bundles} products={products} sales={sales} persistBundles={persistBundles} onSelect={setSelectedBundleId} />{!bundles.length && <div className="management-empty"><h3>등록된 세트가 없습니다</h3><p>세트 추가 버튼으로 구성품과 판매가를 입력하세요.</p></div>}</section>)}{settingsTab === 'backup' && <Panel title="주문 백업 (IndexedDB)"><p className="mb-3 text-xs text-[#526078]">현재 브라우저 IndexedDB에 저장된 모든 주문과 동기화 상태를 다운로드합니다.</p><div className="flex gap-2"><button className="rounded-md bg-register-2 px-3 py-2 text-xs text-white" onClick={backupOrdersJson}>주문 백업(JSON)</button><button className="rounded-md bg-transfer px-3 py-2 text-xs text-white" onClick={backupOrdersCsv}>주문 백업(CSV)</button></div></Panel>}</div></main>;
}


function BundleManagementTable({ readOnly, bundles, products, sales, persistBundles, onSelect }) {
  const quantities = managementQuantities(sales, bundles);
  const productsById = new Map(products.map((product) => [product.id, product]));
  return <div className="management-table-wrap"><table className="management-table bundle-management-table" role="table">
    <caption className="sr-only">세트 이름, 구성품, 판매가, 판매수량, 판매 가능 수량, 관리 목록</caption>
    <thead role="rowgroup"><tr role="row">{['세트 이름', '구성품', '판매가', '판매수량', '판매 가능 수량', '관리'].map((label) => <th key={label} scope="col" role="columnheader">{label}</th>)}</tr></thead>
    <tbody role="rowgroup">{bundles.map((bundle) => <tr key={bundle.id} role="row">
      <td role="cell" data-label="세트 이름"><button type="button" className="management-name-link" aria-label={`${bundle.name} 상세보기`} onClick={() => onSelect(bundle.id)}>{bundle.name}</button><small className="management-mobile-meta">{bundle.items.length}종 구성</small></td>
      <td role="cell" data-label="구성품" className="management-components-cell"><ul className="bundle-table-components">{bundle.items.map((item, index) => {
        const product = productsById.get(item.productId);
        return <li key={index}>{product ? productNameWithoutCreator(product) : '삭제된 상품'} · {item.qty}개<small>{product ? creatorNameOf(product) : '구성 확인 필요'}</small></li>;
      })}</ul></td>
      <td role="cell" data-label="판매가" className="mono management-row-price">{won(bundle.price)}원</td>
      <td role="cell" data-label="판매수량" className="mono">{won(quantities.bundles.get(bundle.id) || 0)}개</td>
      <td role="cell" data-label="판매 가능 수량" className="mono">{won(managementBundleStock(bundle, products))}개</td>
      <td role="cell" data-label="관리"><button type="button" disabled={readOnly} className="management-delete" aria-label={`${bundle.name} 세트 삭제`} onClick={() => confirm('세트를 삭제할까요?') && persistBundles(bundles.filter((item) => item.id !== bundle.id))}>삭제</button></td>
    </tr>)}</tbody>
  </table></div>;
}

function BundleDetail({ readOnly, bundle, products, sales, bundles, persistBundles, onBack }) {
  const backButton = useRef(null);
  useEffect(() => { backButton.current?.focus(); }, []);
  return <section className="product-management">
    <header className="management-heading"><h2>세트 상세</h2><button ref={backButton} type="button" className="management-back" onClick={onBack}>← 목록으로</button></header>
    <article className="management-product">
      <div className="management-product-header"><h3>{bundle.name}</h3><button type="button" disabled={readOnly} className="management-delete" onClick={() => { if (confirm('세트를 삭제할까요?')) persistBundles(bundles.filter((item) => item.id !== bundle.id)); }}>삭제</button></div>
      <div className="bundle-management-body"><div className="management-fields management-fields-three">
        <div className="management-field"><span>판매가</span><strong>{won(bundle.price)}원</strong></div>
        <Quantity label="판매수량" value={managementQuantities(sales, bundles).bundles.get(bundle.id) || 0} />
        <Quantity label="판매 가능 수량" value={managementBundleStock(bundle, products)} />
      </div><p className="management-note">판매 가능 수량은 구성품의 남은 재고 기준이며 다른 세트와 재고를 공유합니다.</p><h4>세트 구성</h4>
      <ul className="bundle-components">{bundle.items.map((item, index) => {
        const product = products.find((p) => p.id === item.productId);
        return <li key={index}><span>{product ? productNameWithoutCreator(product) : '삭제된 상품'}<small>{product ? creatorNameOf(product) : '구성 확인 필요'}</small><small>남은 재고 {won(product?.stockQty ?? product?.stock ?? 0)}개</small></span><strong>{item.qty}개</strong></li>;
      })}</ul></div>
    </article>
  </section>;
}

function ProductSettingsPanel({ onAdd, readOnly, projectId, saving, onImageChange, products, bundles, sales, persistProducts, persistBundles }) {
  const [bulkBusy, setBulkBusy] = useState(false);
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
    if (!navigator.onLine) return alert('이미지 등록은 인터넷 연결이 필요합니다.');
    setUploadingId(product.id);
    try {
      const thumbnail = await prepareProductImage(file);
      const blob = await uploadProductImage(projectId, product.id, thumbnail);
      await onImageChange(product.id, blob.url);
    } catch (error) { alert(error.message || '이미지 등록에 실패했습니다.'); }
    finally { setUploadingId(null); }
  };
  const sortedProducts = useMemo(() => [...products].sort((a, b) => String(a.productCode || a.id).localeCompare(String(b.productCode || b.id), 'ko-KR', { numeric: true })), [products]);
  const updateProduct = (id, patch) => persistProducts(products.map((product) => {
    if (product.id !== id) return product;
    const next = { ...product, ...patch };
    const stockQty = Number(next.stockQty ?? next.stock ?? 0) || 0;
    return { ...next, stockQty, stock: stockQty };
  }));
  const deleteProduct = (productId) => {
    if (!confirm('이 굿즈를 삭제할까요? 세트 구성에서도 제거됩니다.')) return;
    persistProducts(products.filter((x) => x.id !== productId));
    persistBundles(bundles.map((b) => ({ ...b, items: b.items.filter((it) => it.productId !== productId) })).filter((b) => b.items.length));
  };

  return <section className="product-management"><fieldset disabled={bulkBusy} className="min-w-0">
    <header className="management-heading">
      <div><h2>{selectedProduct ? '상품 상세' : '상품 목록'}</h2></div>
      {selectedProduct ? <button ref={backButton} type="button" className="management-back" onClick={() => setSelectedId(null)}>← 목록으로</button> : <BulkProductImages projectId={projectId} products={products} persistProducts={persistProducts} onImageChange={onImageChange} disabled={readOnly || saving || bulkBusy} onBusy={setBulkBusy} extraAction={<button type="button" className="management-add" onClick={onAdd}><ActionIcon />재고 관리에서 상품 등록</button>} />}
    </header>
    <div className="management-summary"><span>등록 상품 <b>{products.length}개</b></span><span role="status">{saving ? '변경 사항 저장 중…' : ''}</span></div>
    {!selectedProduct && <>
      <div className="management-table-wrap"><table className="management-table product-management-table" role="table">
        <caption className="sr-only">상품 이름, 제작자, 판매가, 초기재고, 판매수량, 남은 재고, 등록일 목록</caption>
        <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">상품 이름</th><th scope="col" role="columnheader">제작자</th><th scope="col" role="columnheader">판매가</th><th scope="col" role="columnheader">초기재고</th><th scope="col" role="columnheader">판매수량</th><th scope="col" role="columnheader">남은 재고</th><th scope="col" role="columnheader">등록일</th></tr></thead>
        <tbody role="rowgroup">{sortedProducts.slice((currentPage - 1) * pageSize, currentPage * pageSize).map((p) => <tr key={p.id} role="row">
          <td role="cell" data-label="상품 이름"><button type="button" data-guide="detail" className="management-name-link" aria-label={`${productNameWithoutCreator(p)} 상세보기`} onClick={() => setSelectedId(p.id)}>{productNameWithoutCreator(p)}</button><small className="management-mobile-meta">{creatorNameOf(p)}</small></td>
          <td role="cell" data-label="제작자">{creatorNameOf(p)}</td><td role="cell" data-label="판매가" className="mono management-row-price">{won(p.price)}원</td>
          <td role="cell" data-label="초기재고" className="mono">{won(p.initialStockQty ?? 0)}개</td><td role="cell" data-label="판매수량" className="mono">{won(quantities.products.get(p.id) || 0)}개</td><td role="cell" data-label="남은 재고" className="mono">{won(p.stockQty ?? p.stock ?? 0)}개</td>
          <td role="cell" data-label="등록일">{p.createdAt && !Number.isNaN(new Date(p.createdAt).getTime()) ? <time dateTime={p.createdAt}>{new Date(p.createdAt).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' }).replace(/\s/g, '')}</time> : '—'}</td>
        </tr>)}</tbody>
      </table>{!products.length && <div className="management-empty"><h3>등록된 상품이 없습니다</h3><p>상품 추가 버튼으로 첫 상품을 등록하세요.</p></div>}</div>
      <nav className="management-pagination" aria-label="상품 목록 페이지"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>이전</button><span aria-live="polite">{currentPage} / {pageCount} 페이지</span><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>다음</button></nav>
    </>}
    {selectedProduct && <fieldset disabled={readOnly} className="min-w-0"><div className="management-products">
      {[selectedProduct].map((p) => <article className="management-product" key={p.id}>
        <div className="management-product-header"><h3>{productNameWithoutCreator(p)}</h3><button type="button" className="management-delete" aria-label={`${p.name} 상품 삭제`} onClick={() => deleteProduct(p.id)}>삭제</button></div>
        <div className="management-product-body">
          <div className="management-image">
            <ProductImage imageUrl={p.imageUrl} name={p.name} />
            <label className="management-upload"><span>{uploadingId === p.id ? '업로드 중…' : p.imageUrl ? '이미지 수정' : '이미지 등록'}</span><input aria-label={`${p.name} 이미지 등록 또는 수정`} type="file" accept="image/jpeg,image/png,image/webp" disabled={saving || uploadingId !== null} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; uploadImage(p, file); }} /></label>
            {p.imageUrl && <button type="button" disabled={saving || uploadingId !== null} className="management-delete" onClick={() => onImageChange(p.id, null)}>이미지 제거</button>}
          </div>
          <div className="management-details">
            <ProductEditForm key={p.id} product={p} products={products} persistProducts={persistProducts} disabled={readOnly || saving || uploadingId !== null} />
            <ProductStockForm key={p.id} product={p} soldQty={quantities.products.get(p.id) || 0} onSave={patch => updateProduct(p.id, patch)} disabled={true} />
            <p className="management-note">수량은 공통 재고에서 이 행사로 배정하거나 회수해 변경하세요.</p>

          </div>
        </div>
      </article>)}
    </div></fieldset>}

  </fieldset></section>;
}
