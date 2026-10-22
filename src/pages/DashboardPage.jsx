import LoadingState from '../components/LoadingState';
import { revenueSummary } from '../utils/revenueSummary';
import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import { orderRepository } from '../database/orderRepository';
import { PageIntro } from '../components/PageLayout';
import { won } from '../utils/productDisplay';
import { dashboardSummary, loadDashboard } from '../utils/dashboardSummary';

const settlementLink = id => `#/settlement?projectId=${encodeURIComponent(id)}`;
function Metric({ label, value }) {
  return <div className="dashboard-metric"><dt>{label}</dt><dd>{value}</dd></div>;
}
function Bar({ value, max, label }) {
  const percent = max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0;
  return <div className="account-dashboard-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}><span style={{ width: `${percent}%` }} /></div>;
}
function Ratio({ segments, label }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  return <><div className="account-dashboard-ratio" role="img" aria-label={`${label}: ${segments.map(segment => `${segment.label} ${won(segment.value)}`).join(', ')}`}>
    {segments.map(segment => <span key={segment.label} style={{ width: `${total ? segment.value / total * 100 : 0}%`, background: segment.color }} />)}
  </div><ul className="account-dashboard-legend">{segments.map(segment => <li key={segment.label}><i style={{ background: segment.color }} /><span>{segment.label}</span><strong>{won(segment.value)}</strong></li>)}</ul></>;
}

