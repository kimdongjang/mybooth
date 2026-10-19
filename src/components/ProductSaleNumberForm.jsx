import { useEffect, useRef, useState } from 'react';
import { Input } from './PosUI';

export default function ProductSaleNumberForm({ product, order, disabled, onSave }) {
  const [number,setNumber]=useState(String(product.saleNumber || order.indexOf(product.id)+1));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitting=useRef(false);
  useEffect(()=>{setNumber(String(product.saleNumber || order.indexOf(product.id)+1));setError('');},[product.id,product.saleNumber]);
  const submit=async event=>{
    event.preventDefault(); if(disabled || submitting.current)return;
    const saleNumber=Number(number);
    if(!String(number).trim() || !Number.isInteger(saleNumber) || saleNumber<1 || saleNumber>order.length){setError(`판매 번호는1~${order.length} 사이의 정수로 입력해주세요.`);return;}
    submitting.current=true;setBusy(true);setError('');
    try { if(!await onSave({productId:product.id,saleNumber,expectedOrder:order}))setError('순서를 저장하지 못했습니다.'); }
    catch(err){setError(err.message || '순서를 저장하지 못했습니다.');}
    finally{submitting.current=false;setBusy(false);}
  };
  return <form className="product-sale-number-form" onSubmit={submit}>
    <label><span className="sr-only">{product.name} 판매 번호</span><Input aria-label={`${product.name} 판매 번호`} type="number" min="1" max={order.length} step="1" required value={number} disabled={disabled || busy} onChange={setNumber}/></label>
    <button type="submit" className="management-back" disabled={disabled || busy}>{busy?'저장 중…':'적용'}</button>
    {error&&<p role="alert">{error}</p>}
  </form>;
}
