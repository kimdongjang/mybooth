import { useEffect, useRef, useState } from 'react';
import { eventSettlementPreview } from '../utils/eventSettlement';
import { orderRepository } from '../database/orderRepository';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { confirmAction } from '../utils/confirmAction';
import { won } from '../utils/productDisplay';
import LoadingState from './LoadingState';
import SettlementEditor from './SettlementEditor';
import { koreanDay } from '../utils/revenueSummary';
export default function EventSettlementPanel({request,projectId,onChange}) {
 const [data,setData]=useState(null),[costs,setCosts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null);
 const pending=useRef(null),lock=useRef(false),active=useRef(true);
 const load=async()=>{const result=await request(`/api/settlements?projectId=${encodeURIComponent(projectId)}`);if(active.current){setData(result);setCosts(result.eventSettlements.find(row=>row.projectId===projectId)?.costs || []);}return result;};
 useEffect(()=>{active.current=true;load().catch(e=>{if(active.current)setError(e.message);});return()=>{active.current=false;};},[projectId,request]);
 const event=data?.eventSettlements.find(row=>row.projectId===projectId) || {version:0,costs:[],history:[]};
 const dirty=JSON.stringify(costs)!==JSON.stringify(event.costs);
 const clear=useUnsavedChanges(dirty);
 let preview,previewError;
 try{preview=event.closedAt?event.snapshot:data?eventSettlementPreview(data.state,costs,data.settlements.filter(row=>row.projectId===projectId)):null;}catch(e){previewError=e.message;}
 const run=async action=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   if(await orderRepository.countWaiting(projectId))throw new Error('이 행사의 미동기화 거래를 먼저 동기화해주세요.');
   if(action==='closeEventSettlement' && !await confirmAction('마감 후 판매·취소·비용 수정이 잠깁니다. 모든 기기의 판매를 중단하고 동기화를 완료했는지 확인해주세요. 정산을 마감할까요?',{title:'정산 마감',confirmLabel:'마감'}))return;
   if(action==='reopenEventSettlement' && !await confirmAction('마감을 해제하고 정산을 다시 수정할까요?',{title:'마감 해제',confirmLabel:'해제'}))return;
   pending.current ||= {action,projectId,version:event.version,requestId:crypto.randomUUID(),...(action==='saveEventCosts'?{costs}:action==='closeEventSettlement'?{expectedPreview:JSON.stringify(preview)}:{})};
   await request('/api/settlements',{method:'POST',body:JSON.stringify(pending.current)});pending.current=null;clear();await load();await onChange?.(action);
  }catch(e){if(e.status>=400 && e.status<500)pending.current=null;setError(e.message);}finally{lock.current=false;setBusy(false);}
 };
 const savePayment=async command=>{
  if(await orderRepository.countWaiting(projectId))throw new Error('미동기화 거래를 먼저 처리해주세요.');
  const result=await request('/api/settlements',{method:'POST',body:JSON.stringify(command)});
  if(active.current)setData(current=>({...current,settlements:[...current.settlements.filter(r=>r.projectId!==result.settlement.projectId||r.creator!==result.settlement.creator),result.settlement]}));
 };
 const rowFor=frozen=>{const record=data.settlements.find(row=>row.projectId===projectId&&row.creator===frozen.creator)||{version:0,payments:[],deductions:[]};const paid=record.payments.reduce((sum,p)=>sum+p.amount,0);return {...record,...frozen,projectId,projectName:'행사 정산',confirmed:true,paid,pending:frozen.net-paid};};
 const paid=preview?.rows.some(row=>rowFor(row).paid>0);
 const change=(index,key,value)=>setCosts(current=>current.map((row,i)=>i===index?{...row,[key]:value}:row));
 return <section className="settlement-card event-settlement-panel"><div className="dashboard-card-heading"><h2>행사 정산 마감</h2><span className="revenue-status">{event.closedAt?(preview.rows.every(row=>row.net<=rowFor(row).paid)&&paid?'지급 완료':'마감'):'정산 중'}</span></div>{error&&<p role="alert" className="inventory-error">{error}</p>}{previewError&&<p role="alert">{previewError}</p>}{!data&&!error&&<LoadingState/>}{data&&<>
 {!event.closedAt&&<fieldset disabled={busy || Boolean(pending.current)}><legend>행사 비용·수수료</legend>{costs.map((cost,index)=><div className="event-cost-row" key={index}><label>항목명<input required maxLength={80} value={cost.label} onChange={e=>change(index,'label',e.target.value)}/></label><label>종류<select value={cost.type} onChange={e=>{change(index,'type',e.target.value);change(index,'value',0);}}><option value="fixed">정액(원)</option><option value="percent">수수료(%)</option></select></label><label>{cost.type==='percent'?'비율(%)':'금액(원)'}<input type="number" min="0" step={cost.type==='percent'?'0.01':'1'} max={cost.type==='percent'?100:2147483647} value={cost.type==='percent'?cost.value/100:cost.value} onChange={e=>change(index,'value',e.target.value===''?null:(cost.type==='percent'?Math.round(Number(e.target.value)*100):Number(e.target.value)))}/></label><label>분담<select value={cost.split} onChange={e=>change(index,'split',e.target.value)}><option value="equal">참여 작가 균등</option><option value="ratio">판매액 비율</option></select></label><label>메모<input maxLength={500} value={cost.memo} onChange={e=>change(index,'memo',e.target.value)}/></label><button type="button" className="management-back" onClick={()=>setCosts(costs.filter((_,i)=>i!==index))}>제거</button></div>)}<div className="revenue-editor-actions"><button className="management-back" disabled={costs.length>=50} onClick={()=>setCosts([...costs,{label:'',memo:'',type:'fixed',split:'equal',value:0}])}>+ 비용 항목</button><button className="management-add" disabled={!dirty || Boolean(previewError)} onClick={()=>run('saveEventCosts')}>비용 저장</button></div></fieldset>}
 {event.closedAt && <div className="event-final-costs">{event.snapshot.costs.map((cost,index)=><p key={index}><strong>{cost.label}</strong> · {won(cost.amount)}원 · {cost.split==='equal'?'균등 분담':'판매액 비율'}{cost.type==='percent'?` · ${cost.value/100}%`:''}{cost.memo?` · ${cost.memo}`:''}</p>)}</div>}
 {preview&&<><h3>{event.closedAt?'확정 정산서':'작가별 예상 정산서'}</h3><div className="management-table-wrap"><table className="management-table"><thead><tr><th>작가</th><th>판매액</th><th>분담 비용</th><th>정산금</th>{event.closedAt&&<><th>지급 완료</th><th>남은 정산</th><th>관리</th></>}</tr></thead><tbody>{preview.rows.map(row=>{const payable=rowFor(row);return <tr key={row.creator}><td>{row.creator}</td><td>{won(row.gross)}원</td><td><details><summary>{won(row.fees)}원</summary>{row.shares.map((share,i)=><p key={i}>{share.label} {won(share.amount)}원</p>)}</details></td><td className={row.net<0?'inventory-error':''}>{won(row.net)}원</td>{event.closedAt&&<><td>{won(payable.paid)}원</td><td>{won(payable.pending)}원</td><td><button className="management-back" disabled={busy || Boolean(editing)} onClick={()=>setEditing(row.creator)}>지급 관리</button><button className="management-add" disabled={busy || Boolean(editing) || payable.pending<=0} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{if(await orderRepository.countWaiting(projectId))throw new Error('미동기화 거래를 먼저 처리해주세요.');if(await confirmAction(`${row.creator}에게 남은 ${won(payable.pending)}원을 지급한 것으로 기록할까요?`,{title:'지급 완료',confirmLabel:'기록'}))await savePayment({action:'addPayment',projectId,creator:row.creator,version:payable.version,requestId:crypto.randomUUID(),amount:payable.pending,paidAt:koreanDay(new Date()),memo:''});}catch(e){setError(e.message);}finally{setBusy(false);lock.current=false;}}}>지급 완료</button></td></>}</tr>;})}</tbody></table></div>{editing&&<SettlementEditor row={rowFor(preview.rows.find(row=>row.creator===editing))} save={savePayment} close={()=>setEditing(null)}/>}<p>판매액 {won(preview.gross)}원 · 차감 {won(preview.fees)}원 · 정산금 {won(preview.net)}원</p></>}
 <div className="revenue-editor-actions">{event.closedAt?<button className="management-back" disabled={busy || Boolean(editing) || paid} onClick={()=>run('reopenEventSettlement')}>마감 해제</button>:<button className="management-add" disabled={busy || dirty || !preview || Boolean(previewError)} onClick={()=>run('closeEventSettlement')}>정산 마감</button>}{pending.current&&<button className="management-back" disabled={busy} onClick={()=>run(pending.current.action)}>이전 요청 재확인</button>}</div>
 {event.history.length>0&&<details><summary>마감 이력</summary>{event.history.map((entry,i)=><p key={i}>{entry.action==='close'?'마감':'마감 해제'} · {new Date(entry.at).toLocaleString('ko-KR')}</p>)}</details>}
 </>}</section>;
}
