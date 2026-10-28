import {useEffect,useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import LoadingState from '../components/LoadingState';
import PersonalDashboard from '../components/PersonalDashboard';
import {useEventReadRefresh} from '../hooks/useEventReadRefresh';

const noEvents=[];
const oneYearAgo=()=>{const date=new Date(`${koreanDay(new Date())}T00:00:00Z`);if(Number.isNaN(date.getTime()))return '';date.setUTCFullYear(date.getUTCFullYear()-1);return date.toISOString().slice(0,10);};
export default function PersonalOverview({request,projectId,dashboard=false,events=noEvents,readWaitingOrders}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[start,setStart]=useState(()=>projectId||dashboard?'':oneYearAgo()),[end,setEnd]=useState(()=>projectId||dashboard?'':koreanDay(new Date()));
 const readRevision=useEventReadRefresh(request);
 useEffect(()=>{let active=true;request('/api/booths?artists=history').then(async value=>{
  if(dashboard){const stock=await Promise.all(value.profiles.map(p=>request(`/api/booths?artists=stock&ownerId=${encodeURIComponent(p.owner_id)}`)));value={...value,inventory:[...new Map(stock.flatMap(s=>s.inventory).map(item=>[`${item.custodianId}:${item.inventoryId||item.id}`,item])).values()],stockEvents:[...new Map(stock.flatMap(s=>s.events||[]).map(event=>[event.id,event])).values()]};}
  if(dashboard&&readWaitingOrders){const counts=await Promise.all(events.filter(event=>event.permissions?.canSell||event.permissions?.canManage).map(async event=>[event.id,await readWaitingOrders(event.id).catch(()=>undefined)]));value={...value,waitingOrders:Object.fromEntries(counts)};}
  if(active)setData(value);
 }).catch(e=>{if(active){setError(e.message);if([401,403,404].includes(e.status))setData(null);}});return()=>{active=false;};},[request,projectId,dashboard,readWaitingOrders,events,readRevision]);
 if(dashboard)return <PersonalDashboard data={data} error={error} events={events}/>;
 const selected=(data?.events||[]).filter(e=>!projectId||e.projectId===projectId);
 const rows=selected.flatMap(e=>e.rows.map(row=>({...row,event:e})));
 const gross=selected.flatMap(e=>e.sales).filter(s=>!s.voided&&(!start||koreanDay(s.time)>=start)&&(!end||koreanDay(s.time)<=end)).flatMap(s=>s.items).reduce((s,i)=>s+i.amount,0);
 const sum=key=>rows.reduce((s,r)=>s+Number(r[key]||0),0);
 return <main className="page-content">
  {projectId?<header className="inventory-page-header"><nav className="inventory-breadcrumb" aria-label="현재 위치"><ol><li><h1 aria-current="page">판매 현황</h1></li></ol></nav></header>:<h1 className="sr-only">{dashboard?'대시보드':'수익현황'}</h1>}
  <div className="page-body revenue-page">
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  {data&&<><div className="revenue-period"><label>판매 시작일<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>판매 종료일<input type="date" min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
   <dl className="account-dashboard-kpis">{[['내 판매액',gross],['확정 정산금',rows.filter(r=>r.event.closedAt).reduce((s,r)=>s+r.net,0)],['지급 완료',sum('paid')],['정산 대기 · 전체 기간',sum('pending')]].map(([label,value])=><div className="dashboard-metric" key={label}><dt>{label}</dt><dd>{won(value)}원</dd></div>)}</dl>
   <div className="management-table-wrap"><table className="management-table"><thead><tr><th>부스 · 행사</th><th>제작자</th><th>판매액</th><th>비용</th><th>정산금</th><th>지급</th><th>상태</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.event.projectId}:${r.recipientId}`}><td><a href={`#/settlement?projectId=${encodeURIComponent(r.event.projectId)}`}>{r.event.boothName} · {r.event.eventName}</a></td><td>{r.artistName}</td><td>{won(r.gross)}</td><td>{won(r.fees)}</td><td>{won(r.net)}</td><td>{won(r.paid)}</td><td>{r.event.closedAt?'확정':'예상'}</td></tr>)}</tbody></table></div>


  </>}
 </div></main>;
}
