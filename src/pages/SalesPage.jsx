import { PageIntro, PageTabs } from '../components/PageLayout';
import { ItemButton } from '../components/PosUI';
import { won, productNameWithoutCreator, creatorNameOf } from '../utils/productDisplay';

export default function SalesPage({ purchaseTab, setPurchaseTab, visibleProducts, visibleBundles, creators, creatorFilter, setCreatorFilter, availableStock, bundleAvailable, addProduct, addBundle, cart, setCart, orderExpanded, setOrderExpanded, total, updateCartQty, saving, finalizeSale }) {
  return <main className="pos-layout flex min-h-0 flex-1 gap-5 p-5">
      <section className="catalog min-w-0 flex-1 overflow-y-auto">
        <PageIntro title="상품 판매" description="상품을 눌러 주문에 추가하고 수령 확인 후 결제를 기록하세요." actions={<span>{purchaseTab === 'products' ? `${visibleProducts.length}개 상품` : `${visibleBundles.length}개 세트`}</span>}>
          <PageTabs id="purchase" label="구매 방식" tabs={[["products", "단품 구매"], ["bundles", "세트 구매"]]} selected={purchaseTab} onSelect={setPurchaseTab} />
        </PageIntro>
        <div className="catalog-filters" role="group" aria-label="제작자 필터">
          <span className="filter-label">제작자</span>
          <div className="filter-options">
            <button type="button" aria-pressed={creatorFilter === 'all'} onClick={() => setCreatorFilter('all')}>전체</button>
            {creators.map((creator) => <button key={creator} type="button" aria-pressed={creatorFilter === creator} onClick={() => setCreatorFilter(creator)}>{creator}</button>)}
          </div>
        </div>
        <div id={`purchase-panel-${purchaseTab}`} role="tabpanel" aria-labelledby={`purchase-tab-${purchaseTab}`} tabIndex={0}>
          {purchaseTab === 'products' ? <div className="product-grid grid gap-3">{visibleProducts.map((p) => <ItemButton key={p.id} imageUrl={p.imageUrl} soldout={availableStock(p) <= 0} stock={`남음 ${availableStock(p)}`} name={productNameWithoutCreator(p)} price={p.price} creatorName={creatorNameOf(p)} onClick={() => addProduct(p)} />)}</div> : <div className="product-grid grid gap-3">{visibleBundles.map((b) => <ItemButton key={b.id} bundle soldout={bundleAvailable(b) <= 0} stock={bundleAvailable(b) <= 0 ? '품절' : `가능 ${bundleAvailable(b)}`} name={b.name} price={b.price} onClick={() => addBundle(b)} />)}</div>}
          {!(purchaseTab === 'products' ? visibleProducts.length : visibleBundles.length) && <p className="catalog-empty">{creatorFilter !== 'all' ? `선택한 제작자의 ${purchaseTab === 'products' ? '상품' : '세트'}가 없습니다.` : purchaseTab === 'products' ? '등록된 상품이 없습니다.' : '등록된 세트가 없습니다.'}</p>}
        </div>
      </section>
      <aside className="order-panel flex shrink-0 flex-col rounded-2xl border border-line bg-white text-ink">
        <div className="order-summary"><div><div className="flex items-center gap-2"><h2 className="text-sm font-bold">현재 주문</h2><span className="text-xs text-slate-500">{cart.reduce((count, line) => count + line.qty, 0)}개</span></div><button type="button" className="order-detail-toggle" aria-expanded={orderExpanded} aria-controls="order-lines" onClick={() => setOrderExpanded(!orderExpanded)}>{orderExpanded ? '주문 접기 ∨' : '주문 상세 ∧'}</button></div><div className="text-right"><div className="text-xs text-slate-500">결제할 금액</div><div className="order-total mono font-bold text-register" aria-live="polite">{won(total)}<span className="ml-1 text-sm text-slate-500">원</span></div></div></div>
        <div id="order-lines" className={`order-lines flex-1 overflow-y-auto px-3 py-1.5 ${orderExpanded ? 'is-expanded' : ''}`}>{cart.length ? cart.map((line, i) => <div key={`${line.type}-${line.id}`} className="flex items-center gap-2 border-b border-line px-1.5 py-2.5"><div className="flex-1 text-xs">{line.type === 'bundle' && <span className="mr-1 rounded bg-amber-pos px-1.5 py-0.5 text-xs text-white">SET</span>}{line.name}<div className="text-xs text-[#64748b]">{won(line.unitPrice)}원</div></div><button className="h-9 w-9 shrink-0 rounded-lg border border-line bg-paper" aria-label={`${line.name} 수량 줄이기`} onClick={() => updateCartQty(i, -1)}>−</button><span className="w-5 text-center text-sm">{line.qty}</span><button className="h-9 w-9 shrink-0 rounded-lg border border-line bg-paper" aria-label={`${line.name} 수량 늘리기`} onClick={() => updateCartQty(i, 1)}>+</button><div className="mono w-[70px] text-right text-xs font-bold">{won(line.unitPrice * line.qty)}</div><button aria-label={`${line.name} 주문에서 제거`} className="h-9 w-9 shrink-0 text-[#dc2626]" onClick={() => setCart(cart.filter((_, idx) => idx !== i))}>✕</button></div>) : <div className="px-5 py-10 text-center text-sm text-[#64748b]">굿즈를 선택해주세요</div>}</div>
        <div className="order-actions border-t border-line p-3.5"><p className="mb-3 text-xs leading-relaxed text-slate-500">수령 확인 후 결제를 기록하세요.</p><div className="flex gap-2.5"><button disabled={!cart.length || saving} onClick={() => finalizeSale('cash')} className="flex-1 rounded-2xl bg-cash px-2 py-4 font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">현금 결제</button><button disabled={!cart.length || saving} onClick={() => finalizeSale('transfer')} className="flex-1 rounded-2xl bg-transfer px-2 py-4 font-bold text-white disabled:bg-slate-200 disabled:text-slate-500">계좌이체</button></div><button onClick={() => cart.length && confirm('장바구니를 비울까요?') && setCart([])} className="mt-2 w-full rounded-lg border border-line py-2 text-xs text-[#526078]">비우기</button></div>
      </aside>
    </main>;
}
