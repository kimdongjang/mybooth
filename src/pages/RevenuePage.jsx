import LoadingState from '../components/LoadingState';
import { useEffect, useRef, useState } from 'react';
import { PageIntro } from '../components/PageLayout';
import SettlementEditor from '../components/SettlementEditor';
import { orderRepository } from '../database/orderRepository';
import { loadDashboard } from '../utils/dashboardSummary';
import { periodRange, revenueSummary, settlementStatus, settlementCsv } from '../utils/revenueSummary';
import { won } from '../utils/productDisplay';

const link = id => `#/settlement?projectId=${encodeURIComponent(id)}`;
const cash = amount => `${won(Math.round(amount))}원`;
function Status({ row }) {
  const status=settlementStatus(row);
  return <span className="revenue-status" data-status={status==='지급 완료'?'complete':status==='정산 중'?'waiting':status==='초과 지급 확인'?'overpaid':'closed'}>{status}</span>;
}
function download(creators) {
  const url=URL.createObjectURL(new Blob([settlementCsv(creators)],{type:'text/csv;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='작가별-정산내역.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function RevenuePage({ request }) {
  const [data,setData]=useState(null), [records,setRecords]=useState([]), [closures,setClosures]=useState([]), [error,setError]=useState('');
  const [refresh,setRefresh]=useState(0), [period,setPeriod]=useState('all'), [start,setStart]=useState(''), [end,setEnd]=useState('');
  const [editing,setEditing]=useState(null);
  const active=useRef(true);
  useEffect(()=>{
    let current=true;active.current=true;setError('');setData(null);setEditing(null);
    loadDashboard(request,false).then(async next=>{
      const financial=await request('/api/settlements');
      if(current){setData(next);setRecords(financial.settlements);setClosures(financial.eventSettlements || []);}
    }).catch(err=>{if(current)setError(err.message);});
    return()=>{current=false;active.current=false;};
  },[request,refresh]);
  const range=periodRange(period,start,end);
  const invalid=period==='custom'&&(!start||!end||start>end);
  const summary=data&&!invalid?revenueSummary(data,records,range,closures):null;
  const save=async command=>{
    if(await orderRepository.countWaiting(command.projectId))throw new Error('이 행사의 미동기화 요청을 먼저 동기화해주세요.');
    const result=await request('/api/settlements',{method:'POST',body:JSON.stringify(command)});
    if(!active.current)return;
    setRecords(current=>[...current.filter(row=>row.projectId!==result.settlement.projectId||row.creator!==result.settlement.creator),result.settlement]);
  };
  return <main className="page-content"><div className="page-body revenue-page">
    <PageIntro title="수익현황" actions={<button type="button" className="management-back" disabled={Boolean(editing)} onClick={()=>setRefresh(value=>value+1)}>새로고침</button>} />
    <div className="revenue-period" role="group" aria-label="판매 집계 기간">{[['all','전체'],['year','올해'],['month','이번 달'],['custom','기간 선택']].map(([value,label])=><button key={value} type="button" aria-pressed={period===value} disabled={Boolean(editing)} onClick={()=>setPeriod(value)}>{label}</button>)}{period==='custom'&&<><label>시작일<input aria-label="판매 시작일" type="date" value={start} disabled={Boolean(editing)} onChange={event=>setStart(event.target.value)} /></label><label>종료일<input aria-label="판매 종료일" type="date" value={end} disabled={Boolean(editing)} onChange={event=>setEnd(event.target.value)} /></label></>}</div>
    <p className="account-dashboard-basis">서버 동기화 완료 기준</p>
    {error&&<p role="alert" className="inventory-error">{error}</p>}
    {invalid&&<p role="alert" className="inventory-error">시작일과 종료일을 올바르게 선택해주세요.</p>}
    {!data&&!error&&<LoadingState />}
    {summary&&<>
      <dl className="account-dashboard-kpis">{[['총 판매액',cash(summary.total)],['거래 건수',`${won(summary.count)}건`],['객단가',cash(summary.average)],['정산 예정 · 확정',cash(summary.net)],['지급 완료',cash(summary.paid)],['남은 정산 · 확정',cash(summary.pending)],['예상 판매액 · 미마감',cash(summary.expectedGross)]].map(([label,value])=><div key={label} className="dashboard-metric"><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <div className="revenue-layout">
        <section className="dashboard-card revenue-creators" id="creator-settlements"><div className="dashboard-card-heading"><h2>작가별 정산 · 전체 기간</h2><button type="button" className="event-text-link" onClick={()=>download(summary.creators)}>정산표 CSV</button></div>
          <div className="revenue-table-heading" aria-hidden="true"><span>작가</span><span>총 판매액</span><span>정산 예정</span><span>지급 완료</span><span>남은 정산</span></div>
          {summary.creators.map(creator=><details key={creator.name} className="revenue-creator"><summary><div className="revenue-creator-values"><strong>{creator.name}</strong><span data-label="총 판매액">{cash(creator.gross)}</span><span data-label="정산 예정">{cash(creator.net)}</span><span data-label="지급 완료">{cash(creator.paid)}</span><strong data-label="남은 정산">{cash(creator.pending)}</strong></div><Status row={creator} /></summary>
            <div className="revenue-creator-details"><div className="revenue-creator-tools"><span>차감 합계 {cash(creator.fees)}</span><button type="button" className="event-text-link" onClick={()=>download([creator])}>작가 정산서 CSV</button></div>
              {creator.rows.map(row=><div className="revenue-event-settlement" key={row.projectId}><div className="account-dashboard-event-title"><a href={link(row.projectId)}>{row.projectName}</a><Status row={row} /></div><dl className="revenue-mini-metrics">{[[row.confirmed?'확정 판매액':'예상 판매액',row.gross],['차감',row.fees],['정산 예정',row.net],['지급 완료',row.paid],['남은 정산',row.pending]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{cash(value)}</dd></div>)}</dl>{row.adjustmentNeeded>0&&<p role="alert" className="inventory-error">차감액이 판매액을 {cash(row.adjustmentNeeded)} 초과합니다.</p>}{row.overpaid>0&&<p role="alert" className="inventory-error">초과 지급 {cash(row.overpaid)}</p>}
                <button type="button" className="management-back" disabled={Boolean(editing)} onClick={()=>setEditing(JSON.stringify([row.projectId,row.creator]))}>{row.confirmed?'지급 관리':'개별 차감 관리'}</button>
                {editing===JSON.stringify([row.projectId,row.creator])&&<SettlementEditor key={editing} row={row} save={save} close={()=>setEditing(null)} />}
              </div>)}
            </div></details>)}
        </section>
        <aside className="revenue-side">
          <section className="dashboard-card"><div className="dashboard-card-heading"><h2>행사별 판매액</h2></div>{summary.events.map(event=><a key={event.id} className="revenue-event-bar" href={link(event.id)}><div className="account-dashboard-rank-heading"><strong>{event.name}</strong><span>{cash(event.amount)}</span></div><div className="account-dashboard-bar"><span style={{width:`${summary.events[0]?.amount?event.amount/summary.events[0].amount*100:0}%`}} /></div></a>)}</section>
          <section className="dashboard-card"><div className="dashboard-card-heading"><h2>결제수단별 판매액</h2></div><div className="account-dashboard-ratio" role="img" aria-label={`현금 ${cash(summary.cash)}, 계좌이체 ${cash(summary.transfer)}`}><span style={{background:'#2563eb',width:`${summary.total?summary.cash/summary.total*100:0}%`}}/><span style={{background:'#94a3b8',width:`${summary.total?summary.transfer/summary.total*100:0}%`}}/></div><dl className="revenue-payment-totals"><div><dt>현금</dt><dd>{cash(summary.cash)}</dd></div><div><dt>계좌이체</dt><dd>{cash(summary.transfer)}</dd></div></dl><p className="dashboard-caption">운영비·수수료 차감 합계 · 전체 기간 {cash(summary.fees)}</p></section>
        </aside>
      </div>
      <section className="dashboard-card revenue-event-list"><div className="dashboard-card-heading"><h2>행사별 수익 목록</h2></div>{summary.events.map(event=><a key={event.id} href={link(event.id)} className="revenue-event-list-row"><strong>{event.name}</strong><span>{event.start?`${event.start} ~ ${event.end}`:'—'}</span><span>{cash(event.amount)} · {won(event.count)}건</span><Status row={event}/></a>)}</section>
    </>}
  </div></main>;
}
