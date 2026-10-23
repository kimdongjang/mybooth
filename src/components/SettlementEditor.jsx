import { useRef, useState } from 'react';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { won } from '../utils/productDisplay';
import { koreanDay } from '../utils/revenueSummary';

export default function SettlementEditor({ row, save, close }) {
  const [deductions, setDeductions] = useState(row.deductions.map(item => ({ ...item })));
  const [amount, setAmount] = useState('');
  const [paidAt, setPaidAt] = useState(koreanDay(new Date()));
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(null);
  const locked = useRef(false);
  const dirtyFees = JSON.stringify(deductions) !== JSON.stringify(row.deductions);
  const clear = useUnsavedChanges(dirtyFees || Boolean(amount || memo));
  const run = async body => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    // Preserve the exact command ID/body after a lost response; retry cannot pay twice.
    const fingerprint = JSON.stringify(body);
    if (!pending.current || pending.current.fingerprint !== fingerprint) pending.current = { fingerprint, command: { ...body, requestId: crypto.randomUUID() } };
    try { await save({ ...pending.current.command, projectId: row.projectId, ...(row.recipientId?{recipientId:row.recipientId}:{creator:row.creator}), version: row.version }); clear(); close(); }
    catch (err) { setError(err.message); }
    finally { locked.current = false; setBusy(false); }
  };
  return <div className="settlement-editor">
    <h3>{row.projectName} · {row.creator}</h3>
    {error && <p role="alert" className="inventory-error">{error}</p>}
    {!row.confirmed && <form onSubmit={event => { event.preventDefault(); run({ action: 'saveDeductions', deductions: deductions.map(item => ({ label: item.label, amount: item.amount === '' ? null : Number(item.amount) })) }); }}>
      <fieldset disabled={busy}><legend>수수료·운영비 차감 항목</legend>
        {deductions.map((item,index) => <div className="settlement-fee-row" key={index}><label>항목명<input aria-label={`차감 항목 ${index+1} 이름`} required maxLength={80} value={item.label} onChange={event => setDeductions(current => current.map((fee,i) => i===index ? { ...fee, label:event.target.value } : fee))} /></label><label>금액(원)<input aria-label={`차감 항목 ${index+1} 금액`} required type="number" min="0" max="2147483647" step="1" value={item.amount} onChange={event => setDeductions(current => current.map((fee,i) => i===index ? { ...fee, amount:event.target.value } : fee))} /></label><button type="button" aria-label={`차감 항목 ${index+1} 제거`} onClick={() => setDeductions(current => current.filter((_,i) => i!==index))}>제거</button></div>)}
        <button type="button" className="management-back" disabled={deductions.length>=50} onClick={() => setDeductions(current => [...current,{label:'',amount:0}])}>+ 차감 항목</button>
        <p className="revenue-net">판매 {won(row.gross)}원 − 차감 {won(deductions.reduce((sum,item)=>sum+Number(item.amount||0),0))}원 = 정산 예정 {won(row.gross-deductions.reduce((sum,item)=>sum+Number(item.amount||0),0))}원</p>
        <button className="management-add" disabled={!dirtyFees}>차감 내역 저장</button>
      </fieldset>
    </form>}
    {row.confirmed && <form onSubmit={event => { event.preventDefault(); if (dirtyFees) { setError('차감 내역을 먼저 저장해주세요.'); return; } run({action:'addPayment',amount:amount===''?null:Number(amount),paidAt,memo}); }}>
      <fieldset disabled={busy || dirtyFees}><legend>지급 기록</legend><div className="settlement-payment-fields">
        <label>지급 금액(원)<input required type="number" min="1" max={row.pending} step="1" value={amount} onChange={event=>setAmount(event.target.value)} /></label>
        <label>지급 날짜<input required type="date" min="0001-01-01" max="9999-12-31" value={paidAt} onChange={event=>setPaidAt(event.target.value)} /></label>
        <label className="settlement-memo">메모<input maxLength={500} value={memo} onChange={event=>setMemo(event.target.value)} /></label>
      </div><div className="revenue-editor-actions"><button type="button" className="management-back" disabled={row.pending<=0} onClick={()=>setAmount(String(row.pending))}>남은 정산금 {won(row.pending)}원</button><button className="management-add" disabled={row.pending<=0}>지급 내역 기록</button></div></fieldset>
    </form>}
    {row.payments.length>0 && <ul className="settlement-payment-history">{row.payments.map(payment=><li key={payment.id}><span>{payment.paidAt} · {won(payment.amount)}원 {payment.memo}</span>{payment.amount>0 && !row.payments.some(item=>item.reversalOf===payment.id) && <button type="button" disabled={busy || dirtyFees || Boolean(amount || memo)} className="event-text-link" onClick={()=>run({action:'reversePayment',paymentId:payment.id,paidAt:koreanDay(new Date()),memo:'지급 기록 취소'})}>지급 기록 취소</button>}</li>)}</ul>}
    <button type="button" className="management-back" disabled={busy} onClick={()=>{ setDeductions(row.deductions.map(item=>({...item})));setAmount('');setMemo('');setError(''); }}>변경 취소</button> <button type="button" className="management-back" disabled={busy || dirtyFees || Boolean(amount || memo)} onClick={close}>닫기</button>
  </div>;
}
