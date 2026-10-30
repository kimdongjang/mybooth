import {settlementPhaseLabel,recipientSettlementLabel} from '../utils/eventSettlement';
import {useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import {dashboardEvents,dashboardAlerts,dashboardFocus,dashboardPastEvents,dashboardRole,settlementDisplay,inventorySalesBreakdown} from '../utils/personalDashboard';
import LoadingState from './LoadingState';

const settlementLink=id=>`#/settlement?projectId=${encodeURIComponent(id)}`;
const eventLink=(event,page)=>`#/${page}?projectId=${encodeURIComponent(event.id)}`;
const amount=value=>`${won(value)}원`;
const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
const statusLabel={active:'진행 중',upcoming:'진행 예정',ended:'종료',unscheduled:'일정 미정'};
const settlementLabel={open:'정산 시작 전',closed:'정산 진행 중',paid:'정산 완료',finished:'정산 종료'};
const period=schedule=>schedule.starts_on?`${schedule.starts_on.replaceAll('-','.')}${schedule.ends_on&&schedule.ends_on!==schedule.starts_on?`~${schedule.ends_on.slice(5).replace('-','.')}`:''}`:'일정 미정';

function alertContent(alert,warehouse) {
 const {event}=alert,scope=event.netScope==='own'?'내 ':'';
 switch(alert.type) {
  case 'waiting':return {href:eventLink(event,'sales'),text:`${event.name} · 이 기기 미동기화 거래 ${won(event.waiting)}건`,urgent:true};
  case 'recovery':return {href:'#/inventory',text:`${event.name} · 잔여 재고 ${won(event.stock.remaining)}개 회수 필요`};
  case 'close':return {href:settlementLink(event.id),text:`${event.name} · 정산 시작 필요`};
  case 'allocation':return {href:'#/inventory',text:`미배정 재고 ${won(warehouse)}개 · ${event.name}에 배정 가능`};
  case 'pending':return {href:settlementLink(event.id),text:`${event.name} · ${scope}정산 대기 ${amount(event.pending)}`};
  default:return {href:event.p.canConfigure||event.p.ownerIds?.length?eventLink(event,'products'):'#/inventory',text:`${event.name} · 품절 임박 상품 ${won(event.lowStock)}종`};
 }
}

function SettlementEstimate({event,label='정산 예상액'}) {
 const view=settlementDisplay(event);
 if(view.kind==='none')return null;
 if(view.kind==='empty')return <p className="home-settlement-note">아직 정산 예상액이 없어요</p>;
 return <p className="home-settlement-note">{label} <strong>{amount(view.amount)}</strong>{view.kind==='negative'&&<span title="판매액 − 분담 비용"> ⓘ 판매액 − 분담 비용</span>}{view.provisional&&<span> · 판매가 늘면 달라져요</span>}</p>;
}

function FocusCard({choices,index,onIndex}) {
 const event=choices[Math.min(index,choices.length-1)],p=event.p,m=event.metrics,stock=event.stock;
 const average=m.transactions>0&&m.gross!=null?amount(Math.round(m.gross/m.transactions)):'-';
 const rate=stock&&stock.total>0?Math.round(stock.sold/stock.total*100):0;
 const sellable=p.canSell||p.canViewPos,allocate=p.canConfigure||p.ownerIds?.length;
 return <section className="dashboard-card home-focus" aria-labelledby="home-focus-title">
  <div className="home-section-heading"><h2 id="home-focus-title">지금 집중할 행사</h2>{choices.length>1&&<span className="home-focus-switch"><button type="button" aria-label="이전 행사" onClick={()=>onIndex((index+choices.length-1)%choices.length)}>‹</button>{index+1}/{choices.length}<button type="button" aria-label="다음 행사" onClick={()=>onIndex((index+1)%choices.length)}>›</button></span>}</div>
  <header className="home-focus-title"><h3>{event.name}</h3><span className={`inventory-event-status is-${event.status}`}>{statusLabel[event.status]}</span>{event.dayLabel?<span className="event-countdown">{event.dayLabel}</span>:<span className="home-muted">일정을 입력하면 D-day가 표시돼요</span>}</header>
  <p className="home-muted">{[`내 역할 ${dashboardRole(event)}`,event.boothName&&`부스 ${event.boothName}`,event.venue&&`장소 ${event.venue}`].filter(Boolean).join(' · ')}</p>
  <dl className="home-event-metrics"><div><dt>행사 판매액</dt><dd>{m.gross!=null?amount(m.gross):'-'}</dd></div><div><dt>거래 건수</dt><dd>{m.transactions!=null?`${won(m.transactions)}건`:'-'}</dd></div><div><dt>객단가</dt><dd>{average}</dd></div></dl>
  {stock&&<div className="home-focus-stock"><div className="inventory-stock-bar" role="img" aria-label={`${stock.label} ${won(stock.sold)}개, 남음 ${won(stock.remaining)}개`}><span className="is-sold" style={{flexGrow:stock.sold}}/><span className="is-remaining" style={{flexGrow:stock.remaining}}/></div><span className="home-muted">재고 {stock.label}율 {rate}% · {stock.label} {won(stock.sold)}개 · 남음 {won(stock.remaining)}개</span></div>}
  <SettlementEstimate event={event}/>
  <footer className="home-focus-actions">{sellable&&<a className="is-primary" href={eventLink(event,'sales')}>판매 화면</a>}{allocate&&<a href={eventLink(event,'products')}>상품 관리</a>}{event.canReport&&<a href={settlementLink(event.id)}>판매 현황</a>}{p.canManage&&<a href={`#/project/manage?projectId=${encodeURIComponent(event.id)}`}>행사 관리</a>}</footer>
 </section>;
}

function UpcomingList({rows}) {
 return <section className="dashboard-card home-upcoming" aria-labelledby="home-upcoming-title"><div className="home-section-heading"><h2 id="home-upcoming-title">예정된 행사</h2><a href="#/projects/new">+ 새 행사</a></div>
  {rows.length>0?<ul className="home-upcoming-rows">{rows.map(event=>{const m=event.metrics,prep=[['상품',m.products],['배정',m.allocated],['제작자',m.artists]].filter(([,value])=>value!=null);
   return <li key={event.id}><a href={eventLink(event,'products')}><strong>{event.name}</strong><span className="event-countdown">{event.dayLabel||'일정 미정'}</span><span className="home-muted">{[event.boothName,dashboardRole(event)].filter(Boolean).join(' · ')}</span>{prep.length>0&&<span className="home-preparation is-compact">{prep.map(([label,value])=><span key={label} className={value===0?'needs-attention':undefined}>{value===0&&'ⓘ '}{label} {won(value)}</span>)}</span>}</a></li>;})}</ul>:<p className="home-muted">예정된 행사가 없어요</p>}
 </section>;
}

function PastEvents({past,highlight}) {
 const rows=past.rows.slice(0,5);
 return <section className="dashboard-card home-past" aria-labelledby="home-past-title"><div className="home-section-heading"><h2 id="home-past-title">지난 행사 이력</h2><a href="#/projects">전체 이력 보기 →</a></div>
  {past.count>0?<>
   <p className="home-muted">지난 행사 {won(past.count)}개 · 누적 판매액 {amount(past.gross)} · 후속 조치 {won(past.followUps)}건</p>
   <div className="management-table-wrap"><table className="management-table home-past-table"><thead><tr><th>행사명</th><th>기간</th><th>내 역할</th><th>판매액</th><th>내 정산금</th><th>정산 상태</th><th>재고 상태</th></tr></thead><tbody>{rows.map(({event,settlement,stock,remaining,followUp,role,gross,net})=>{
    const view=settlementDisplay(event);
    return <tr key={event.id} id={`past-event-${event.id}`} className={highlight===event.id?'is-highlighted':undefined} onClick={()=>{window.location.hash=settlementLink(event.id);}}>
     <td data-label="행사명"><a href={settlementLink(event.id)} onClick={e=>e.stopPropagation()}>{event.name}</a></td><td data-label="기간">{period(event.schedule)}</td><td data-label="내 역할">{role}</td><td data-label="판매액">{gross!=null?amount(gross):'-'}</td>
     <td data-label="내 정산금">{net==null?'-':view.kind==='negative'?<span title="판매액 − 분담 비용">ⓘ {amount(net)} (판매액 − 분담 비용)</span>:amount(net)}</td>
     <td data-label="정산 상태"><span className={`home-badge${settlement==='open'?' is-pending':''}`}>{settlementLabel[settlement]}</span></td>
     <td data-label="재고 상태">{stock==='recover'?<a className="home-badge is-pending" href="#/inventory" onClick={e=>e.stopPropagation()}>회수 필요 {won(remaining)}개</a>:<span className="home-badge">{stock==='done'?'회수 완료':'해당 없음'}</span>}</td>
    </tr>;})}</tbody></table></div>
  </>:<p className="home-muted">아직 종료된 행사가 없어요</p>}
 </section>;
}

export default function PersonalDashboard({data,error,events=[]}) {
 const [period,setPeriod]=useState('all'),[start,setStart]=useState(''),[end,setEnd]=useState(''),[focusIndex,setFocusIndex]=useState(0),[highlight,setHighlight]=useState('');
 const today=koreanDay(new Date()),inventory=data?.inventory||[],history=data?.events||[];
 const settlements=history.flatMap(event=>(event.rows||[]).map(row=>({...row,event}))),confirmed=settlements.filter(row=>row.event.closedAt);
 const pending=sum(confirmed,'pending'),paid=sum(settlements,'paid'),warehouse=sum(inventory,'warehouse'),remaining=sum(inventory,'remaining');
 const sold=inventory.reduce((total,item)=>total+Number(item.stockSummary?.sold||0),0),eventRemaining=inventory.reduce((total,item)=>total+Number(item.stockSummary?.eventRemaining||0),0),other=inventory.reduce((total,item)=>total+Number(item.stockSummary?.other||0),0);
 const portions=[['sold','판매 완료',sold],['remaining','행사 배정 잔여',eventRemaining],['warehouse','미배정',warehouse],...(other>0?[['other','기타 차감',other]]:[])],stockTotal=portions.reduce((total,[,,value])=>total+value,0);
 const cards=dashboardEvents(data,events,today),past=dashboardPastEvents(cards),groups=dashboardFocus(cards);
 const focus=groups.choices,focusEvent=focus[Math.min(focusIndex,focus.length-1)];
 const upcoming=[...groups.upcoming,...groups.unknown].filter(event=>!event.closed);
 const breakdown=inventorySalesBreakdown(inventory);
 const alerts=dashboardAlerts(cards,warehouse).map(alert=>({...alert,...alertContent(alert,warehouse)}));
 const showPastRow=alert=>{
  if(alert.type!=='recovery')return undefined;
  return e=>{const row=document.getElementById(`past-event-${alert.event.id}`);if(!row)return;e.preventDefault();row.scrollIntoView({behavior:'smooth',block:'center'});setHighlight(alert.event.id);};
 };
 const rangeStart=period==='year'?`${today.slice(0,4)}-01-01`:period==='custom'?start:'',rangeEnd=period==='year'?today:period==='custom'?end:'';
 const gross=history.flatMap(event=>event.sales||[]).filter(sale=>{const day=koreanDay(sale.time);return !sale.voided&&(!rangeStart||day>=rangeStart)&&(!rangeEnd||day<=rangeEnd);}).flatMap(sale=>sale.items).reduce((total,item)=>total+Number(item.amount||0),0);
 const confirmedNet=sum(confirmed,'net'),noRevenue=!pending&&!confirmedNet&&!paid&&!gross;
 return <main className="page-content"><div className="page-body home-dashboard"><div className="page-intro"><div className="page-heading"><h1 tabIndex={-1}>대시보드</h1></div><a className="management-back" href="#/projects">행사 목록 →</a></div>
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  {data&&<>
   {alerts.length>0&&<section className="home-alert-strip" aria-labelledby="home-alert-title"><h2 id="home-alert-title">지금 확인할 것</h2>{alerts.map(alert=><a key={alert.key} href={alert.href} className={alert.urgent?'is-urgent':undefined} onClick={showPastRow(alert)}>{alert.urgent&&<span aria-hidden="true">⚠ </span>}{alert.text} →</a>)}</section>}
   <div className="home-row-two is-even">
    {focus.length>0&&<FocusCard choices={focus} index={focusIndex} onIndex={setFocusIndex}/>}
    <UpcomingList rows={upcoming}/>
   </div>
   <div className="home-row-two is-even">
    <section className="dashboard-card home-stock" aria-labelledby="home-stock-title"><div className="home-section-heading"><h2 id="home-stock-title">내 재고</h2><a href="#/inventory">재고관리 →</a></div>
     {stockTotal>0||remaining>0?<><div className="home-stock-total"><span>남은 재고 합계 <strong>{won(remaining)}개</strong></span><span>미배정 <strong>{won(warehouse)}개</strong>{warehouse>0&&<> <a href="#/inventory?view=unassigned">보기 →</a></>}</span></div><p className="home-muted">남은 재고 {won(remaining)}개 = 행사 배정 잔여 {won(eventRemaining)}개 + 미배정 {won(warehouse)}개 · 지금까지 판매 {won(sold)}개</p>{stockTotal>0&&<div className="inventory-stock-bar" role="img" aria-label={portions.map(([,label,value])=>`${label} ${won(value)}개`).join(', ')}>{portions.filter(([, ,value])=>value>0).map(([key,label,value])=><span key={key} className={`is-${key}`} style={{flexGrow:value}} title={`${label} ${won(value)}개`}/>)}</div>}<div className="inventory-stock-legend">{portions.map(([key,label,value])=><span key={key}><i className={`is-${key}`}/>{label} <strong>{won(value)}개</strong></span>)}</div></>:<p className="home-muted">등록된 재고가 없어요</p>}
    </section>
    <section className="dashboard-card home-finance" aria-labelledby="home-finance-title"><div className="home-section-heading"><h2 id="home-finance-title">내 수익현황</h2><a href="#/account/revenue">수익현황 →</a></div>
     <div className="revenue-period" role="group" aria-label="내 판매액 집계 기간">{[['all','전체'],['year','올해'],['custom','직접 선택']].map(([key,label])=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}{period==='custom'&&<div className="home-period-dates"><label>시작일<input type="date" value={start} max={end||undefined} onChange={event=>setStart(event.target.value)}/></label><label>종료일<input type="date" min={start} value={end} onChange={event=>setEnd(event.target.value)}/></label></div>}</div>
     {noRevenue?<p className="home-muted">아직 집계된 수익이 없어요</p>:<><dl className="home-primary-metric"><dt>확정 정산 대기 · 항상 전체 기간</dt><dd>{amount(pending)}</dd></dl><dl className="home-finance-details"><div><dt>확정 정산금 · 전체 기간</dt><dd>{amount(confirmedNet)}</dd></div><div><dt>지급 완료 · 전체 기간</dt><dd>{amount(paid)}</dd></div><div><dt>내 판매액 · {period==='all'?'전체 기간':period==='year'?'올해':'선택 기간'}</dt><dd>{amount(gross)}</dd></div></dl></>}
    </section>
   </div>
   {breakdown.character.length>0&&<section className="dashboard-card home-sales-breakdown" aria-labelledby="home-breakdown-title"><div className="home-section-heading"><h2 id="home-breakdown-title">내 재고 판매 통계</h2><span className="home-muted">판매된 수량 기준</span></div><div className="home-breakdown-grid">{[['character','캐릭터'],['series','작품·시리즈'],['goods','굿즈 종류']].map(([key,label])=><div key={key}><h3>{label}별 판매 Top 5</h3><ol>{breakdown[key].map(row=><li key={row.name}><div><strong>{row.name}</strong><span>{won(row.sold)}개 · {amount(row.amount)}</span></div><progress max={breakdown[key][0].sold} value={row.sold} aria-label={`${row.name} 판매 수량`}/></li>)}</ol></div>)}</div></section>}
   {settlements.length>0&&<section className="dashboard-card home-own-settlements" aria-labelledby="home-own-settlements-title"><div className="home-section-heading"><h2 id="home-own-settlements-title">내 정산 현황</h2></div><div className="management-table-wrap" tabIndex={0} role="region" aria-label="내 정산 현황"><table className="management-table"><thead><tr><th>행사</th><th>정산금</th><th>행사 정산</th><th>내 정산</th></tr></thead><tbody>{settlements.map(row=><tr key={`${row.event.projectId}:${row.recipientId}`}><td><a href={settlementLink(row.event.projectId)}>{row.event.eventName}</a></td><td>{amount(row.net)}</td><td>{settlementPhaseLabel(row.event)}</td><td>{recipientSettlementLabel(row.event,row)}</td></tr>)}</tbody></table></div></section>}
   <PastEvents past={past} highlight={highlight}/>
  </>}
 </div></main>;
}
