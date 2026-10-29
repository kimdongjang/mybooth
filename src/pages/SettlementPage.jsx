import SearchFilters from '../components/SearchFilters';
import { useState } from 'react';
import { PageIntro, PageTabs } from '../components/PageLayout';
import { Stat } from '../components/PosUI';
import { won } from '../utils/productDisplay';
import { filterSales } from '../utils/saleSearch';

export default function SettlementPage({ request, projectId, onSettlementChange, reportOnly = false, initialTab = 'summary', initialProductId = '', initialProductSearch = '', readOnly, stats, sales, visibleSales, logCreatorFilter, setLogCreatorFilter, creatorSalesSummary, selectedCreatorSummary, exportCsv, clearSalesWithPassword, saleLineCreators, saleLineProductEntries, voidSale }) {
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState({ method: 'all', product: initialProductSearch, creator: '' });
  const [historyProductId, setHistoryProductId] = useState(initialProductId);
  const changeSearch = next => { if (next.product !== search.product) setHistoryProductId(''); setSearch(next); };
  const filteredSales = filterSales(visibleSales, { ...search, product: historyProductId ? '' : search.product, productId: historyProductId }, saleLineProductEntries, saleLineCreators);
  return <main className="page-content settlement-page">
      <div className="settlement-layout"><section className="catalog min-w-0">
      <PageIntro hideTitle title={reportOnly ? '수익현황' : '판매 현황'} />
      <aside className="settlement-overview" aria-label="전체 매출 요약"><details open><summary className="settlement-overview-toggle">전체 매출 요약</summary><p>현재 행사 전체 판매 기준</p><div className="settlement-overview-stats"><Stat label="총 판매액" value={`${won(stats.total)}원`} /><Stat label="현금" value={`${won(stats.cash)}원`} /><Stat label="계좌이체" value={`${won(stats.transfer)}원`} /><Stat label="거래 건수" value={sales.length} /></div></details></aside>
      <PageTabs id="settlement" label="판매 현황 보기" tabs={[["summary", "매출 요약"], ["history", "판매 내역"]]} selected={tab} onSelect={setTab} />
      <div id={`settlement-panel-${tab}`} role="tabpanel" aria-labelledby={`settlement-tab-${tab}`} tabIndex={0}>
          {tab === 'summary' && <div className="catalog-filters" role="group" aria-label="정산 제작자 필터"><span className="filter-label">제작자</span><div className="filter-options"><button type="button" aria-pressed={logCreatorFilter === 'all'} onClick={() => setLogCreatorFilter('all')}>전체</button>{creatorSalesSummary.map(({ creator }) => <button key={creator} type="button" aria-pressed={logCreatorFilter === creator} onClick={() => setLogCreatorFilter(creator)}>{creator}</button>)}</div></div>}
      <div className="grid min-w-0 gap-4">
        {tab === 'summary' && <section className="settlement-card">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-[#526078]">제작자별 판매 집계</span></div>
          <div className="mt-3 overflow-x-auto"><table className="min-w-[520px] w-full border-collapse text-[12px]"><thead><tr className="bg-[#f8fafc] text-left text-[#526078]"><th className="border-b border-line p-2">제작자</th><th className="border-b border-line p-2 text-right">판매 수량</th><th className="border-b border-line p-2 text-right">판매 금액</th><th className="border-b border-line p-2">판매 굿즈</th></tr></thead><tbody>{(logCreatorFilter === 'all' ? creatorSalesSummary : selectedCreatorSummary ? [selectedCreatorSummary] : []).map((summary) => <tr key={summary.creator}><td className="border-b border-line p-2"><span className="settlement-creator">{summary.creator}</span></td><td className="mono border-b border-line p-2 text-right font-bold">{won(summary.qty)}개</td><td className="mono border-b border-line p-2 text-right font-bold">{won(Math.round(summary.amount))}원</td><td className="border-b border-line p-2"><div className="flex flex-col gap-1">{summary.goods.map((goods) => <div key={goods.productId} className="flex flex-wrap justify-between gap-2 rounded bg-[#f8fafc] px-2 py-1"><span>{goods.name}</span><span className="mono text-[#526078]">{won(goods.qty)}개 · {won(Math.round(goods.amount))}원</span></div>)}</div></td></tr>)}</tbody></table>{!creatorSalesSummary.length && <p className="py-4 text-center text-xs text-[#64748b]">아직 판매된 굿즈가 없습니다.</p>}</div>
        </section>}
        {tab === 'history' && <section className="settlement-card">
          <h2 className="text-sm font-bold">실제 판매 내역</h2>
          <SearchFilters label="판매 내역 검색" value={search} onChange={changeSearch} onReset={() => { setHistoryProductId(''); setSearch({ method: 'all', product: '', creator: '' }); }} fields={[
            { key: 'method', label: '결제수단', options: [['all','전체'],['cash','현금'],['transfer','계좌이체']] },
            { key: 'product', label: '상품', placeholder: '상품·세트명 또는 코드' },
            { key: 'creator', label: '제작자', placeholder: '제작자명' },
          ]} />
          <p className="settlement-result" role="status">검색 결과 {filteredSales.length}건 / 전체 {visibleSales.length}건</p>
          <div className="overflow-x-auto"><table className="min-w-[560px] w-full border-collapse bg-white text-[12.5px]"><thead><tr className="bg-[#f8fafc] text-left text-[#526078]"><th className="p-2">시간</th><th className="p-2">결제수단</th><th className="p-2">구성</th><th className="p-2">금액</th>{!reportOnly && <th />}</tr></thead><tbody>{filteredSales.map((s) => <tr key={s.id}><td className="mono border-b border-line p-2">{new Date(s.time).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</td><td className="border-b border-line p-2"><span className={`rounded px-2 py-0.5 text-[11px] text-white ${s.method === 'cash' ? 'bg-cash' : 'bg-transfer'}`}>{s.method === 'cash' ? '현금' : '계좌이체'}</span></td><td className="border-b border-line p-2"><div className="flex flex-col gap-1">{s.lines.map((l, index) => <div key={`${l.type}-${l.id}-${index}`} className="flex flex-wrap items-center gap-1.5"><span>{l.name} x{l.qty}</span>{saleLineCreators(l).map((creator) => <span key={creator} className="settlement-creator">{creator}</span>)}</div>)}</div></td><td className="mono border-b border-line p-2">{won(s.total)}원</td>{!reportOnly && <td className="border-b border-line p-2"><button className="rounded border border-danger px-2 py-1 text-[10px] text-danger" disabled={readOnly} onClick={() => voidSale(s)}>취소</button></td>}</tr>)}</tbody></table></div><p className="catalog-empty" hidden={filteredSales.length > 0}>{visibleSales.length ? '검색 조건에 맞는 판매 내역이 없습니다.' : '아직 판매 내역이 없습니다.'}</p><div className="settlement-tools"><button type="button" className="settlement-tool" onClick={exportCsv}>판매 내역 내보내기</button>{!reportOnly && <button type="button" className="settlement-tool settlement-tool-danger" disabled={readOnly} onClick={clearSalesWithPassword}>전체 판매 내역 초기화</button>}</div>
        </section>}
      </div>
      </div>
      </section></div>
    </main>;
}
