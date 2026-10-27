import { useEffect, useRef, useState } from 'react';
import { eventSettlementPreview } from '../utils/eventSettlement';
import { orderRepository } from '../database/orderRepository';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { confirmAction } from '../utils/confirmAction';
import { won } from '../utils/productDisplay';
import LoadingState from './LoadingState';
import SettlementEditor from './SettlementEditor';
import { koreanDay } from '../utils/revenueSummary';
import {useEventReadRefresh} from '../hooks/useEventReadRefresh';
export default function EventSettlementPanel({request,projectId,onChange}) {
 const [data,setData]=useState(null),[costs,setCosts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null);
 const [costDraft,setCostDraft]=useState(null),[costError,setCostError]=useState('');
 const costDialog=useRef(null);
 useEffect(()=>{if(costDraft)costDialog.current?.showModal();else costDialog.current?.close();},[Boolean(costDraft)]);
 const updateCost=(key,value)=>setCostDraft(current=>({...current,[key]:value}));
 const addCost=e=>{e.preventDefault();const value=Number(costDraft.value);if(!costDraft.label.trim()||costDraft.value===''||!Number.isFinite(value)||value<0||(costDraft.type==='fixed'&&!Number.isSafeInteger(value))||(costDraft.type==='percent'&&(value>100||Math.abs(value*100-Math.round(value*100))>1e-7))){setCostError('항목명과 올바른 금액·수수료를 입력해주세요.');return;}setCosts(current=>[...current,{...costDraft,label:costDraft.label.trim(),value:costDraft.type==='percent'?Math.round(value*100):value}]);setCostDraft(null);};
 const pending=useRef(null),lock=useRef(false),active=useRef(true);
 const event=data?.eventSettlements.find(row=>row.projectId===projectId) || {version:0,costs:[],history:[]};
 const dirty=JSON.stringify(costs)!==JSON.stringify(event.costs);
 const readRevision=useEventReadRefresh(request,!busy&&!pending.current&&!costDraft&&!editing&&!dirty);
 const load=async()=>{const result=await request(`/api/settlements?projectId=${encodeURIComponent(projectId)}`);if(active.current){setData(result);setCosts(result.eventSettlements.find(row=>row.projectId===projectId)?.costs || []);}return result;};
 useEffect(()=>{active.current=true;load().catch(e=>{if(active.current){setError(e.message);if([401,403,404].includes(e.status))setData(null);}});return()=>{active.current=false;};},[projectId,request,readRevision]);
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
  const recipientId=command.recipientId||data.recipientMappings?.find(m=>m.project_id===projectId&&m.legacy_creator===command.creator)?.recipient_id;
  if(recipientId){command={...command,recipientId};delete command.creator;}
  const result=await request('/api/settlements',{method:'POST',body:JSON.stringify(command)});
  if(active.current)setData(current=>({...current,settlements:[...current.settlements.filter(r=>r.projectId!==result.settlement.projectId||r.creator!==result.settlement.creator),result.settlement]}));
 };
 const rowFor=frozen=>{const record=data.settlements.find(row=>row.projectId===projectId&&row.creator===frozen.creator)||{version:0,payments:[],deductions:[]};const paid=record.payments.reduce((sum,p)=>sum+p.amount,0);return {...record,...frozen,recipientId:record.recipientId||data.recipientMappings?.find(m=>m.project_id===projectId&&m.legacy_creator===frozen.creator)?.recipient_id,projectId,projectName:'행사 정산',confirmed:true,paid,pending:frozen.net-paid};};
 const paid=preview?.rows.some(row=>rowFor(row).paid>0);
 const change=(index,key,value)=>setCosts(current=>current.map((row,i)=>i===index?{...row,[key]:value}:row));
 return <section className="settlement-card event-settlement-panel"><div className="dashboard-card-heading"><h2>행사 정산 마감</h2><span className="revenue-status">{event.closedAt?(preview.rows.every(row=>row.net<=rowFor(row).paid)&&paid?'지급 완료':'마감'):'정산 중'}</span></div>{error&&<p role="alert" className="inventory-error">{error}</p>}{previewError&&<p role="alert">{previewError}</p>}{!data&&!error&&<LoadingState/>}{data&&<>
 <fieldset disabled={busy||Boolean(pending.current)}><div className="management-heading event-cost-heading"><h3>행사 비용·수수료</h3>{!event.closedAt&&<button type="button" className="management-add" disabled={costs.length>=50} onClick={()=>{setCostError('');setCostDraft({label:'',memo:'',type:'fixed',split:'equal',value:''});}}>+ 비용 항목 추가</button>}</div>
 <div className="management-table-wrap event-cost-table-wrap"><table className="management-table"><thead><tr><th scope="col">비용 항목</th><th scope="col">종류</th><th scope="col">금액·수수료</th><th scope="col">분담</th><th scope="col">메모</th>{!event.closedAt&&<th scope="col">관리</th>}</tr></thead><tbody>{(event.closedAt?event.snapshot.costs:costs).map((cost,index)=><tr key={index}><td>{cost.label}</td><td>{cost.type==='percent'?'수수료':'정액'}</td><td>{cost.type==='percent'?`${cost.value/100}%`:`${won(cost.value??cost.amount)}원`}</td><td>{cost.split==='equal'?'참여 제작자 균등':'판매액 비율'}</td><td>{cost.memo}</td>{!event.closedAt&&<td><button type="button" className="management-delete" aria-label={`${cost.label} 삭제`} onClick={()=>setCosts(current=>current.filter((_,i)=>i!==index))}>삭제</button></td>}</tr>)}</tbody></table></div>
 {!event.closedAt&&<div className="revenue-editor-actions"><button type="button" className="management-add" disabled={!dirty||Boolean(previewError)} onClick={()=>run('saveEventCosts')}>비용 저장</button></div>}</fieldset>
 <dialog ref={costDialog} className="app-confirm-dialog event-cost-dialog" aria-labelledby="event-cost-dialog-title" onCancel={()=>setCostDraft(null)}>
 <h2 id="event-cost-dialog-title">비용 항목 추가</h2>{costDraft&&<form className="account-form" onSubmit={addCost}><label>항목명<input autoFocus required maxLength={80} placeholder="부스임대료, 현수막 구매비용" value={costDraft.label} onChange={e=>updateCost('label',e.target.value)}/></label><div className="management-fields"><label>종류<select value={costDraft.type} onChange={e=>setCostDraft(current=>({...current,type:e.target.value,value:''}))}><option value="fixed">정액(원)</option><option value="percent">수수료(%)</option></select></label><label>{costDraft.type==='percent'?'수수료(%)':'금액(원)'}<input required type="number" min="0" max={costDraft.type==='percent'?100:2147483647} step={costDraft.type==='percent'?'0.01':'1'} value={costDraft.value} onChange={e=>updateCost('value',e.target.value)}/></label></div><label>분담<select value={costDraft.split} onChange={e=>updateCost('split',e.target.value)}><option value="equal">참여 제작자 균등</option><option value="ratio">판매액 비율</option></select></label><label>메모<input maxLength={500} value={costDraft.memo} onChange={e=>updateCost('memo',e.target.value)}/></label>{costError&&<p role="alert" className="inventory-error">{costError}</p>}<div className="app-confirm-actions"><button type="button" className="management-back" onClick={()=>setCostDraft(null)}>취소</button><button className="management-add">추가</button></div></form>}
 </dialog>
 {preview&&<><h3>{event.closedAt?'확정 정산서':'제작자별 예상 정산서'}</h3><div className="management-table-wrap"><table className="management-table"><thead><tr><th>제작자</th><th>판매액</th><th>분담 비용</th><th>정산금</th>{event.closedAt&&<><th>지급 완료</th><th>남은 정산</th><th>관리</th></>}</tr></thead><tbody>{preview.rows.map(row=>{const payable=rowFor(row);return <tr key={row.creator}><td>{row.creator}</td><td>{won(row.gross)}원</td><td><details><summary>{won(row.fees)}원</summary>{row.shares.map((share,i)=><p key={i}>{share.label} {won(share.amount)}원</p>)}</details></td><td className={row.net<0?'inventory-error':''}>{won(row.net)}원</td>{event.closedAt&&<><td>{won(payable.paid)}원</td><td>{won(payable.pending)}원</td><td><button className="management-back" disabled={busy || Boolean(editing)} onClick={()=>setEditing(row.creator)}>지급 관리</button><button className="management-add" disabled={busy || Boolean(editing) || payable.pending<=0} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{if(await orderRepository.countWaiting(projectId))throw new Error('미동기화 거래를 먼저 처리해주세요.');if(await confirmAction(`${row.creator}에게 남은 ${won(payable.pending)}원을 지급한 것으로 기록할까요?`,{title:'지급 완료',confirmLabel:'기록'}))await savePayment({action:'addPayment',projectId,creator:row.creator,version:payable.version,requestId:crypto.randomUUID(),amount:payable.pending,paidAt:koreanDay(new Date()),memo:''});}catch(e){setError(e.message);}finally{setBusy(false);lock.current=false;}}}>지급 완료</button></td></>}</tr>;})}</tbody></table></div>{editing&&<SettlementEditor row={rowFor(preview.rows.find(row=>row.creator===editing))} save={savePayment} close={()=>setEditing(null)}/>}<p>판매액 {won(preview.gross)}원 · 차감 {won(preview.fees)}원 · 정산금 {won(preview.net)}원</p></>}
 <div className="revenue-editor-actions">{event.closedAt?<button className="management-back" disabled={busy || Boolean(editing) || paid} onClick={()=>run('reopenEventSettlement')}>마감 해제</button>:<button className="management-add" disabled={busy || dirty || !preview || Boolean(previewError)} onClick={()=>run('closeEventSettlement')}>정산 마감</button>}{pending.current&&<button className="management-back" disabled={busy} onClick={()=>run(pending.current.action)}>이전 요청 재확인</button>}</div>
 {event.history.length>0&&<details><summary>마감 이력</summary>{event.history.map((entry,i)=><p key={i}>{entry.action==='close'?'마감':'마감 해제'} · {new Date(entry.at).toLocaleString('ko-KR')}</p>)}</details>}
 </>}</section>;
}
