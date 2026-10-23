import {useEffect,useState} from 'react';
import {won} from '../utils/productDisplay';
import {koreanDay} from '../utils/revenueSummary';
import LoadingState from '../components/LoadingState';

export default function PersonalOverview({request,projectId,dashboard=false,events=[]}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
 useEffect(()=>{let active=true;request('/api/booths?artists=history').then(async value=>{
  if(dashboard){const stock=await Promise.all(value.profiles.map(p=>request(`/api/booths?artists=stock&ownerId=${encodeURIComponent(p.owner_id)}`)));value={...value,inventory:[...new Map(stock.flatMap(s=>s.inventory).map(item=>[item.id,item])).values()]};}
  if(active)setData(value);
 }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[request,projectId,dashboard]);
 const selected=(data?.events||[]).filter(e=>!projectId||e.projectId===projectId);
 const rows=selected.flatMap(e=>e.rows.map(row=>({...row,event:e})));
 const gross=selected.flatMap(e=>e.sales).filter(s=>!s.voided&&(!start||koreanDay(s.time)>=start)&&(!end||koreanDay(s.time)<=end)).flatMap(s=>s.items).reduce((s,i)=>s+i.amount,0);
 const sum=key=>rows.reduce((s,r)=>s+Number(r[key]||0),0);
 return <main className="page-content"><div className="page-body revenue-page"><h1>{dashboard?'대시보드':projectId?'정산현황':'수익현황'}</h1>
  {error&&<p role="alert" className="inventory-error">{error}</p>}{!data&&!error&&<LoadingState/>}
  {data&&<><div className="revenue-period"><label>판매 시작일<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>판매 종료일<input type="date" min={start} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
   {dashboard&&<dl className="account-dashboard-kpis">{[['내 미배정 재고',(data.inventory||[]).reduce((sum,i)=>sum+i.warehouse,0)],['내 현재 잔량',(data.inventory||[]).reduce((sum,i)=>sum+i.remaining,0)]].map(([label,value])=><div className="dashboard-metric" key={label}><dt>{label}</dt><dd>{won(value)}개</dd></div>)}</dl>}
   <dl className="account-dashboard-kpis">{[['내 판매액',gross],['확정 정산금',rows.filter(r=>r.event.closedAt).reduce((s,r)=>s+r.net,0)],['지급 완료',sum('paid')],['정산 대기 · 전체 기간',sum('pending')]].map(([label,value])=><div className="dashboard-metric" key={label}><dt>{label}</dt><dd>{won(value)}원</dd></div>)}</dl>
   <div className="management-table-wrap"><table className="management-table"><thead><tr><th>부스 · 행사</th><th>작가</th><th>판매액</th><th>비용</th><th>정산금</th><th>지급</th><th>상태</th></tr></thead><tbody>{rows.map(r=><tr key={`${r.event.projectId}:${r.recipientId}`}><td><a href={`#/settlement?projectId=${encodeURIComponent(r.event.projectId)}`}>{r.event.boothName} · {r.event.eventName}</a></td><td>{r.artistName}</td><td>{won(r.gross)}</td><td>{won(r.fees)}</td><td>{won(r.net)}</td><td>{won(r.paid)}</td><td>{r.event.closedAt?'확정':'예상'}</td></tr>)}</tbody></table></div>
   {dashboard&&<div className="event-action-grid">{events.map(e=><a className="event-action-card" key={e.id} href={`#/${e.permissions.canSell?'sales':'settlement'}?projectId=${encodeURIComponent(e.id)}`}><strong>{e.boothName} · {e.name}</strong><span>{e.permissions.operator?'운영자':e.permissions.role==='assistant'?'부관리자':e.permissions.role==='seller'?'판매 담당':'참여 작가'}</span></a>)}</div>}
  </>}
 </div></main>;
}
