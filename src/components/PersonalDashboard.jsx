import {useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import LoadingState from './LoadingState';

const settlementLink=id=>`#/settlement?projectId=${encodeURIComponent(id)}`;
const roleOf=p=>p.operator||p.canManage?'운영자':p.role==='assistant'?'부관리자':p.role==='seller'?'판매 담당':p.role==='viewer'?'조회 담당':'참여 제작자';
const amount=value=>`${won(value)}원`;

export default function PersonalDashboard({data,error,events=[]}) {
 const [period,setPeriod]=useState('all'),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const today=koreanDay(new Date());
 const inventory=data?.inventory||[],history=data?.events||[];
 const settlements=history.flatMap(event=>(event.rows||[]).map(row=>({...row,event})));
 const confirmed=settlements.filter(row=>row.event.closedAt);
 const sum=(rows,key)=>rows.reduce((total,row)=>total+Number(row[key]||0),0);
 const pending=sum(confirmed,'pending'),paid=sum(settlements,'paid');
 const warehouse=sum(inventory,'warehouse'),remaining=sum(inventory,'remaining');
 const sold=inventory.reduce((total,item)=>total+Number(item.stockSummary?.sold||0),0);
 const eventRemaining=inventory.reduce((total,item)=>total+Number(item.stockSummary?.eventRemaining||0),0);
 const other=inventory.reduce((total,item)=>total+Number(item.stockSummary?.other||0),0);
 const portions=[['sold','행사 판매',sold],['remaining','행사 잔여',eventRemaining],['warehouse','미배정',warehouse],...(other>0?[['other','기타 차감',other]]:[])];
 const stockTotal=portions.reduce((total,[,,value])=>total+value,0);
 const merged=new Map(events.map(event=>[event.id,{...event}]));
 for(const event of history){const existing=merged.get(event.projectId)||{};merged.set(event.projectId,{...existing,id:event.projectId,name:existing.name||event.eventName,boothName:existing.boothName||event.boothName,history:event});}
 for(const schedule of data?.stockEvents||[]){const event=merged.get(schedule.id);if(event)merged.set(schedule.id,{...event,schedule});}
 const cards=[...merged.values()].map(event=>{
  const schedule={starts_on:event.startsOn,ends_on:event.endsOn,...event.schedule},p=event.permissions||{};
  const closed=Boolean(event.history?.closedAt||schedule.closed_at||event.settlementClosedAt);
  const status=event.archivedAt||schedule.archived_at||closed||schedule.ends_on&&schedule.ends_on<today?'ended':schedule.starts_on&&schedule.starts_on>today?'upcoming':schedule.starts_on&&schedule.ends_on?'active':'unscheduled';
  const allocations=inventory.flatMap(item=>(item.allocations||[]).filter(row=>row.projectId===event.id));
  const sales=(event.history?.sales||[]).filter(sale=>!sale.voided);
  return {...event,schedule,p,closed,status,allocations,sales,canReport:Boolean(p.canSettle||p.canReadOwnHistory||p.ownerIds?.length||event.history)};
 }).sort((a,b)=>({active:0,upcoming:1,unscheduled:2,ended:3}[a.status]-{active:0,upcoming:1,unscheduled:2,ended:3}[b.status])||String(a.schedule?.starts_on||'').localeCompare(String(b.schedule?.starts_on||''))||a.name.localeCompare(b.name,'ko'));
 const current=cards.filter(event=>event.status!=='ended'),past=cards.filter(event=>event.status==='ended');
 const operators=current.filter(event=>event.p.operator||event.p.canManage),participants=current.filter(event=>!operators.includes(event));
 const alerts=[];
 for(const event of cards){
  const negative=(event.history?.rows||[]).filter(row=>Number(row.net)<0);
  if(negative.length)alerts.push({key:`negative:${event.id}`,urgent:true,href:settlementLink(event.id),text:`${event.name} · ${event.closed?'확정':'예상'} 마이너스 정산 ${amount(sum(negative,'net'))}`,detail:'비용이 판매액을 초과합니다.'});
  const recover=sum(event.allocations,'remaining');
  if(event.status==='ended'&&recover>0)alerts.push({key:`recover:${event.id}`,href:'#/inventory',text:`${event.name} · 잔여 재고 ${won(recover)}개`,detail:event.closed?'정산 마감 상태 · 회수 가능 여부 확인':'회수 필요'});
 }
 const allocatable=current.filter(event=>event.schedule&&(event.schedule.operator||event.schedule.artistEditable));
 if(warehouse>0&&allocatable.length)alerts.push({key:'warehouse',href:'#/inventory',text:`미배정 재고 ${won(warehouse)}개`,detail:`${allocatable[0].name}${allocatable.length>1?` 외 ${allocatable.length-1}개 행사`:''} · 상품별 배정 가능 여부 확인`});
 if(pending>0)alerts.push({key:'pending',href:'#/account/revenue',text:`확정 정산 대기 ${amount(pending)}`,detail:'지급 내역 확인'});
 const rangeStart=period==='year'?`${today.slice(0,4)}-01-01`:period==='custom'?start:'';
 const rangeEnd=period==='year'?today:period==='custom'?end:'';
 const gross=history.flatMap(event=>event.sales||[]).filter(sale=>{const day=koreanDay(sale.time);return !sale.voided&&(!rangeStart||day>=rangeStart)&&(!rangeEnd||day<=rangeEnd);}).flatMap(sale=>sale.items).reduce((total,item)=>total+Number(item.amount||0),0);
 const renderCard=event=>{
  const total=event.summary&&['total','sales','remainingStock'].every(key=>Number.isFinite(Number(event.summary[key])))?event.summary:null;
  const ownAmount=event.sales.flatMap(sale=>sale.items).reduce((value,item)=>value+Number(item.amount||0),0);
  const ownQuantity=event.sales.flatMap(sale=>sale.items).reduce((value,item)=>value+Number(item.quantity||0),0);
  return <article className="management-product home-event-card" key={event.id}>
   <header><div><span className={`inventory-event-status is-${event.status}`}>{event.status==='ended'?'종료':event.status==='upcoming'?'예정':event.status==='active'?'진행 중':'일정 미설정'}</span><h3>{event.name}</h3>{event.boothName&&!/^기본\s*부스$/.test(event.boothName.trim())&&<span className="home-muted">{event.boothName}</span>}</div><span className="home-role">{roleOf(event.p)}</span></header>
   <dl className="home-event-metrics">
    {total&&(event.p.operator||event.p.canManage)?<><div><dt>행사 판매액</dt><dd>{amount(total.total)}</dd></div><div><dt>거래</dt><dd>{won(total.sales)}건</dd></div><div><dt>행사 잔여</dt><dd>{won(total.remainingStock)}개</dd></div></>:<>
     {event.history&&<><div><dt>내 판매액</dt><dd>{amount(ownAmount)}</dd></div><div><dt>내 판매 수량</dt><dd>{won(ownQuantity)}개</dd></div></>}
     {event.allocations.length>0&&<div><dt>내 행사 잔여</dt><dd>{won(sum(event.allocations,'remaining'))}개</dd></div>}
    </>}
   </dl>
   {event.history&&<div className={`home-event-net${sum(event.history.rows,'net')<0?' is-negative':''}`}><span>{event.closed?'확정 정산금':'예상 정산금'}</span><strong>{amount(sum(event.history.rows,'net'))}</strong></div>}
   <footer>{(event.p.canSell||event.p.canViewPos)&&<a className="management-add" href={`#/sales?projectId=${encodeURIComponent(event.id)}`}>{event.p.canSell&&!event.closed&&event.status!=='ended'?'판매 화면':'상품 목록'} →</a>}{event.canReport&&<a className="management-back" href={settlementLink(event.id)}>{event.p.canSettle?'정산':'내 정산'} →</a>}</footer>
  </article>;
 };
 return <main className="page-content"><div className="page-body home-dashboard"><h1 className="sr-only">대시보드</h1>
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  {data&&<>
   {alerts.length>0&&<section className="home-attention" aria-labelledby="home-attention-title"><h2 id="home-attention-title">지금 확인할 것 <span>{alerts.length}</span></h2><ul>{alerts.map(alert=><li key={alert.key}><a href={alert.href} className={alert.urgent?'is-negative':undefined}><strong>{alert.text}</strong><span>{alert.detail} →</span></a></li>)}</ul></section>}
   {current.length>0&&<section className="dashboard-card home-events" aria-labelledby="home-events-title"><div className="home-section-heading"><h2 id="home-events-title">참여 행사</h2><a href="#/projects">행사 선택 →</a></div>{operators.length>0&&participants.length>0?<><h3 className="home-group-title">내가 운영하는 행사</h3><div className="home-event-grid">{operators.map(renderCard)}</div><h3 className="home-group-title">내가 참여한 행사</h3><div className="home-event-grid">{participants.map(renderCard)}</div></>:<div className="home-event-grid">{current.map(renderCard)}</div>}</section>}
   <div className="home-summary-grid">
    <section className="dashboard-card home-stock" aria-labelledby="home-stock-title"><div className="home-section-heading"><h2 id="home-stock-title">내 재고</h2><a href="#/inventory">재고관리 →</a></div><div className="home-stock-total"><span>현재 잔량 <strong>{won(remaining)}개</strong></span><span>미배정 <strong>{won(warehouse)}개</strong></span></div>{stockTotal>0&&<div className="inventory-stock-bar" role="img" aria-label={portions.map(([,label,value])=>`${label} ${won(value)}개`).join(', ')}>{portions.filter(([, ,value])=>value>0).map(([key,label,value])=><span key={key} className={`is-${key}`} style={{flexGrow:value}} title={`${label} ${won(value)}개`}/>)}</div>}<div className="inventory-stock-legend">{portions.map(([key,label,value])=><span key={key}><i className={`is-${key}`}/>{label} <strong>{won(value)}개</strong></span>)}</div></section>
    <section className="dashboard-card home-finance" aria-labelledby="home-finance-title"><div className="home-section-heading"><h2 id="home-finance-title">내 정산</h2><a href="#/account/revenue">정산 내역 →</a></div><dl className="home-primary-metric"><dt>확정 정산 대기 · 전체 기간</dt><dd>{amount(pending)}</dd></dl><dl className="home-finance-details"><div><dt>확정 정산금 · 전체 기간</dt><dd>{amount(sum(confirmed,'net'))}</dd></div><div><dt>지급 완료 · 전체 기간</dt><dd>{amount(paid)}</dd></div></dl><div className="home-sales-period"><div className="home-section-heading"><span>내 판매액 · {period==='all'?'전체 기간':period==='year'?'올해':'선택 기간'}</span><strong>{amount(gross)}</strong></div><div className="revenue-period" role="group" aria-label="내 판매액 집계 기간">{[['all','전체'],['year','올해'],['custom','직접 선택']].map(([key,label])=><button key={key} type="button" aria-pressed={period===key} onClick={()=>setPeriod(key)}>{label}</button>)}{period==='custom'&&<div className="home-period-dates"><label>시작일<input type="date" value={start} max={end||undefined} onChange={event=>setStart(event.target.value)}/></label><label>종료일<input type="date" min={start} value={end} onChange={event=>setEnd(event.target.value)}/></label></div>}</div></div></section>
   </div>
   {past.length>0&&<details className="home-past-events"><summary>지난 행사 <span>{past.length}개</span></summary><div className="home-event-grid">{past.map(renderCard)}</div></details>}
  </>}
 </div></main>;
}
