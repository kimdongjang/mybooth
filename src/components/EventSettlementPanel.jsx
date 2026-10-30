import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { eventSettlementPreview, validateEventCosts, recipientSettled, settlementPhaseLabel, recipientSettlementLabel } from '../utils/eventSettlement';
import { orderRepository } from '../database/orderRepository';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { confirmAction } from '../utils/confirmAction';
import { won } from '../utils/productDisplay';
import LoadingState from './LoadingState';
import { koreanDay } from '../utils/revenueSummary';
import {useEventReadRefresh} from '../hooks/useEventReadRefresh';
export default function EventSettlementPanel({request,projectId,onChange}) {
 const [data,setData]=useState(null),[costs,setCosts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[editing,setEditing]=useState(null);
 const [paymentAmount,setPaymentAmount]=useState(''),[paymentDate,setPaymentDate]=useState(koreanDay(new Date()));
 const paymentModal=useRef(null);
 const paymentLocked=useRef(false);
 useEffect(()=>{
  if(!editing)return;
  const previous=document.activeElement;
  paymentModal.current?.querySelector('input')?.focus();
  const handleKey=e=>{
   if(e.key==='Escape'){e.preventDefault();if(!paymentLocked.current)setEditing(null);}
   if(e.key==='Tab'){
    const controls=[...(paymentModal.current?.querySelectorAll('input:not(:disabled),button:not(:disabled)')||[])];
    if(!controls.length){e.preventDefault();return;}
    const first=controls[0],last=controls.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
   }
  };
  document.addEventListener('keydown',handleKey);
  return()=>{document.removeEventListener('keydown',handleKey);previous?.focus();};
 },[editing]);
 const [costIndex,setCostIndex]=useState(null);
 const [costDraft,setCostDraft]=useState(null),[costError,setCostError]=useState('');
 const [closeOpen,setCloseOpen]=useState(false),[closePassword,setClosePassword]=useState('');
 const closeDialog=useRef(null);
 useEffect(()=>{if(closeOpen)closeDialog.current?.showModal();else closeDialog.current?.close();},[closeOpen]);
 const costDialog=useRef(null);
 useEffect(()=>{if(costDraft)costDialog.current?.showModal();else costDialog.current?.close();},[Boolean(costDraft)]);
 const updateCost=(key,value)=>setCostDraft(current=>({...current,[key]:value}));
 const addCost=async e=>{
  e.preventDefault();
  try {
   const value=Number(costDraft.value);
   if(costDraft.value==='' || !Number.isFinite(value) || (costDraft.type==='percent' && Math.abs(value*100-Math.round(value*100))>1e-7))throw new Error('항목명과 올바른 금액·수수료를 입력해주세요.');
   const [cost]=validateEventCosts([{...costDraft,value:costDraft.type==='percent'?Math.round(value*100):value}]);
   const next=costIndex===null?[...costs,cost]:costs.map((row,index)=>index===costIndex?cost:row);
   await run('saveEventCosts',next);
  }catch(e){setCostError(e.message);}
 };
 const editCost=(cost,index)=>{setCostIndex(index);setCostError('');setCostDraft({...cost,value:String(cost.type==='percent'?cost.value/100:cost.value)});};
 const paymentPending=useRef(null);
 paymentLocked.current=busy||Boolean(paymentPending.current);
 const pending=useRef(null),lock=useRef(false),active=useRef(true);
 const event=data?.eventSettlements.find(row=>row.projectId===projectId) || {version:0,costs:[],history:[]};
 const dirty=JSON.stringify(costs)!==JSON.stringify(event.costs);
 const readRevision=useEventReadRefresh(request,!busy&&!paymentPending.current&&!pending.current&&!costDraft&&!editing&&!dirty&&!closeOpen);
 const load=async()=>{const result=await request(`/api/settlements?projectId=${encodeURIComponent(projectId)}`);if(active.current){setData(result);setCosts(result.eventSettlements.find(row=>row.projectId===projectId)?.costs || []);}return result;};
 useEffect(()=>{active.current=true;load().catch(e=>{if(active.current){setError(e.message);if([401,403,404].includes(e.status))setData(null);}});return()=>{active.current=false;};},[projectId,request,readRevision]);
 const clear=useUnsavedChanges(dirty||Boolean(costDraft)||Boolean(editing)||Boolean(paymentPending.current));
 let preview,previewError;
 try{preview=event.closedAt?event.snapshot:data?eventSettlementPreview(data.state,costs,data.settlements.filter(row=>row.projectId===projectId)):null;}catch(e){previewError=e.message;}
 const run=async (action,nextCosts)=>{
  if(lock.current)return;if(pending.current&&pending.current.action!==action)pending.current=null;lock.current=true;setBusy(true);setError('');
  try{
   if(await orderRepository.countWaiting(projectId))throw new Error('이 행사의 미동기화 거래를 먼저 동기화해주세요.');
   if(action==='closeEventSettlement'&&!closePassword)return;
   if(action==='reopenEventSettlement' && !await confirmAction('정산 시작을 취소하고 판매·비용 수정을 다시 허용할까요?',{title:'정산 시작 취소',confirmLabel:'시작 취소'}))return;
   if(action==='finishEventSettlement'&&!await confirmAction('제작자별 정산을 종료할까요?',{title:'정산 종료',confirmLabel:'종료'}))return;
   pending.current ||= {action,projectId,version:event.version,requestId:crypto.randomUUID(),...(action==='saveEventCosts'?{costs:nextCosts??pending.current?.costs??costs}:action==='closeEventSettlement'?{expectedPreview:JSON.stringify(preview)}:{})};
   await request('/api/settlements',{method:'POST',body:JSON.stringify({...pending.current,...(action==='closeEventSettlement'?{password:closePassword}:{})})});pending.current=null;setCostDraft(null);setCloseOpen(false);setClosePassword('');clear();await load();await onChange?.(action);
  }catch(e){if(e.status>=400 && e.status<500)pending.current=null;if(e.status===403)setClosePassword('');setError(e.message);}finally{lock.current=false;setBusy(false);}
 };
 const openClose=async()=>{
  if(busy||pending.current)return;setError('');
  try{if(await orderRepository.countWaiting(projectId))throw new Error('이 행사의 미동기화 거래를 먼저 동기화해주세요.');setClosePassword('');setCloseOpen(true);}catch(e){setError(e.message);}
 };
 const savePayment=async command=>{
  if(await orderRepository.countWaiting(projectId))throw new Error('미동기화 거래를 먼저 처리해주세요.');
  const recipientId=command.recipientId||data.recipientMappings?.find(m=>m.project_id===projectId&&m.legacy_creator===command.creator)?.recipient_id;
  if(recipientId){command={...command,recipientId};delete command.creator;}
  const result=await request('/api/settlements',{method:'POST',body:JSON.stringify(command)});
  if(active.current)setData(current=>({...current,settlements:[...current.settlements.filter(r=>r.projectId!==result.settlement.projectId||r.creator!==result.settlement.creator),result.settlement]}));
 };
 const rowFor=frozen=>{const record=data.settlements.find(row=>row.projectId===projectId&&row.creator===frozen.creator)||{version:0,payments:[],deductions:[]};const paid=record.payments.reduce((sum,p)=>sum+p.amount,0);return {...record,...frozen,recipientId:record.recipientId||data.recipientMappings?.find(m=>m.project_id===projectId&&m.legacy_creator===frozen.creator)?.recipient_id,projectId,projectName:'행사 정산',confirmed:true,paid,completed:recipientSettled(frozen,record.payments),pending:Math.max(0,frozen.net-paid)};};
 const paid=preview?.rows.some(row=>rowFor(row).paid>0||rowFor(row).completed);
 const allComplete=Boolean(preview?.rows.length)&&preview.rows.every(row=>rowFor(row).completed);
 const recordPayment=async e=>{
  e?.preventDefault();
  if(event.finishedAt)return;
  if(lock.current)return;
  const payable=rowFor(preview.rows.find(row=>row.creator===editing));
  const amount=Number(paymentAmount);
  const held=paymentPending.current;
  if(!held||held.action!=='addPayment'||held.creator!==editing||held.amount!==amount||held.paidAt!==paymentDate){
   if(!Number.isSafeInteger(amount)||amount<=0||amount>payable.pending||!paymentDate){setError('지급 금액과 날짜를 확인해주세요.');return;}
   paymentPending.current={action:'addPayment',projectId,creator:editing,version:payable.version,requestId:crypto.randomUUID(),amount,paidAt:paymentDate,memo:''};
  }
  lock.current=true;setBusy(true);setError('');
  try{await savePayment(paymentPending.current);paymentPending.current=null;setEditing(null);clear();}
  catch(e){if(e.status>=400&&e.status<500)paymentPending.current=null;setError(e.message);}
  finally{lock.current=false;setBusy(false);}
 };
 const payRemaining=async row=>{
  if(lock.current||editing)return;
  lock.current=true;setBusy(true);setError('');
  try{
   if(await orderRepository.countWaiting(projectId))throw new Error('미동기화 거래를 먼저 처리해주세요.');
   if(paymentPending.current&&(paymentPending.current.action!=='completeRecipientSettlement'||paymentPending.current.creator!==row.creator))paymentPending.current=null;
   if(!paymentPending.current){
    const payable=rowFor(row);
    if(payable.completed)return;
    if(!await confirmAction(payable.pending>0?`${row.creator}의 남은 정산금 ${won(payable.pending)}원을 모두 지급한 것으로 기록하고 정산을 완료할까요?`:`${row.creator}의 정산을 완료로 기록할까요?`,{title:'제작자 정산 완료',confirmLabel:'정산 완료'}))return;
    paymentPending.current={action:'completeRecipientSettlement',projectId,creator:row.creator,version:payable.version,requestId:crypto.randomUUID(),amount:0,paidAt:koreanDay(new Date()),memo:''};
   }
   await savePayment(paymentPending.current);paymentPending.current=null;
  }catch(e){if(e.status>=400&&e.status<500)paymentPending.current=null;setError(e.message);}
  finally{setBusy(false);lock.current=false;}
 };
 return <section className="settlement-card event-settlement-panel"><div className="event-settlement-heading"><div className="event-settlement-title"><h2>행사 정산</h2>{data&&<span className="revenue-status">{settlementPhaseLabel(event)}</span>}</div></div>{error&&<p role="alert" className="inventory-error">{error}</p>}{previewError&&<p role="alert">{previewError}</p>}{!data&&!error&&<LoadingState/>}{data&&<>
 <fieldset className="account-card event-cost-card" disabled={busy}><div className="account-card-heading management-heading event-cost-heading"><h3>행사 비용·수수료</h3>{!event.closedAt&&<button type="button" className="management-add" disabled={costs.length>=50} onClick={()=>{setCostIndex(null);setCostError('');setCostDraft({label:'',memo:'',type:'fixed',split:'equal',value:''});}}>+ 비용 항목 추가</button>}</div>
 <div className="account-card-body"><div className="management-table-wrap event-cost-table-wrap" tabIndex={0} role="region" aria-label="행사 비용 표 가로 스크롤"><table className="management-table"><thead><tr><th scope="col">비용 항목</th><th scope="col">종류</th><th scope="col">금액·수수료</th><th scope="col">분담</th><th scope="col">메모</th>{!event.closedAt&&<th scope="col">관리</th>}</tr></thead><tbody>{(event.closedAt?event.snapshot.costs:costs).map((cost,index)=><tr key={index}><td>{cost.label}</td><td>{cost.type==='percent'?'수수료':'정액'}</td><td>{cost.type==='percent'?`${cost.value/100}%`:`${won(cost.value??cost.amount)}원`}</td><td>{cost.split==='equal'?'참여 제작자 균등':'판매액 비율'}</td><td>{cost.memo}</td>{!event.closedAt&&<td><div className="event-cost-row-actions"><button type="button" className="management-back" aria-label={`${cost.label} 수정`} onClick={()=>editCost(cost,index)}>수정</button><button type="button" className="management-delete" aria-label={`${cost.label} 삭제`} onClick={()=>run('saveEventCosts',costs.filter((_,i)=>i!==index))}>삭제</button></div></td>}</tr>)}</tbody></table></div>
 </div></fieldset>
 <dialog ref={closeDialog} className="app-confirm-dialog" aria-labelledby="event-close-password-title" onCancel={e=>{if(busy)e.preventDefault();else{setCloseOpen(false);setClosePassword('');}}}>
 {closeOpen&&<form className="account-form" onSubmit={e=>{e.preventDefault();return run('closeEventSettlement');}}><h2 id="event-close-password-title">정산 시작</h2><p>정산을 시작하면 금액이 확정되고 판매·취소·비용 수정이 잠깁니다. 모든 기기의 판매를 중단하고 동기화를 완료했는지 확인해주세요.</p><label>계정 비밀번호<input type="password" autoFocus autoComplete="current-password" required value={closePassword} disabled={busy} onChange={e=>setClosePassword(e.target.value)}/></label>{error&&<p role="alert" className="inventory-error">{error}</p>}<div className="app-confirm-actions"><button type="button" className="management-back" disabled={busy} onClick={()=>{setCloseOpen(false);setClosePassword('');}}>취소</button><button className="management-add" disabled={busy||!closePassword}>{busy?<><span className="button-spinner" aria-hidden="true"/>시작</>:'시작'}</button></div></form>}
 </dialog>
 <dialog ref={costDialog} className="app-confirm-dialog event-cost-dialog" aria-labelledby="event-cost-dialog-title" onCancel={e=>{if(busy)e.preventDefault();else setCostDraft(null);}}>
 <h2 id="event-cost-dialog-title">{costIndex===null?'비용 항목 추가':'비용 항목 수정'}</h2>{costDraft&&<form className="account-form" onSubmit={addCost}><fieldset className="event-cost-fields" disabled={busy}><label>항목명<input autoFocus required maxLength={80} placeholder="부스임대료, 현수막 구매비용" value={costDraft.label} onChange={e=>updateCost('label',e.target.value)}/></label><div className="management-fields"><label>종류<select value={costDraft.type} onChange={e=>setCostDraft(current=>({...current,type:e.target.value,value:''}))}><option value="fixed">정액(원)</option><option value="percent">수수료(%)</option></select></label><label>{costDraft.type==='percent'?'수수료(%)':'금액(원)'}<input required type="number" min="0" max={costDraft.type==='percent'?100:2147483647} step={costDraft.type==='percent'?'0.01':'1'} value={costDraft.value} onChange={e=>updateCost('value',e.target.value)}/></label></div><label>분담<select value={costDraft.split} onChange={e=>updateCost('split',e.target.value)}><option value="equal">참여 제작자 균등</option><option value="ratio">판매액 비율</option></select></label><label>메모<input maxLength={500} value={costDraft.memo} onChange={e=>updateCost('memo',e.target.value)}/></label>{costError&&<p role="alert" className="inventory-error">{costError}</p>}<div className="app-confirm-actions"><button type="button" className="management-back" onClick={()=>setCostDraft(null)}>취소</button><button className="management-add">{busy&&<span className="button-spinner" aria-hidden="true"/>}{costIndex===null?'추가':'적용'}</button></div></fieldset>{error&&<p role="alert" className="inventory-error">{error}</p>}</form>}
 </dialog>
 {editing&&createPortal(<div className="event-payment-overlay"><div ref={paymentModal} className="app-confirm-dialog event-payment-modal" role="dialog" aria-modal="true" aria-labelledby="event-payment-title">
 {editing&&<form className="account-form" onSubmit={recordPayment}><header className="event-payment-heading"><h2 id="event-payment-title">지급하기</h2><span>{editing}</span></header><dl className="event-payment-summary"><div><dt>지급해야 할 금액</dt><dd>{won(Math.max(0,rowFor(preview.rows.find(row=>row.creator===editing)).net))}<span>원</span></dd></div><div><dt>남은 금액</dt><dd>{won(rowFor(preview.rows.find(row=>row.creator===editing)).pending)}<span>원</span></dd></div></dl><fieldset className="event-cost-fields" disabled={busy}><label>지급 금액(원)<input autoFocus required type="number" min="1" max={rowFor(preview.rows.find(row=>row.creator===editing)).pending} step="1" value={paymentAmount} onChange={e=>setPaymentAmount(e.target.value)}/></label><label>지급 날짜<input required type="date" min="0001-01-01" max="9999-12-31" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/></label><div className="app-confirm-actions"><button type="button" className="management-back" onClick={()=>setEditing(null)}>취소</button><button className="management-add" disabled={Boolean(event.finishedAt)||rowFor(preview.rows.find(row=>row.creator===editing)).pending<=0}>{busy?<><span className="button-spinner" aria-hidden="true"/>기록</>:'기록'}</button></div></fieldset>{error&&<p role="alert" className="inventory-error">{error}</p>}</form>}</div></div>,document.body)}
 {preview&&<section className="account-card event-settlement-report"><div className="account-card-heading"><h3>{event.closedAt?'제작자별 정산서':'제작자별 예상 정산서'}</h3></div><div className="account-card-body"><div className="management-table-wrap event-settlement-report-scroll" tabIndex={0} role="region" aria-label="정산서 가로 스크롤"><table className="management-table event-settlement-report-table" data-closed={Boolean(event.closedAt)}><thead><tr><th>제작자</th><th>판매액</th><th>분담 비용</th><th>정산금</th><th>정산 현황</th>{event.closedAt&&<><th>지급 완료</th><th>남은 정산</th><th className="event-settlement-action-cell">지급하기</th><th className="event-settlement-action-cell">정산 완료</th><th>지급·완료 이력</th></>}</tr></thead><tbody>{preview.rows.map(row=>{const payable=rowFor(row);return <tr key={row.creator}><td>{row.creator}</td><td>{won(row.gross)}원</td><td><details><summary>{won(row.fees)}원</summary>{row.shares.map((share,i)=><p key={i}>{share.label} {won(share.amount)}원</p>)}</details></td><td className={row.net<0?'inventory-error':''}>{won(row.net)}원</td><td><span className="revenue-status">{recipientSettlementLabel(event,payable)}</span></td>{event.closedAt&&<><td>{won(payable.paid)}원</td><td>{won(payable.pending)}원</td><td className="event-settlement-action-cell"><div className="event-settlement-row-actions"><button type="button" className="management-back" aria-label={`${row.creator} 지급하기`} disabled={busy || Boolean(editing)} onClick={()=>{setError('');setPaymentAmount(payable.pending>0?String(payable.pending):'');setPaymentDate(koreanDay(new Date()));setEditing(row.creator);}}>지급하기</button></div></td><td className="event-settlement-action-cell"><div className="event-settlement-row-actions"><button type="button" className="management-add" aria-label={`${row.creator} 정산 완료 기록`} disabled={Boolean(event.finishedAt) || busy || Boolean(editing) || payable.completed} onClick={()=>payRemaining(row)}>{busy?<><span className="button-spinner" aria-hidden="true"/>정산 완료</>:'정산 완료'}</button></div></td><td><details><summary>{payable.payments.length}건</summary>{payable.payments.map(p=><p key={p.id}>{p.paidAt} · {p.reversalOf?'취소':p.settlementComplete?'정산 완료':'지급'} · {won(Math.abs(p.amount))}원{p.memo?` · ${p.memo}`:''}</p>)}</details></td></>}</tr>;})}</tbody></table></div><dl className="event-settlement-totals"><div><dt>판매액</dt><dd>{won(preview.gross)}원</dd></div><div><dt>차감</dt><dd>{won(preview.fees)}원</dd></div><div><dt>정산금</dt><dd>{won(preview.net)}원</dd></div></dl></div></section>}
 <div className="event-settlement-actions">
 {!event.closedAt?<button className="management-add" disabled={busy||!preview||Boolean(previewError)} onClick={openClose}>정산 시작</button>:event.finishedAt?<button className="management-back" disabled={busy} onClick={()=>run('resumeEventSettlement')}>{busy?<><span className="button-spinner" aria-hidden="true"/>정산 종료 해제</>:'정산 종료 해제'}</button>:<>
 <button className="management-back" disabled={busy||Boolean(editing)||paid} onClick={()=>run('reopenEventSettlement')}>{busy?<><span className="button-spinner" aria-hidden="true"/>정산 시작 취소</>:'정산 시작 취소'}</button>
 <button className="management-add" disabled={busy||Boolean(editing)||!allComplete} onClick={()=>run('finishEventSettlement')}>{busy?<><span className="button-spinner" aria-hidden="true"/>정산 종료</>:'정산 종료'}</button>
 </>}
 </div>
 {event.history.length>0&&<details><summary>정산 이력</summary>{event.history.map((entry,i)=><p key={i}>{{close:'정산 시작',reopen:'정산 시작 취소',finish:'정산 종료',resume:'정산 종료 해제'}[entry.action]} · {new Date(entry.at).toLocaleString('ko-KR')}</p>)}</details>}
 </>}</section>;
}
