import {useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import {dashboardEvents,dashboardAlerts} from '../utils/personalDashboard';
import LoadingState from './LoadingState';

const settlementLink=id=>`#/settlement?projectId=${encodeURIComponent(id)}`;
const eventLink=(event,page)=>`#/${page}?projectId=${encodeURIComponent(event.id)}`;
const amount=value=>`${won(value)}원`;
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);

export default function PersonalDashboard({data,error,events=[]}) {
 const [period,setPeriod]=useState('all'),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const today=koreanDay(new Date()),inventory=data?.inventory||[],history=data?.events||[];
 const settlements=history.flatMap(event=>(event.rows||[]).map(row=>({...row,event}))),confirmed=settlements.filter(row=>row.event.closedAt);
 const pending=sum(confirmed,'pending'),paid=sum(settlements,'paid'),warehouse=sum(inventory,'warehouse'),remaining=sum(inventory,'remaining');
 const sold=inventory.reduce((total,item)=>total+Number(item.stockSummary?.sold||0),0),eventRemaining=inventory.reduce((total,item)=>total+Number(item.stockSummary?.eventRemaining||0),0),other=inventory.reduce((total,item)=>total+Number(item.stockSummary?.other||0),0);
 const portions=[['sold','행사 판매',sold],['remaining','행사 잔여',eventRemaining],['warehouse','미배정',warehouse],...(other>0?[['other','기타 차감',other]]:[])],stockTotal=portions.reduce((total,[,,value])=>total+value,0);
 const cards=dashboardEvents(data,events,today);
 const alerts=[...dashboardAlerts(cards,warehouse),...cards.filter(event=>event.waiting>0).map(event=>({key:`waiting:${event.id}`,type:'waiting',event})),...cards.filter(event=>event.status==='active'&&event.lowStock>0).map(event=>({key:`stock:${event.id}`,type:'stock',event}))].map(alert=>({
  ...alert,href:alert.type==='waiting'?eventLink(alert.event,'sales'):alert.type==='stock'?(alert.event.p.canConfigure||alert.event.p.ownerIds?.length?eventLink(alert.event,'products'):'#/inventory'):alert.type==='allocation'||alert.type==='recovery'?'#/inventory':settlementLink(alert.event.id),
  text:alert.type==='waiting'?`${alert.event.name} · 이 기기 미동기화 거래 ${won(alert.event.waiting)}건`:
   alert.type==='stock'?`${alert.event.name} · 품절 임박 상품 ${won(alert.event.lowStock)}종`:
   alert.type==='negative'?`ⓘ ${alert.event.name} · 분담 비용 반영 후 ${alert.event.netScope==='own'?'내 ':''}확정 정산금 ${amount(alert.event.net)}`:
   alert.type==='allocation'?`📦 미배정 재고 ${won(warehouse)}개 · ${alert.event.name}에 배정 가능`:
   alert.type==='recovery'?`${alert.event.name} · 잔여 재고 ${won(alert.event.stock.remaining)}개 회수 필요`:
   `${alert.event.name} · ${alert.event.netScope==='own'?'내 ':''}정산 대기 ${amount(alert.event.pending)}`
 }));
 const rangeStart=period==='year'?`${today.slice(0,4)}-01-01`:period==='custom'?start:'',rangeEnd=period==='year'?today:period==='custom'?end:'';
 const gross=history.flatMap(event=>event.sales||[]).filter(sale=>{const day=koreanDay(sale.time);return !sale.voided&&(!rangeStart||day>=rangeStart)&&(!rangeEnd||day<=rangeEnd);}).flatMap(sale=>sale.items).reduce((total,item)=>total+Number(item.amount||0),0);
 return <main className="page-content"><div className="page-body home-dashboard"><div className="page-intro"><div className="page-heading"><h1 tabIndex={-1}>대시보드</h1></div><a className="management-back" href="#/projects">행사 목록 →</a></div>
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  {data&&<>
   {alerts.length>0&&<section className="home-alert-strip" aria-labelledby="home-alert-title"><h2 id="home-alert-title">지금 확인할 것</h2>{alerts.map(alert=><a key={alert.key} href={alert.href} className={alert.type==='negative'?'home-settlement-info':undefined}>{alert.text} →</a>)}</section>}
   <div className="home-summary-grid">
    <section className="dashboard-card home-stock" aria-labelledby="home-stock-title"><div className="home-section-heading"><h2 id="home-stock-title">내 재고</h2><a href="#/inventory">재고관리 →</a></div><div className="home-stock-total"><span>현재 잔량 <strong>{won(remaining)}개</strong></span><span>미배정 <strong>{won(warehouse)}개</strong></span></div>{stockTotal>0&&<div className="inventory-stock-bar" role="img" aria-label={portions.map(([,label,value])=>`${label} ${won(value)}개`).join(', ')}>{portions.filter(([, ,value])=>value>0).map(([key,label,value])=><span key={key} className={`is-${key}`} style={{flexGrow:value}} title={`${label} ${won(value)}개`}/>)}</div>}<div className="inventory-stock-legend">{portions.map(([key,label,value])=><span key={key}><i className={`is-${key}`}/>{label} <strong>{won(value)}개</strong></span>)}</div></section>
    <section className="dashboard-card home-finance" aria-labelledby="home-finance-title"><div className="home-section-heading"><h2 id="home-finance-title">내 정산</h2><a href="#/account/revenue">정산 내역 →</a></div><dl className="home-primary-metric"><dt>확정 정산 대기 · 전체 기간</dt><dd>{amount(pending)}</dd></dl><dl className="home-finance-details"><div><dt>확정 정산금 · 전체 기간</dt><dd>{amount(sum(confirmed,'net'))}</dd></div><div><dt>지급 완료 · 전체 기간</dt><dd>{amount(paid)}</dd></div></dl><div className="home-sales-period"><div className="home-section-heading"><span>내 판매액 · {period==='all'?'전체 기간':period==='year'?'올해':'선택 기간'}</span><strong>{amount(gross)}</strong></div><div className="revenue-period" role="group" aria-label="내 판매액 집계 기간">{[['all','전체'],['year','올해'],['custom','직접 선택']].map(([key,label])=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}{period==='custom'&&<div className="home-period-dates"><label>시작일<input type="date" value={start} max={end||undefined} onChange={event=>setStart(event.target.value)}/></label><label>종료일<input type="date" min={start} value={end} onChange={event=>setEnd(event.target.value)}/></label></div>}</div></div></section>
   </div>

  </>}
 </div></main>;
}
