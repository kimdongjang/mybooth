import Icon from './Icon';
import {useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import {dashboardEvents,dashboardFocus,dashboardAlerts} from '../utils/personalDashboard';
import LoadingState from './LoadingState';

const settlementLink=id=>`#/settlement?projectId=${encodeURIComponent(id)}`;
const eventLink=(event,page)=>`#/${page}?projectId=${encodeURIComponent(event.id)}`;
const roleOf=p=>p.canManage?'운영자':p.role==='assistant'?'부관리자':p.role==='seller'?'판매 담당':p.role==='viewer'?'조회 담당':'참여 작가';
const amount=value=>`${won(value)}원`;
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const dateLabel=value=>String(value||'').slice(2,10).replaceAll('-','.');
const periodOf=event=>event.schedule.starts_on?`${dateLabel(event.schedule.starts_on)}~${dateLabel(event.schedule.ends_on)}`:'일정 미정';
const statusOf=event=>event.closed?'정산 마감':({active:'진행 중',upcoming:'예정',ended:'종료',unscheduled:'일정 미정'}[event.status]);

function Preparation({event,warehouse,compact=false}) {
 const {metrics}=event,prefix=event.operator?'':'내 ';
 const values=[[`${prefix}상품`,metrics.products,'종'],[`${prefix}배정`,metrics.allocated,'개'],['참여 제작자',metrics.artists,'명']].filter(([,value])=>value!=null);
 if(!values.length)return null;
 return <div className={compact?'home-preparation is-compact':'home-preparation'} aria-label={`${event.name} 준비 상태`}>{values.map(([label,value,unit])=><span key={label} className={Number(value)===0?'needs-attention':''}>{label} <strong>{won(value)}{unit}</strong>{Number(value)===0&&<span aria-label="확인 필요"> ⚠</span>}</span>)}{!compact&&warehouse>0&&metrics.allocated===0&&<p>미배정 재고 {won(warehouse)}개 · 이 행사에 배정된 재고가 없습니다.</p>}</div>;
}

export default function PersonalDashboard({pinnedProjectId='',data,error,events=[]}) {
 const [period,setPeriod]=useState('all'),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [selected,setSelected]=useState(null),[expanded,setExpanded]=useState(false);
 const today=koreanDay(new Date()),inventory=data?.inventory||[],history=data?.events||[];
 const settlements=history.flatMap(event=>(event.rows||[]).map(row=>({...row,event}))),confirmed=settlements.filter(row=>row.event.closedAt);
 const pending=sum(confirmed,'pending'),paid=sum(settlements,'paid'),warehouse=sum(inventory,'warehouse'),remaining=sum(inventory,'remaining');
 const sold=inventory.reduce((total,item)=>total+Number(item.stockSummary?.sold||0),0),eventRemaining=inventory.reduce((total,item)=>total+Number(item.stockSummary?.eventRemaining||0),0),other=inventory.reduce((total,item)=>total+Number(item.stockSummary?.other||0),0);
 const portions=[['sold','행사 판매',sold],['remaining','행사 잔여',eventRemaining],['warehouse','미배정',warehouse],...(other>0?[['other','기타 차감',other]]:[])],stockTotal=portions.reduce((total,[,,value])=>total+value,0);
 const cards=dashboardEvents(data,events,today),groups=dashboardFocus(cards,pinnedProjectId);
 const focus=groups.choices.find(event=>event.id===selected)||groups.choices[0],focusIndex=groups.choices.indexOf(focus);
 const future=[...groups.upcoming,...groups.unknown].filter(event=>event.id!==focus?.id),visibleFuture=expanded?future:future.slice(0,3),past=groups.ended.filter(event=>event.id!==focus?.id);
 const alerts=dashboardAlerts(cards,warehouse).map(alert=>({
  ...alert,href:alert.type==='allocation'||alert.type==='recovery'?'#/inventory':settlementLink(alert.event.id),
  text:alert.type==='negative'?`ⓘ ${alert.event.name} · 분담 비용 반영 후 ${alert.event.netScope==='own'?'내 ':''}확정 정산금 ${amount(alert.event.net)}`:
   alert.type==='allocation'?`📦 미배정 재고 ${won(warehouse)}개 · ${alert.event.name}에 배정 가능`:
   alert.type==='recovery'?`${alert.event.name} · 잔여 재고 ${won(alert.event.stock.remaining)}개 회수 필요`:
   `${alert.event.name} · ${alert.event.netScope==='own'?'내 ':''}정산 대기 ${amount(alert.event.pending)}`
 }));
 const rangeStart=period==='year'?`${today.slice(0,4)}-01-01`:period==='custom'?start:'',rangeEnd=period==='year'?today:period==='custom'?end:'';
 const gross=history.flatMap(event=>event.sales||[]).filter(sale=>{const day=koreanDay(sale.time);return !sale.voided&&(!rangeStart||day>=rangeStart)&&(!rangeEnd||day<=rangeEnd);}).flatMap(sale=>sale.items).reduce((total,item)=>total+Number(item.amount||0),0);
 const canAllocate=focus&&!focus.closed&&(focus.operator||focus.p.canConfigure||focus.p.ownerIds?.length||focus.allocations.length>0);
 const allocationHref=focus?eventLink(focus,'products'):'#/inventory';
 const stock=focus?.stock,depleted=stock?.total>0?Math.min(100,Math.max(0,Math.round((stock.total-stock.remaining)/stock.total*100))):0;
 const primary=focus?.status==='upcoming'?(focus.p.canConfigure?{href:eventLink(focus,'products'),label:'행사 준비'}:focus.p.canSell||focus.p.canViewPos?{href:eventLink(focus,'sales'),label:'행사 열기'}:focus.canReport?{href:settlementLink(focus.id),label:'내 정산'}:null):focus?.status==='ended'||focus?.closed?(focus.canReport?{href:settlementLink(focus.id),label:'정산 확인'}:focus.p.canViewPos?{href:eventLink(focus,'sales'),label:'상품 목록'}:null):focus?.p.canSell?{href:eventLink(focus,'sales'),label:'판매 화면'}:focus?.p.canViewPos?{href:eventLink(focus,'sales'),label:'상품 목록'}:null;
 const futureHref=event=>event.p.canManage?eventLink(event,'project'):event.p.canConfigure||event.p.ownerIds?.length?eventLink(event,'products'):event.p.canViewPos?eventLink(event,'sales'):settlementLink(event.id);
 return <main className="page-content"><div className="page-body home-dashboard"><h1 className="sr-only">대시보드</h1>
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  {data&&<>
   {alerts.length>0&&<section className="home-alert-strip" aria-labelledby="home-alert-title"><h2 id="home-alert-title">지금 확인할 것</h2>{alerts.map(alert=><a key={alert.key} href={alert.href} className={alert.type==='negative'?'home-settlement-info':undefined}>{alert.text} →</a>)}</section>}
   <section className="dashboard-card home-focus" aria-labelledby="home-focus-title">
    <div className="home-section-heading"><h2 id="home-focus-title" className="home-focus-title"><Icon name="pin"/>지금 집중할 행사</h2>{groups.choices.length>1&&<div className="home-focus-switch" role="group" aria-label="진행 중 행사 전환"><button type="button" className="management-back" aria-label="이전 행사" onClick={()=>setSelected(groups.choices[(focusIndex-1+groups.choices.length)%groups.choices.length].id)}>←</button><span aria-live="polite">{focusIndex+1}/{groups.choices.length}</span><button type="button" className="management-back" aria-label="다음 행사" onClick={()=>setSelected(groups.choices[(focusIndex+1)%groups.choices.length].id)}>→</button></div>}</div>
    {focus?<>
     <header className="home-focus-heading"><div><h3>{focus.name}</h3><span className={`inventory-event-status is-${focus.status}`}>{statusOf(focus)}</span></div><span className="home-role">{roleOf(focus.p)}</span></header>
     <p className="home-focus-context">{focus.boothName&&<span>{focus.boothName}</span>}<span>{periodOf(focus)}</span>{focus.dayLabel&&<strong>{focus.dayLabel}</strong>}</p>{focus.venue&&<p className="home-event-venue">{focus.venue}</p>}
     {focus.status==='upcoming'?<Preparation event={focus} warehouse={warehouse}/>:<>
      <dl className="home-focus-metrics">{focus.metrics.gross!=null&&<div><dt>{focus.operator&&focus.summary?'행사 판매액':'내 상품 판매액'}</dt><dd>{amount(focus.metrics.gross)}</dd></div>}{focus.metrics.transactions!=null&&<><div><dt>{focus.operator&&focus.summary?'거래 건수':'내 상품 포함 거래'}</dt><dd>{won(focus.metrics.transactions)}건</dd></div><div><dt>객단가</dt><dd>{focus.metrics.transactions>0?amount(Math.round(focus.metrics.gross/focus.metrics.transactions)):'—'}</dd></div></>}</dl>
      {stock&&<div className="home-focus-stock"><div className="home-section-heading"><span>{focus.operator&&focus.summary?'행사 재고':'내 상품 재고'}</span><strong>소진율 {depleted}%</strong></div>{stock.total>0&&<div className="inventory-stock-bar" role="img" aria-label={`${stock.label} ${stock.sold}개, 남음 ${stock.remaining}개`}><span className="is-sold" style={{flexGrow:stock.sold}}/><span className="is-remaining" style={{flexGrow:stock.remaining}}/>{stock.total-stock.sold-stock.remaining>0&&<span className="is-other" style={{flexGrow:stock.total-stock.sold-stock.remaining}}/>}</div>}<div className="inventory-stock-legend"><span><i className="is-sold"/>{stock.label} <strong>{won(stock.sold)}개</strong></span><span><i className="is-remaining"/>남음 <strong>{won(stock.remaining)}개</strong></span>{stock.total-stock.sold-stock.remaining>0&&<span><i className="is-other"/>기타 차감 <strong>{won(stock.total-stock.sold-stock.remaining)}개</strong></span>}</div></div>}
     </>}
     {focus.net!=null&&<div className="home-event-net"><span>{focus.netScope==='own'?'내 ':''}{focus.closed?'확정 정산금':'정산 예상'}{focus.net<0&&<span className="home-settlement-info" tabIndex={0} role="img" aria-label="판매액에서 분담 비용 등을 반영한 정산 금액입니다." title="판매액에서 분담 비용 등을 반영한 정산 금액입니다."> ⓘ</span>}</span><strong>{amount(focus.net)}</strong></div>}
     {focus.net!=null&&focus.net<0&&<p className="home-settlement-note">분담 비용 등을 반영한 {focus.closed?'확정 정산 금액입니다.':focus.status==='active'||focus.status==='upcoming'?'예상 금액으로, 판매가 반영되면 달라질 수 있어요.':'금액으로, 정산 마감 전까지 달라질 수 있어요.'}</p>}
     {focus.status==='active'&&focus.lowStock>0&&<p className="home-focus-warning">⚠ 품절 임박 상품 {won(focus.lowStock)}종 · 잔여 3개 이하</p>}
     {focus.waiting>0&&<a className="home-focus-warning" href={eventLink(focus,'sales')}>⚠ 이 기기 미동기화 거래 {won(focus.waiting)}건 →</a>}
     {focus.status==='ended'&&<div className="home-ended-summary">{focus.canReport&&<span className={!focus.closed&&focus.operator?'home-focus-warning':undefined}>{focus.closed?'정산 마감 완료':focus.operator?'정산 마감 필요':'정산 미마감'}</span>}{stock?.remaining>0&&<span>회수 확인 {won(stock.remaining)}개</span>}{focus.paid!=null&&<span>{focus.netScope==='own'?'내 ':''}지급 완료 {amount(focus.paid)}</span>}{focus.pending!=null&&<span>{focus.closed?'남은 정산':'예상 정산 대기'} {amount(focus.pending)}</span>}</div>}
     <footer className="home-focus-actions">{primary&&<a className="management-add" href={primary.href}>{primary.label} →</a>}{canAllocate&&<a className="management-back" href={allocationHref}>{focus.status==='ended'?'잔여 재고 회수':'재고 배정'}</a>}{focus.canReport&&primary?.href!==settlementLink(focus.id)&&<a className="management-back" href={settlementLink(focus.id)}>정산</a>}</footer>
    </>:<a className="management-back" href="#/projects">행사 선택 →</a>}
   </section>
   <section className="dashboard-card home-upcoming" aria-labelledby="home-upcoming-title"><div className="home-section-heading"><h2 id="home-upcoming-title">예정된 행사</h2><span>{future.length}개</span></div>
    {future.length?<><ol id="home-future-list" className="home-upcoming-rows">{visibleFuture.map(event=><li key={event.id}><a href={futureHref(event)}><div className="home-upcoming-name"><h3>{event.name}</h3><strong>{event.status==='upcoming'?event.dayLabel:'일정 미정'}</strong></div><p className="home-upcoming-meta">{[event.boothName,periodOf(event),roleOf(event.p)].filter(Boolean).join(' · ')}</p>{event.venue&&<p className="home-event-venue">{event.venue}</p>}<Preparation event={event} warehouse={warehouse} compact/></a></li>)}</ol>{future.length>3&&<button type="button" className="management-back home-upcoming-toggle" aria-expanded={expanded} aria-controls="home-future-list" onClick={()=>setExpanded(value=>!value)}>{expanded?'접기':`전체 보기 (${future.length})`}</button>}</>:<p className="home-upcoming-empty">{focus?.status==='upcoming'?'다음 예정 행사가 없어요. 새 행사를 만들어 보세요.':'예정된 행사가 없어요. 새 행사를 만들어 보세요.'}</p>}
    <footer className="home-upcoming-actions"><a className="management-back" href="#/projects/new">+ 새 행사</a></footer>
   </section>
   <div className="home-summary-grid">
    <section className="dashboard-card home-stock" aria-labelledby="home-stock-title"><div className="home-section-heading"><h2 id="home-stock-title">내 재고</h2><a href="#/inventory">재고관리 →</a></div><div className="home-stock-total"><span>현재 잔량 <strong>{won(remaining)}개</strong></span><span>미배정 <strong>{won(warehouse)}개</strong></span></div>{stockTotal>0&&<div className="inventory-stock-bar" role="img" aria-label={portions.map(([,label,value])=>`${label} ${won(value)}개`).join(', ')}>{portions.filter(([, ,value])=>value>0).map(([key,label,value])=><span key={key} className={`is-${key}`} style={{flexGrow:value}} title={`${label} ${won(value)}개`}/>)}</div>}<div className="inventory-stock-legend">{portions.map(([key,label,value])=><span key={key}><i className={`is-${key}`}/>{label} <strong>{won(value)}개</strong></span>)}</div></section>
    <section className="dashboard-card home-finance" aria-labelledby="home-finance-title"><div className="home-section-heading"><h2 id="home-finance-title">내 정산</h2><a href="#/account/revenue">정산 내역 →</a></div><dl className="home-primary-metric"><dt>확정 정산 대기 · 전체 기간</dt><dd>{amount(pending)}</dd></dl><dl className="home-finance-details"><div><dt>확정 정산금 · 전체 기간</dt><dd>{amount(sum(confirmed,'net'))}</dd></div><div><dt>지급 완료 · 전체 기간</dt><dd>{amount(paid)}</dd></div></dl><div className="home-sales-period"><div className="home-section-heading"><span>내 판매액 · {period==='all'?'전체 기간':period==='year'?'올해':'선택 기간'}</span><strong>{amount(gross)}</strong></div><div className="revenue-period" role="group" aria-label="내 판매액 집계 기간">{[['all','전체'],['year','올해'],['custom','직접 선택']].map(([key,label])=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}{period==='custom'&&<div className="home-period-dates"><label>시작일<input type="date" value={start} max={end||undefined} onChange={event=>setStart(event.target.value)}/></label><label>종료일<input type="date" min={start} value={end} onChange={event=>setEnd(event.target.value)}/></label></div>}</div></div></section>
   </div>
   {past.length>0&&<details className="home-past-events"><summary>지난 행사 <span>{past.length}개</span></summary><ul className="home-past-list">{past.map(event=><li key={event.id}><a href={futureHref(event)}><strong>{event.name}</strong><span>{periodOf(event)}</span><span>{event.closed?'정산 마감':'정산 미마감'}</span></a></li>)}</ul></details>}
  </>}
 </div></main>;
}