export default function DashboardPage({ request }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [waiting, setWaiting] = useState([]);
  const [queueError, setQueueError] = useState('');
  useEffect(() => {
    let active = true;
    setData(null); setError('');
    loadDashboard(request).then(async next => { const financial = await request('/api/settlements'); if (active) setData({ ...next, settlements: financial.settlements }); }).catch(err => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [request, refresh]);
  useEffect(() => {
    setWaiting([]); setQueueError('');
    if (!data) return;
    const subscription = liveQuery(() => Promise.all(data.projects.map(async project => ({ ...project, count: await orderRepository.countWaiting(project.id) })))).subscribe({
      next: rows => { setWaiting(rows.filter(row => row.count > 0)); setQueueError(''); },
      error: () => setQueueError('이 기기의 미동기화 거래를 확인하지 못했습니다.'),
    });
    return () => subscription.unsubscribe();
  }, [data]);
  const summary = data ? dashboardSummary(data) : null;
  const financial = data ? revenueSummary(data, data.settlements || [], { start: '', end: '' }) : null;
  const settlementAlerts = financial ? [...(financial.pending > 0 ? [{ key: 'settlements', text: `정산 대기 ${won(financial.pending)}원`, href: '#/revenue' }] : []), ...financial.creators.filter(creator => creator.overpaid > 0 || creator.adjustmentNeeded > 0).map(creator => ({ key: `settlement-check:${creator.name}`, text: `${creator.name} · 초과 지급 또는 차감 내역 확인`, href: '#/revenue', urgent: true }))] : [];
  const alerts = summary ? [...waiting.map(project => ({ key: `queue:${project.id}`, text: `${project.name} · 이 기기 미동기화 요청 ${won(project.count)}건`, href: settlementLink(project.id), urgent: true })), ...settlementAlerts, ...summary.alerts] : [];
  return <main className="page-content"><div className="page-body dashboard-page account-dashboard">
    <PageIntro title="대시보드" actions={<button type="button" className="management-back" onClick={() => setRefresh(value => value + 1)}>새로고침</button>} />
    <p className="account-dashboard-basis">전체 기간 · 서버 동기화 완료 기준</p>
    {error && <p role="alert" className="dashboard-error">{error}</p>}
    {queueError && <p role="alert" className="dashboard-error">{queueError}</p>}
    {!data && !error && <LoadingState />}
    {summary && <>
      <dl className="account-dashboard-kpis">
        <Metric label="전체 판매액" value={`${won(summary.total)}원`} />
        <Metric label="거래 건수" value={`${won(summary.transactions)}건`} />
        <Metric label="미분배 재고" value={`${won(summary.stock.unallocated)}개`} />
        <Metric label="진행 중 행사" value={`${won(summary.activeEvents)}개`} />
      </dl>
      <div className="account-dashboard-layout">
        <div className="account-dashboard-main"><section className="dashboard-card account-dashboard-events"><div className="dashboard-card-heading"><h2>행사별 판매 비교</h2></div><div className="account-dashboard-event-list">
          {summary.events.map(event => <a key={event.id} className="account-dashboard-event" href={settlementLink(event.id)} aria-label={`${event.name} 정산 내역`}>
            <div className="account-dashboard-event-title"><h3>{event.name}</h3><span className="event-status" data-archived={Boolean(event.archivedAt)}>{event.archivedAt ? '보관' : '진행 중'}</span></div>
            <strong className="account-dashboard-event-amount">{won(event.amount)}원</strong>
            <Bar value={event.amount} max={summary.events[0]?.amount || 0} label={`${event.name} 판매액 비교`} />
            <div className="account-dashboard-event-meta"><span>거래 {won(event.transactions)}건</span><span>남은 재고 {won(event.remaining)}개</span><span>소진율 {event.sellThrough.toFixed(1)}%</span></div>
            <Bar value={event.sellThrough} max={100} label={`${event.name} 소진율`} />
          </a>)}
        </div></section>
        <section className="dashboard-card account-dashboard-creators"><div className="dashboard-card-heading"><h2>작가별 누적 판매 Top 10</h2><span className="dashboard-caption">작가명 기준 합산</span></div>
          {summary.creators.length ? summary.creators.slice(0, 10).map(creator => <details className="account-dashboard-creator" key={creator.name}><summary><div className="account-dashboard-rank-heading"><strong>{creator.name}</strong><span>{won(Math.round(creator.amount))}원 · {won(creator.qty)}개</span></div><Bar value={creator.amount} max={summary.creators[0].amount} label={`${creator.name} 누적 판매액`} /></summary><ul>{creator.events.map(event => <li key={event.id}><a href={settlementLink(event.id)}><span>{event.name}</span><strong>{won(Math.round(event.amount))}원</strong></a></li>)}</ul></details>) : <p className="account-dashboard-empty">아직 판매가 없어요</p>}
        </section>
        </div><div className="account-dashboard-side">
        {alerts.length > 0 && <section className="dashboard-card account-dashboard-alerts" aria-label="확인 필요"><h2>확인 필요 <span>{alerts.length}</span></h2><ul>{alerts.map(alert => <li key={alert.key}><a className={alert.urgent ? 'is-urgent' : ''} href={alert.href}>{alert.text}<span aria-hidden="true"> →</span></a></li>)}</ul></section>}
        <section className="dashboard-card account-dashboard-stock"><div className="dashboard-card-heading"><h2>통합재고 현황</h2><a href="#/inventory">재고관리 →</a></div><Ratio label="통합재고 수량" segments={[
          { label: '판매됨', value: summary.stock.sold, color: '#2563eb' },
          { label: '행사 잔여', value: summary.stock.allocated, color: '#93c5fd' },
          { label: '미분배', value: summary.stock.unallocated, color: '#cbd5e1' },
        ]} /></section>
        <section className="dashboard-card account-dashboard-payments"><div className="dashboard-card-heading"><h2>결제수단별 판매액</h2></div><Ratio label="결제수단별 판매액" segments={[
          { label: '현금', value: summary.cash, color: '#2563eb' },
          { label: '계좌이체', value: summary.transfer, color: '#94a3b8' },
        ]} /><dl className="account-dashboard-average"><Metric label="평균 거래 금액" value={`${won(Math.round(summary.average))}원`} /></dl></section>
        {summary.goods.length > 0 && <section className="dashboard-card account-dashboard-goods"><div className="dashboard-card-heading"><h2>상품별 판매액 Top 5</h2></div>{summary.goods.map(good => <div className="account-dashboard-good" key={good.name}><div className="account-dashboard-rank-heading"><strong>{good.name}</strong><span>{won(Math.round(good.amount))}원 · {won(good.qty)}개</span></div><Bar value={good.amount} max={summary.goods[0].amount} label={`${good.name} 판매액`} /></div>)}</section>}
        </div>
      </div>
    </>}
  </div></main>;
}
